import { createHash, randomUUID } from "node:crypto";
import { getObjectAsText, putPrivateJson } from "../../shared/utils/r2-client.js";
import { BookFeatureRepository } from "../bookFeature/repository.js";
import { OutreachRepository } from "./outreachRepository.js";
import { classifyBookFeatureInbound } from "../bookFeature/inboundLifecycle.js";
import { checkCurrentContactAssessment } from "../bookFeature/contactEligibility.js";

const first = (r) => r?.results?.[0] || null;
const changes = (r) => Number(r?.meta?.changes || 0);
const hash = (v) => createHash("sha256").update(v).digest("hex");
const normal = (v) => String(v || "").trim().toLowerCase();

export class ControlledGuestOutbox {
  constructor(d1, { now = () => new Date(), persist = putPrivateJson, read = getObjectAsText, checkAssessment = checkCurrentContactAssessment } = {}) {
    this.d1 = d1; this.now = now; this.persist = persist; this.read = read; this.checkAssessment = checkAssessment;
    this.controls = new BookFeatureRepository(d1, { now });
    this.shared = new OutreachRepository(d1);
  }

  async queue({ lead, pitch, keyword, validationExpiresAt, assessmentKey, recipientType }) {
    const mode = await this.controls.mode();
    if (mode.effective !== "controlled_test" || mode.killSwitch || !mode.approvalActor || !mode.testRecipients.length) return null;
    const at = this.now().toISOString();
    const recipient = normal(mode.testRecipients[0]);
    const domain = normal(lead.domain).replace(/^www\./, '');
    const email = normal(lead.email);
    if (recipient === email || !domain || !email || !pitch.qa?.passed || !lead.qualification?.qualified ||
        !await this.checkAssessment({ domain, email, recipientType, campaign: "guest_article", assessmentKey, now: this.now() }) ||
        !Number.isFinite(pitch.qa.score) || pitch.qa.score < 9.1 ||
        !(Date.parse(validationExpiresAt) > Date.parse(at))) return null;
    const source = new URL(lead.editorialEvidence?.evidenceUrl || lead.sourceUrl);
    if (source.protocol !== "https:" || source.username || source.password ||
        source.hostname.toLowerCase().replace(/^www\./, "") !== domain.replace(/^www\./, "")) return null;
    const opportunity = hash(`guest-article\u001f${domain}\u001f${email}`);
    const id = hash(`guest-test\u001f${opportunity}\u001f${mode.version}`);
    const runKey = `guest-article:${at.slice(0,10)}`;
    const contentHash = hash(`${pitch.subject}\n${pitch.body}`);
    const key = `outreach/guest-article/pitches/${id}/${contentHash}.json`;
    await this.persist("kdp", key, { pitch, keyword, sourceUrl: source.href, qualification: lead.qualification, validationExpiresAt, assessmentKey, recipientType });
    const reserved = await this.controls.reserveTarget({ opportunityId: opportunity, campaignType: "guest_article", email, domain });
    if (!reserved.acquired) return null;
    const result = await this.d1.query(`INSERT OR IGNORE INTO guest_article_controlled_outbox
      (id,run_key,opportunity_key,intended_email,official_domain,delivery_recipient,subject,body_key,content_sha256,
       qa_score,qa_version,configuration_version,source_url,validation_expires_at,status,created_at,updated_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,'guest-article-pitch-qa-v1',?,?,?,'queued',?,?,?
      WHERE EXISTS (SELECT 1 FROM book_feature_configuration f WHERE f.singleton=1 AND f.mode='controlled_test' AND f.kill_switch=0 AND f.version=?)
      AND NOT EXISTS (SELECT 1 FROM comms_hub_outreach_suppression s WHERE lower(s.email) IN (?,?) OR
        (s.domain<>'' AND lower(s.domain) IN (?,?)))
      AND (SELECT COUNT(*) FROM guest_article_controlled_outbox WHERE run_key=? AND status IN ('queued','leased','accepted','delivered','unknown'))<?
      AND (SELECT COUNT(*) FROM guest_article_controlled_outbox WHERE substr(created_at,1,10)=? AND status IN ('queued','leased','accepted','delivered','unknown'))<?`,
      [id,runKey,opportunity,email,domain,recipient,pitch.subject,key,contentHash,pitch.qa.score,mode.version,source.href,validationExpiresAt,
       at,at,new Date(Date.parse(at)+24*60*60_000).toISOString(),mode.version,email,recipient,domain,recipient.split("@")[1],
       runKey,mode.perRunCap,at.slice(0,10),mode.dailyCap]);
    return changes(result) === 1 ? { id, status: "queued" } : null;
  }

  async overview() {
    const rows = (await this.d1.query(`SELECT id,status,accepted_at,delivered_at,last_error_code,created_at,updated_at
      FROM guest_article_controlled_outbox ORDER BY created_at DESC LIMIT 20`)).results || [];
    return { recent: rows, statusCounts: (await this.d1.query("SELECT status,COUNT(*) AS total FROM guest_article_controlled_outbox GROUP BY status")).results || [] };
  }

  async runOnce(context) {
    const mode = await this.controls.mode();
    const at = this.now().toISOString();
    await this.d1.query(`UPDATE guest_article_controlled_outbox SET status='unknown',last_error_code='lease_expired',
      lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE status='leased' AND lease_expires_at<=?`, [at,at]);
    if (mode.effective !== "controlled_test" || mode.killSwitch || !mode.approvalActor) return { processed: false };
    await this.d1.query(`UPDATE guest_article_controlled_outbox SET status='cancelled',last_error_code='approval_changed_or_expired',updated_at=?
      WHERE status='queued' AND (configuration_version<>? OR expires_at<=?)`, [at,mode.version,at]);
    const owner = randomUUID();
    const row = first(await this.d1.query(`UPDATE guest_article_controlled_outbox SET status='leased',lease_owner=?,lease_expires_at=?,updated_at=?
      WHERE id=(SELECT id FROM guest_article_controlled_outbox WHERE status='queued' AND expires_at>? AND configuration_version=?
      ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *`, [owner,new Date(Date.parse(at)+120000).toISOString(),at,at,mode.version]));
    if (!row) return { processed: false };
    const finish = (status, code = null, providerId = null) => this.d1.query(`UPDATE guest_article_controlled_outbox SET status=?,last_error_code=?,
      provider_message_id=COALESCE(?,provider_message_id),accepted_at=CASE WHEN ?='accepted' THEN ? ELSE accepted_at END,
      lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_owner=?`,
      [status,code,providerId,status,this.now().toISOString(),this.now().toISOString(),row.id,owner]);
    let admitted = false;
    try {
      const archived = JSON.parse(await this.read("kdp", row.body_key));
      if (!archived?.pitch?.qa?.passed || archived.pitch.qa.score !== row.qa_score ||
          hash(`${archived.pitch.subject}\n${archived.pitch.body}`) !== row.content_sha256) {
        await finish("quarantined","qa_archive_mismatch"); return { processed: true, status: "quarantined", outboxId: row.id };
      }
      const conversation = await this.shared.createOutboundConversation({ email: row.delivery_recipient,
        domain: row.official_domain, keyword: archived.keyword, subject: row.subject, sourceUrl: row.source_url,
        workflow: "outreach_guest_article_test", campaignType: "guest_article", opportunityId: row.id });
      const beforeProviderHandoff = async () => {
        const effective = await this.controls.mode();
        if (effective.effective !== "controlled_test" || effective.killSwitch || effective.version !== row.configuration_version ||
          !await this.checkAssessment({ domain: row.official_domain, email: row.intended_email, recipientType: archived.recipientType,
            campaign: "guest_article", assessmentKey: archived.assessmentKey, now: this.now() })) return false;
        const now = this.now().toISOString();
        const result = await this.d1.query(`INSERT OR IGNORE INTO book_feature_audit
          (id,entity_type,entity_id,action,actor,evidence_json,created_at)
          SELECT ?,'outbox',g.id,'handoff_admitted',f.approval_actor,json_object('runKey',g.run_key,'campaign','guest_article'),?
          FROM guest_article_controlled_outbox g JOIN book_feature_configuration f ON f.singleton=1
          WHERE g.id=? AND g.status='leased' AND g.lease_owner=? AND g.lease_expires_at>? AND g.expires_at>?
          AND g.validation_expires_at>? AND f.mode='controlled_test' AND f.kill_switch=0 AND f.version=g.configuration_version AND f.approval_actor IS NOT NULL
          AND EXISTS (SELECT 1 FROM json_each(f.test_recipients_json) WHERE value=g.delivery_recipient)
          AND NOT EXISTS (SELECT 1 FROM comms_hub_outreach_suppression s WHERE lower(s.email) IN (g.intended_email,g.delivery_recipient)
            OR (s.domain<>'' AND lower(s.domain) IN (g.official_domain,substr(g.delivery_recipient,instr(g.delivery_recipient,'@')+1))))
          AND EXISTS (SELECT 1 FROM outreach_target_reservations t WHERE t.target_key=g.official_domain AND t.opportunity_id=g.opportunity_key
            AND t.status='active' AND t.expires_at>?)
          AND (SELECT COUNT(*) FROM book_feature_audit a WHERE a.action='handoff_admitted' AND substr(a.created_at,1,10)=?)<f.daily_cap
          AND (SELECT COUNT(*) FROM book_feature_audit a WHERE a.action='handoff_admitted' AND json_extract(a.evidence_json,'$.runKey')=g.run_key)<f.per_run_cap`,
          [hash(`guest-handoff:${row.id}`),now,row.id,owner,now,now,now,now,now.slice(0,10)]);
        admitted = changes(result) === 1;
        return admitted;
      };
      const sent = await context.emailService.send({ conversationId: conversation.conversationId, bodyText: archived.pitch.body,
        subject: row.subject, recipients: [row.delivery_recipient], idempotencyKey: `guest-controlled:${row.id}`,
        scheduledDelivery: true, beforeProviderHandoff });
      if (!sent?.providerMessageId) { await finish("unknown","provider_receipt_missing"); return { processed: true, status: "unknown", outboxId: row.id }; }
      await finish("accepted",null,sent.providerMessageId);
      return { processed: true, status: "accepted", outboxId: row.id, providerMessageId: sent.providerMessageId };
    } catch {
      await finish(admitted ? "unknown" : "cancelled", admitted ? "provider_outcome_unknown" : "dispatch_blocked");
      return { processed: true, status: admitted ? "unknown" : "cancelled", outboxId: row.id };
    }
  }

  async reconcile({ outboxId, eventId, providerMessageId, outcome }) {
    if (!eventId || !providerMessageId || !["delivered","bounced","failed"].includes(outcome)) throw new Error("Authenticated matching delivery event required.");
    const status = outcome === "failed" ? "quarantined" : outcome;
    const at = this.now().toISOString();
    const result = await this.d1.batch([
      { sql: `UPDATE guest_article_controlled_outbox SET status=?,provider_message_id=?,delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END,
        updated_at=? WHERE id=? AND status IN ('accepted','unknown') AND (provider_message_id IS NULL OR provider_message_id=?)
        AND NOT EXISTS (SELECT 1 FROM guest_article_controlled_events WHERE id=?)`,
        params: [status,providerMessageId,status,at,at,outboxId,providerMessageId,eventId] },
      { sql: `INSERT OR IGNORE INTO guest_article_controlled_events (id,outbox_id,category,created_at)
        SELECT ?,?,?,? WHERE changes()=1`, params: [eventId,outboxId,outcome,at] },
    ]);
    return { status, duplicate: changes(result[1]) !== 1 };
  }

  async inbound({ providerMessageId, eventId, sender, text }) {
    if (!providerMessageId || !eventId) return { matched: false };
    const row = first(await this.d1.query("SELECT * FROM guest_article_controlled_outbox WHERE provider_message_id=? AND delivery_recipient=?", [providerMessageId,normal(sender)]));
    if (!row) return { matched: false };
    const category = classifyBookFeatureInbound(text);
    const at = this.now().toISOString();
    const statements = [];
    if (["opt_out","decline","bounce"].includes(category)) {
      statements.push({ sql: `INSERT OR IGNORE INTO comms_hub_outreach_suppression (id,email,domain,reason,source,created_at,metadata_json)
        SELECT ?,?,'',?,'guest_article_controlled_inbound',?,'{}' WHERE NOT EXISTS (SELECT 1 FROM guest_article_controlled_events WHERE id=?)`,
        params: [hash(`guest-test-suppression:${row.delivery_recipient}`),row.delivery_recipient,category,at,eventId] });
      statements.push({ sql: `UPDATE guest_article_controlled_outbox SET status=CASE WHEN status='leased' THEN 'unknown' ELSE 'cancelled' END,
        lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=? WHERE delivery_recipient=? AND status IN ('queued','leased')
        AND NOT EXISTS (SELECT 1 FROM guest_article_controlled_events WHERE id=?)`, params: [category,at,row.delivery_recipient,eventId] });
    }
    statements.push({ sql: "INSERT OR IGNORE INTO guest_article_controlled_events (id,outbox_id,category,created_at) VALUES (?,?,?,?)",
      params: [eventId,row.id,category,at] });
    const result = await this.d1.batch(statements);
    return { matched: true, category, duplicate: changes(result[result.length-1]) !== 1 };
  }
}
