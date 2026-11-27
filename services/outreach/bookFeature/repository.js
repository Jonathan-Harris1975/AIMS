import { createHash, randomUUID } from "node:crypto";
import { effectiveMode, matchedPassage } from "./core.js";

const first = (response) => response?.results?.[0] || null;
const changes = (response) => Number(response?.meta?.changes || 0);
const normalisedEmail = (value) => String(value || "").trim().toLowerCase();
const validEmail = (value) => {
  if (!value || value.length > 254) return false;
  const separator = value.indexOf("@");
  if (separator < 1 || separator !== value.lastIndexOf("@") || separator > 64) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  for (const character of local) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127) return false;
  }
  return domain.split(".").every((label) => label && !label.startsWith("-") && !label.endsWith("-") &&
    [...label].every((character) => /[a-z0-9-]/.test(character)));
};

export class BookFeatureRepository {
  constructor(d1, { now = () => new Date(), leaseId = randomUUID, leaseMs = 15 * 60_000 } = {}) {
    this.d1 = d1;
    this.now = now;
    this.leaseId = leaseId;
    this.leaseMs = leaseMs;
  }

  async mode(env = process.env) {
    const row = first(await this.d1.query(`SELECT mode,kill_switch,test_recipients_json,per_run_cap,daily_cap,
      approval_actor,approval_reason,approved_at,version,updated_at FROM book_feature_configuration WHERE singleton=1`));
    if (!row) throw new Error("Book Feature configuration migration has not been applied.");
    const globalStop = ["1", "true", "yes", "on"].includes(String(env.OUTREACH_GLOBAL_KILL_SWITCH || "").trim().toLowerCase());
    return { persisted: row.mode, effective: globalStop ? "suspended" : effectiveMode(env.BOOK_FEATURE_OUTREACH_MODE, row.mode),
      killSwitch: globalStop || Boolean(row.kill_switch), testRecipients: JSON.parse(row.test_recipients_json || "[]"),
      perRunCap: Number(row.per_run_cap), dailyCap: Number(row.daily_cap), approvalActor: row.approval_actor,
      approvalReason: row.approval_reason, approvedAt: row.approved_at, version: row.version, updatedAt: row.updated_at };
  }

  async transitionMode(next, actor, expectedVersion, reason = "") {
    if (!["disabled", "assessment", "suspended"].includes(next)) throw new Error("Controlled modes require explicit recipient and cap configuration.");
    if (!actor || !String(reason).trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("An actor, reason and configuration version are required.");
    }
    const at = this.now().toISOString();
    const id = this.leaseId();
    const result = await this.d1.batch([
      { sql: `UPDATE book_feature_configuration SET mode=?,kill_switch=1,approval_actor=NULL,approval_reason=NULL,
              approved_at=NULL,updated_at=?,updated_by=?,version=version+1 WHERE singleton=1 AND version=?`,
        params: [next, at, actor, expectedVersion] },
      { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
              SELECT ?,'configuration','1','mode_transition',?,?,? WHERE changes()=1`,
        params: [id, actor, JSON.stringify({ next, expectedVersion, reason: String(reason).slice(0, 500) }), at] },
      { sql: `UPDATE book_feature_outbox SET status=CASE WHEN status='leased' THEN 'unknown' ELSE 'cancelled' END,
              failure_class=CASE WHEN status='leased' THEN 'uncertain' ELSE 'policy' END,
              last_error_code='kill_switch_enabled',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
              WHERE status IN ('queued','leased') AND changes()=1`, params: [at] },
    ]);
    if (changes(result[0]) !== 1) throw new Error("Configuration version changed; mode transition rejected.");
    return this.mode();
  }

  async configureControlledTest({ recipients, perRunCap = 1, dailyCap = 1, actor, reason, expectedVersion }) {
    const allowlist = [...new Set((recipients || []).map(normalisedEmail).filter(validEmail))];
    if (!allowlist.length || allowlist.length > 5 || allowlist.length !== (recipients || []).length) {
      throw new Error("One to five unique valid test recipients are required.");
    }
    if (!Number.isSafeInteger(perRunCap) || perRunCap < 1 || perRunCap > 5 ||
        !Number.isSafeInteger(dailyCap) || dailyCap < 1 || dailyCap > 10 || perRunCap > dailyCap ||
        !actor || !String(reason).trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Valid caps, actor, reason and expected configuration version are required.");
    }
    const at = this.now().toISOString();
    const auditId = this.leaseId();
    const result = await this.d1.batch([
      { sql: `UPDATE book_feature_configuration SET mode='controlled_test',kill_switch=0,test_recipients_json=?,
          per_run_cap=?,daily_cap=?,approval_actor=?,approval_reason=?,approved_at=?,updated_at=?,updated_by=?,version=version+1
          WHERE singleton=1 AND version=?`,
        params: [JSON.stringify(allowlist),perRunCap,dailyCap,actor,String(reason).slice(0,500),at,at,actor,expectedVersion] },
      { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
          SELECT ?,'configuration','1','controlled_test_enabled',?,?,? WHERE changes()=1`,
        params: [auditId,actor,JSON.stringify({ recipients: allowlist, perRunCap, dailyCap, expectedVersion,
          reason: String(reason).slice(0,500) }),at] },
    ]);
    if (changes(result[0]) !== 1) throw new Error("Configuration version changed; controlled test rejected.");
    return this.mode();
  }

  async persistQualifications(campaignId, qualifications = []) {
    const at = this.now().toISOString();
    let persisted = 0;
    for (const item of qualifications) {
      if (item?.identity?.status !== "verified" || !item.identity.officialDomain || !item.name) continue;
      const organisationId = createHash("sha256").update(`book-feature-org\u001f${item.identity.officialDomain}`).digest("hex");
      const opportunityId = createHash("sha256").update(`${campaignId}\u001f${organisationId}`).digest("hex");
      const evidence = (item.identity.evidence || []).filter((row) => row.id).map((row) => ({ id: row.id,
        url: row.canonicalUrl, retrievedAt: row.retrievedAt, contentHash: row.contentHash }));
      const identityEvidenceKey = `outreach/book-feature/identity/${organisationId}/${item.identity.verifiedAt}.json`;
      await this.d1.batch([
        { sql: `INSERT INTO book_feature_organisations
          (id,canonical_name,official_domain,identity_status,source_json,verified_at,updated_at,legal_name,identity_evidence_key,identity_expires_at)
          VALUES (?,?,?,'verified',?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name,official_domain=excluded.official_domain,
          identity_status='verified',source_json=excluded.source_json,verified_at=excluded.verified_at,updated_at=excluded.updated_at,
          legal_name=excluded.legal_name,identity_evidence_key=excluded.identity_evidence_key,identity_expires_at=excluded.identity_expires_at`,
          params: [organisationId,item.name,item.identity.officialDomain,JSON.stringify(evidence),item.identity.verifiedAt,at,
            item.identity.legalName,identityEvidenceKey,item.identity.expiresAt] },
        { sql: `INSERT INTO book_feature_opportunities
          (id,campaign_id,organisation_id,state,tier,score,rubric_version,gate_json,next_action_at,reason,created_at,updated_at,
           score_components_json,evidence_json)
          VALUES (?,?,?,'validated',?,?,?,?,?,?,?, ?,?,?,?)
          ON CONFLICT(campaign_id,organisation_id) DO UPDATE SET state='validated',tier=excluded.tier,score=excluded.score,
          rubric_version=excluded.rubric_version,gate_json=excluded.gate_json,reason=excluded.reason,updated_at=excluded.updated_at,
          score_components_json=excluded.score_components_json,evidence_json=excluded.evidence_json`,
          params: [opportunityId,campaignId,organisationId,item.tier === "priority" ? "A" : item.tier === "strong" ? "B" :
            item.tier === "conditional" ? "C" : "D",item.score,item.rubric,JSON.stringify(item.gates),null,item.reason,at,at,
            JSON.stringify(item.components),JSON.stringify(evidence)] },
        { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
          VALUES (?,'opportunity',?,'identity_verified_and_scored','book-feature-assessment',?,?)`,
          params: [this.leaseId(),opportunityId,JSON.stringify({ organisationId, score: item.score, rubric: item.rubric,
            failedGates: item.failedGates, identityEvidenceKey }),at] },
      ]);
      persisted++;
    }
    return { persisted };
  }

  async persistEligibleContacts(opportunityId, organisationId, contacts = []) {
    const at = this.now().toISOString();
    let persisted = 0;
    const accepted = [];
    for (const contact of contacts) {
      const email = normalisedEmail(contact?.email);
      if (!validEmail(email) || contact.eligibilityStatus !== "eligible" || contact.validationResult !== "valid" ||
          !contact.sourceUrl || !contact.assessmentKey) continue;
      const suppressed = first(await this.d1.query(`SELECT id FROM comms_hub_outreach_suppression
        WHERE lower(email)=? OR (domain<>'' AND lower(domain)=?) LIMIT 1`, [email, email.split("@")[1]]));
      if (suppressed) continue;
      const contactId = createHash("sha256").update(`book-feature-contact\u001f${email}`).digest("hex");
      const stored = await this.d1.batch([
        { sql: `INSERT INTO book_feature_contacts
          (id,organisation_id,email,normalised_email,display_name,role,recipient_type,source_url,source_title,
           validation_provider,validation_result,validated_at,validation_expires_at,jurisdiction,lawful_basis,assessment_key,
           consent_status,eligibility_status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(normalised_email) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,
          source_url=excluded.source_url,source_title=excluded.source_title,validation_provider=excluded.validation_provider,
          validation_result=excluded.validation_result,validated_at=excluded.validated_at,
          validation_expires_at=excluded.validation_expires_at,lawful_basis=excluded.lawful_basis,
          assessment_key=excluded.assessment_key,consent_status=excluded.consent_status,
          eligibility_status=excluded.eligibility_status,updated_at=excluded.updated_at`,
          params: [contactId,organisationId,email,email,contact.displayName || null,contact.role,contact.recipientType,
            contact.sourceUrl,contact.sourceTitle || null,contact.validationProvider,contact.validationResult,
            contact.validatedAt,contact.validationExpiresAt,contact.jurisdiction || "GB",contact.lawfulBasis,
            contact.assessmentKey,contact.consentStatus,contact.eligibilityStatus,at,at] },
        { sql: `UPDATE book_feature_opportunities SET contact_id=?,state='eligible',
          gate_json=json_set(gate_json,'$.contact',json('true'),'$.lawfulBasis',json('true'),'$.suppression',json('true')),
          reason='draft_and_qa_pending',updated_at=? WHERE id=? AND organisation_id=? AND state='validated'`,
          params: [contactId,at,opportunityId,organisationId] },
        { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
          SELECT ?,'contact',?,'contact_eligible','book-feature-assessment',?,? WHERE changes()=1`,
          params: [this.leaseId(),contactId,JSON.stringify({ opportunityId, validationProvider: contact.validationProvider,
            validatedAt: contact.validatedAt, sourceUrl: contact.sourceUrl, assessmentKey: contact.assessmentKey }),at] },
      ]);
      if (changes(stored[1]) !== 1) continue;
      persisted++;
      accepted.push(contact);
      break;
    }
    return { persisted, contacts: accepted };
  }

  async reserveTarget({ opportunityId, campaignType = "book_feature", email, domain, ttlMs = 7 * 24 * 60 * 60_000 }) {
    const key = String(domain || "").trim().toLowerCase().replace(/^www\./, "") || normalisedEmail(email);
    if (!key || !["guest_article","book_feature"].includes(campaignType)) throw new Error("A valid reservation target is required.");
    const now = this.now();
    const at = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const id = createHash("sha256").update(`outreach-reservation\u001f${key}`).digest("hex");
    await this.d1.batch([
      { sql: `UPDATE outreach_target_reservations SET campaign_type=?,opportunity_id=?,status='active',reserved_at=?,expires_at=?,
          released_at=NULL,reason=NULL WHERE target_key=? AND (status IN ('released','expired') OR expires_at<=?)`,
        params: [campaignType,opportunityId,at,expiresAt,key,at] },
      { sql: `INSERT OR IGNORE INTO outreach_target_reservations
          (id,target_key,campaign_type,opportunity_id,status,reserved_at,expires_at) VALUES (?,?,?,?, 'active',?,?)`,
        params: [id,key,campaignType,opportunityId,at,expiresAt] },
    ]);
    const row = first(await this.d1.query("SELECT * FROM outreach_target_reservations WHERE target_key=?", [key]));
    return { acquired: row?.status === "active" && row.opportunity_id === opportunityId, reservation: row };
  }

  async recordCost(entry) {
    const measured = Number.isFinite(entry?.measuredCostUsd);
    const id = entry.id || this.leaseId();
    await this.d1.query(`INSERT INTO outreach_cost_ledger
      (id,campaign_type,campaign_id,opportunity_id,stage,provider,model_route,input_tokens,output_tokens,
       measured_cost_usd,cost_status,cache_status,attempts,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,entry.campaignType || "book_feature",entry.campaignId || null,entry.opportunityId || null,entry.stage,
      entry.provider,entry.modelRoute || null,entry.inputTokens ?? null,entry.outputTokens ?? null,
      measured ? entry.measuredCostUsd : null,measured ? "measured" : entry.costStatus || "unreported",
      entry.cacheStatus || "unknown",entry.attempts || 1,this.now().toISOString()]);
    return { id, costStatus: measured ? "measured" : entry.costStatus || "unreported" };
  }

  async recordPitchVersion({ opportunityId, campaignId, version, pitch, qa, bodyKey, contentHash,
    draftMetadata, reviewMetadata, promptVersion, qaVersion }) {
    const at = this.now().toISOString();
    const pitchId = createHash("sha256").update(`${opportunityId}\u001f${version}\u001f${contentHash}`).digest("hex");
    const qaId = createHash("sha256").update(`${pitchId}\u001f${qaVersion}`).digest("hex");
    await this.d1.batch([
      { sql: `INSERT INTO book_feature_pitch_versions
        (id,opportunity_id,version,subject,body_key,content_sha256,prompt_version,model_route,input_tokens,output_tokens,measured_cost_usd,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, params: [pitchId,opportunityId,version,pitch.subject,bodyKey,contentHash,promptVersion,
          draftMetadata.modelRoute,draftMetadata.inputTokens,draftMetadata.outputTokens,draftMetadata.measuredCostUsd,at] },
      { sql: `INSERT INTO book_feature_qa_reviews
        (id,pitch_version_id,rubric_version,passed,score,gates_json,reasons_json,reviewer_route,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, params: [qaId,pitchId,qaVersion,qa.passed ? 1 : 0,qa.score,JSON.stringify(qa.gates),
          JSON.stringify(qa.reasons),reviewMetadata.modelRoute,at] },
      { sql: `UPDATE book_feature_opportunities SET state=?,gate_json=json_set(gate_json,'$.qa',json(?)),
          reason=?,updated_at=? WHERE id=? AND state IN ('eligible','drafted','qa_passed')`,
        params: [qa.passed ? "qa_passed" : "drafted",qa.passed ? "true" : "false",
          qa.passed ? "controlled_test_authorisation_pending" : "qa_repair_or_review_required",at,opportunityId] },
    ]);
    await this.recordCost({ campaignType: "book_feature", campaignId, opportunityId, stage: "draft",
      provider: "openrouter", modelRoute: draftMetadata.modelRoute, inputTokens: draftMetadata.inputTokens,
      outputTokens: draftMetadata.outputTokens, measuredCostUsd: draftMetadata.measuredCostUsd,
      costStatus: draftMetadata.measuredCostUsd === null ? "unreported" : "measured" });
    await this.recordCost({ campaignType: "book_feature", campaignId, opportunityId, stage: "qa",
      provider: "openrouter", modelRoute: reviewMetadata.modelRoute, inputTokens: reviewMetadata.inputTokens,
      outputTokens: reviewMetadata.outputTokens, measuredCostUsd: reviewMetadata.measuredCostUsd,
      costStatus: reviewMetadata.measuredCostUsd === null ? "unreported" : "measured" });
    return { pitchId, qaId, version, passed: qa.passed, score: qa.score };
  }

  async queueControlledTest({ opportunityId, recipient, idempotencyKey, runKey, notBefore = this.now(), expiresAt }) {
    const email = normalisedEmail(recipient);
    const config = await this.mode();
    if (config.effective !== "controlled_test" || config.killSwitch || !config.testRecipients.includes(email)) {
      throw Object.assign(new Error("Controlled-test recipient or mode is not authorised."), { code: "BOOK_FEATURE_TEST_NOT_AUTHORISED" });
    }
    const existingByKey = first(await this.d1.query("SELECT * FROM book_feature_outbox WHERE idempotency_key=?", [idempotencyKey]));
    if (existingByKey) return { duplicate: true, outbox: existingByKey };
    const now = this.now();
    const at = now.toISOString();
    const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt || now.getTime() + 24 * 60 * 60_000);
    if (!Number.isFinite(expiry.getTime()) || expiry <= notBefore) throw new Error("A future outbox expiry is required.");
    const dayStart = new Date(now); dayStart.setUTCHours(0,0,0,0);
    if (!String(runKey || "").trim()) throw new Error("A controlled-test run key is required.");
    const runSends = first(await this.d1.query(`SELECT COUNT(*) AS total FROM book_feature_outbox
      WHERE run_key=? AND status IN ('queued','leased','accepted','delivered','unknown')`, [runKey]));
    if (Number(runSends?.total || 0) >= config.perRunCap) {
      throw Object.assign(new Error("Controlled-test per-run cap reached."), { code: "BOOK_FEATURE_RUN_CAP" });
    }
    const sends = first(await this.d1.query(`SELECT COUNT(*) AS total FROM book_feature_outbox
      WHERE created_at>=? AND status IN ('queued','leased','accepted','delivered','unknown')`, [dayStart.toISOString()]));
    if (Number(sends?.total || 0) >= config.dailyCap) throw Object.assign(new Error("Controlled-test daily cap reached."), { code: "BOOK_FEATURE_DAILY_CAP" });
    const row = first(await this.d1.query(`SELECT o.id,o.contact_id,o.gate_json,c.email,c.validation_result,c.validation_expires_at,g.official_domain,
      c.eligibility_status,p.id AS pitch_id,p.subject,p.body_key,q.rubric_version
      FROM book_feature_opportunities o JOIN book_feature_contacts c ON c.id=o.contact_id
      JOIN book_feature_organisations g ON g.id=o.organisation_id
      JOIN book_feature_pitch_versions p ON p.opportunity_id=o.id
      JOIN book_feature_qa_reviews q ON q.pitch_version_id=p.id AND q.passed=1
      WHERE o.id=? AND o.state='qa_passed' ORDER BY p.version DESC LIMIT 1`, [opportunityId]));
    if (!row || row.validation_result !== "valid" ||
        row.eligibility_status !== "eligible" || !(Date.parse(row.validation_expires_at) > now.getTime())) {
      throw Object.assign(new Error("Contact or QA eligibility changed before queueing."), { code: "BOOK_FEATURE_ELIGIBILITY_EXPIRED" });
    }
    const suppressed = first(await this.d1.query(`SELECT id FROM comms_hub_outreach_suppression WHERE lower(email)=? OR
      (domain<>'' AND lower(domain)=?) OR lower(email)=? OR
      (domain<>'' AND lower(domain)=?) LIMIT 1`, [email,email.split("@")[1],normalisedEmail(row.email),row.official_domain]));
    if (suppressed) throw Object.assign(new Error("Recipient is suppressed."), { code: "BOOK_FEATURE_SUPPRESSED" });
    const reservation = await this.reserveTarget({ opportunityId, email, domain: row.official_domain });
    if (!reservation.acquired) throw Object.assign(new Error("Target is reserved by another campaign."), { code: "OUTREACH_TARGET_RESERVED" });
    const outboxId = createHash("sha256").update(`book-feature-outbox\u001f${idempotencyKey}`).digest("hex");
    const result = await this.d1.batch([
      { sql: `INSERT OR IGNORE INTO book_feature_outbox
        (id,opportunity_id,contact_id,idempotency_key,status,not_before,expires_at,qa_version,created_at,updated_at,
         next_attempt_at,subject,body_key,campaign_type,delivery_recipient,run_key)
        SELECT ?,?,?,?,'queued',?,?,?,?,?,?,?,?, 'book_feature',?,?
        WHERE EXISTS (SELECT 1 FROM book_feature_configuration WHERE singleton=1 AND version=? AND mode='controlled_test' AND kill_switch=0)
        AND (SELECT COUNT(*) FROM book_feature_outbox WHERE run_key=? AND status IN ('queued','leased','accepted','delivered','unknown')) < ?
        AND (SELECT COUNT(*) FROM book_feature_outbox WHERE created_at>=? AND status IN ('queued','leased','accepted','delivered','unknown')) < ?`,
        params: [outboxId,opportunityId,row.contact_id,idempotencyKey,notBefore.toISOString(),expiry.toISOString(),
          row.rubric_version,at,at,notBefore.toISOString(),row.subject,row.body_key,email,runKey,
          config.version,runKey,config.perRunCap,dayStart.toISOString(),config.dailyCap] },
      { sql: `UPDATE book_feature_opportunities SET state='queued',gate_json=json_set(gate_json,'$.authorisation',json('true'),
          '$.duplicate',json('true')),reason='controlled_test_queued',updated_at=? WHERE id=? AND state='qa_passed' AND changes()=1`, params: [at,opportunityId] },
      { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
        SELECT ?,'outbox',?,'controlled_test_queued',?,?,? WHERE changes()=1`,
        params: [this.leaseId(),outboxId,config.approvalActor || "operator",JSON.stringify({ recipient: email,
          configurationVersion: config.version, idempotencyKey, runKey }),at] },
    ]);
    if (changes(result[0]) !== 1) {
      const existing = first(await this.d1.query("SELECT * FROM book_feature_outbox WHERE idempotency_key=?", [idempotencyKey]));
      if (!existing) throw Object.assign(new Error("Queue admission changed."), { code: "BOOK_FEATURE_QUEUE_ADMISSION" });
      return { duplicate: true, outbox: existing };
    }
    return { duplicate: false, outbox: first(await this.d1.query("SELECT * FROM book_feature_outbox WHERE id=?", [outboxId])) };
  }

  async claimOutbox({ owner = this.leaseId(), leaseMs = 2 * 60_000 } = {}) {
    const now = this.now();
    const at = now.toISOString();
    // A crashed worker may have handed off its message before losing its lease.
    // Never make such a message sendable again without delivery reconciliation.
    await this.d1.query(`UPDATE book_feature_outbox SET status='unknown',failure_class='uncertain',
      last_error_code='dispatch_lease_expired',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE status='leased' AND (lease_expires_at IS NULL OR lease_expires_at<=?)`, [at,at]);
    const config = await this.mode();
    if (!(["controlled_test","pilot"].includes(config.effective)) || config.killSwitch) return null;
    const expires = new Date(now.getTime() + leaseMs).toISOString();
    const candidate = first(await this.d1.query(`SELECT id FROM book_feature_outbox WHERE status='queued'
      AND not_before<=? AND expires_at>? AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      AND attempt_count<max_attempts ORDER BY created_at LIMIT 1`, [at,at,at]));
    if (!candidate) return null;
    const claimed = await this.d1.query(`UPDATE book_feature_outbox SET status='leased',lease_owner=?,lease_expires_at=?,
      attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status='queued' AND not_before<=? AND expires_at>?
      AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND attempt_count<max_attempts RETURNING *`,
      [owner,expires,at,candidate.id,at,at,at]);
    return first(claimed);
  }

  async finishOutboxLease(lease, outcome) {
    const allowed = new Set(["accepted","delivered","unknown","bounced","cancelled","quarantined","queued"]);
    if (!lease?.id || !lease?.lease_owner || !allowed.has(outcome.status)) throw new Error("Valid outbox lease and outcome are required.");
    const at = this.now().toISOString();
    const result = await this.d1.query(`UPDATE book_feature_outbox SET status=?,provider_message_id=?,accepted_at=?,delivered_at=?,
      failure_class=?,last_error_code=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND status='leased' AND lease_owner=? AND lease_expires_at>?`, [outcome.status,outcome.providerMessageId || null,
      outcome.acceptedAt || null,outcome.deliveredAt || null,outcome.failureClass || null,outcome.errorCode || null,
      outcome.nextAttemptAt || null,at,lease.id,lease.lease_owner,at]);
    if (changes(result) !== 1) throw new Error("Outbox lease expired or was taken.");
  }

  async outboxDispatchContext(outboxId) {
    return first(await this.d1.query(`SELECT b.*,COALESCE(b.delivery_recipient,c.email) AS email,c.email AS intended_email,
      c.validation_result,c.validation_expires_at,c.eligibility_status,
      c.display_name,c.role,o.state AS opportunity_state,o.campaign_id,g.official_domain,g.canonical_name
      FROM book_feature_outbox b JOIN book_feature_contacts c ON c.id=b.contact_id
      JOIN book_feature_opportunities o ON o.id=b.opportunity_id
      JOIN book_feature_organisations g ON g.id=o.organisation_id WHERE b.id=?`, [outboxId]));
  }

  async cancelPendingForKillSwitch(actor = "environment_or_operator") {
    const at = this.now().toISOString();
    const result = await this.d1.query(`UPDATE book_feature_outbox SET status=CASE WHEN status='leased' THEN 'unknown' ELSE 'cancelled' END,
      failure_class=CASE WHEN status='leased' THEN 'uncertain' ELSE 'policy' END,
      last_error_code='kill_switch',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE status IN ('queued','leased')`, [at]);
    await this.d1.query(`INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
      VALUES (?,'configuration','1','kill_switch_cancelled_pending',?,?,?)`, [this.leaseId(),actor,
      JSON.stringify({ cancelled: changes(result) }),at]);
    return { cancelled: changes(result) };
  }

  async recordDeliveryEvent({ outboxId, providerEventId, eventType, providerMessageId = null, occurredAt, evidence = {} }) {
    const id = createHash("sha256").update(`delivery-event\u001f${providerEventId}`).digest("hex");
    const at = this.now().toISOString();
    const result = await this.d1.query(`INSERT OR IGNORE INTO outreach_delivery_events
      (id,outbox_id,provider_event_id,event_type,provider_message_id,occurred_at,evidence_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`, [id,outboxId,providerEventId,eventType,providerMessageId,occurredAt || at,JSON.stringify(evidence),at]);
    return { duplicate: changes(result) !== 1, id };
  }

  async reconcileOutbox({ outboxId, outcome, providerEventId, providerMessageId = null, actor, evidence = {} }) {
    if (!["delivered","bounced","failed","unknown"].includes(outcome) || !actor || !providerEventId) {
      throw new Error("A supported reconciliation outcome, actor and provider event are required.");
    }
    const status = outcome === "failed" ? "quarantined" : outcome;
    const at = this.now().toISOString();
    const current = first(await this.d1.query("SELECT status FROM book_feature_outbox WHERE id=?", [outboxId]));
    if (!current || !["accepted","unknown",status].includes(current.status)) throw new Error("Outbox item is not awaiting reconciliation.");
    const event = await this.recordDeliveryEvent({ outboxId, providerEventId, eventType: outcome === "failed" ? "failed" : outcome,
      providerMessageId, occurredAt: at, evidence });
    if (!event.duplicate) await this.d1.batch([
      { sql: `UPDATE book_feature_outbox SET status=?,provider_message_id=COALESCE(?,provider_message_id),
          delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END,updated_at=? WHERE id=?`,
        params: [status,providerMessageId,status,at,at,outboxId] },
      { sql: `UPDATE book_feature_opportunities SET state=CASE WHEN ?='delivered' THEN 'awaiting_reply'
          WHEN ?='bounced' THEN 'blocked' ELSE state END,reason=?,updated_at=? WHERE id=(SELECT opportunity_id FROM book_feature_outbox WHERE id=?)`,
        params: [status,status,`delivery_${status}`,at,outboxId] },
      { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
          VALUES (?,'outbox',?,'delivery_reconciled',?,?,?)`, params: [this.leaseId(),outboxId,actor,
          JSON.stringify({ outcome: status, providerEventId, providerMessageId }),at] },
    ]);
    return { duplicate: event.duplicate, status };
  }

  async processInboundEvent({ providerEventId, providerMessageId = null, opportunityId = null, contactId = null,
    category, authenticated, bodyEvidenceKey = null, occurredAt }) {
    const allowed = new Set(["positive","question","decline","opt_out","out_of_office","paid_placement","revision","publication","bounce","uncertain","malformed"]);
    if (!authenticated || !providerEventId || !allowed.has(category)) throw new Error("Authenticated inbound event and supported category are required.");
    const at = this.now().toISOString();
    const id = createHash("sha256").update(`outreach-inbound\u001f${providerEventId}`).digest("hex");
    const inserted = await this.d1.query(`INSERT OR IGNORE INTO outreach_inbound_events
      (id,provider_event_id,provider_message_id,opportunity_id,contact_id,category,authenticated,body_evidence_key,occurred_at,processed_at,action_json)
      VALUES (?,?,?,?,?,?,1,?,?,?,?)`, [id,providerEventId,providerMessageId,opportunityId,contactId,category,
      bodyEvidenceKey,occurredAt || at,at,JSON.stringify({ automaticReply: false })]);
    if (changes(inserted) !== 1) return { duplicate: true, action: "none" };
    if (!opportunityId) return { duplicate: false, action: "unmatched_preserved" };
    const context = first(await this.d1.query(`SELECT o.id,o.organisation_id,o.contact_id,c.email,g.official_domain
      FROM book_feature_opportunities o LEFT JOIN book_feature_contacts c ON c.id=o.contact_id
      JOIN book_feature_organisations g ON g.id=o.organisation_id WHERE o.id=?`, [opportunityId]));
    if (!context) return { duplicate: false, action: "unmatched_preserved" };
    if (["opt_out","decline","bounce"].includes(category)) {
      const reason = category === "bounce" ? "bounce" : category;
      const suppressionId = createHash("sha256").update(`osup\u001f${normalisedEmail(context.email)}\u001f${context.official_domain}`).digest("hex");
      await this.d1.batch([
        { sql: `INSERT INTO comms_hub_outreach_suppression (id,email,domain,reason,source,created_at,metadata_json)
          VALUES (?,?,?,?, 'book_feature_inbound',?,?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason,
          source=excluded.source,metadata_json=excluded.metadata_json`, params: [suppressionId,normalisedEmail(context.email),
          context.official_domain,reason,at,JSON.stringify({ providerEventId })] },
        { sql: `UPDATE book_feature_opportunities SET state=?,reason=?,updated_at=? WHERE id=?`,
          params: [category === "decline" ? "declined" : "suppressed",`inbound_${category}`,at,opportunityId] },
        { sql: `UPDATE book_feature_outbox SET status='cancelled',failure_class='policy',last_error_code=?,updated_at=?
          WHERE opportunity_id=? AND status IN ('queued','leased')`, params: [`inbound_${category}`,at,opportunityId] },
        { sql: `UPDATE outreach_target_reservations SET status='suppressed',released_at=?,reason=? WHERE opportunity_id=? AND status='active'`,
          params: [at,`inbound_${category}`,opportunityId] },
      ]);
      return { duplicate: false, action: "suppressed_and_cancelled" };
    }
    const nextState = category === "publication" ? "outcome_verified" : ["positive","question","revision"].includes(category) ? "engaged" : "awaiting_reply";
    await this.d1.query("UPDATE book_feature_opportunities SET state=?,reason=?,updated_at=? WHERE id=?",
      [nextState,`inbound_${category}`,at,opportunityId]);
    return { duplicate: false, action: category === "uncertain" ? "operator_review" : "state_updated", state: nextState };
  }

  async findOpportunityByProviderMessage(providerMessageId) {
    if (!providerMessageId) return null;
    return first(await this.d1.query(`SELECT opportunity_id,contact_id,status FROM book_feature_outbox
      WHERE provider_message_id=? ORDER BY updated_at DESC LIMIT 1`, [providerMessageId]));
  }

  async campaign(week, book, selection) {
    if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error("Invalid ISO week.");
    const at = this.now().toISOString();
    const id = `book-feature:${week}`;
    await this.d1.query(`INSERT OR IGNORE INTO book_feature_campaigns
      (id,iso_week,ebook_id,title,author,canonical_url,cover_url,manuscript_key,selection_json,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'selected',?,?)`,
    [id, week, book.ebookId, book.title, book.author || "", book.bookUrl, book.coverArtUrl || "",
      book.manuscriptR2Key, JSON.stringify(selection || {}), at, at]);
    const current = first(await this.d1.query("SELECT * FROM book_feature_campaigns WHERE iso_week=?", [week]));
    if (!current || Number(current.ebook_id) !== book.ebookId || current.title !== book.title ||
        current.author !== (book.author || "") || current.canonical_url !== book.bookUrl ||
        current.cover_url !== (book.coverArtUrl || "") || current.manuscript_key !== book.manuscriptR2Key ||
        current.selection_json !== JSON.stringify(selection || {})) {
      throw new Error("Weekly featured-book selection changed; campaign requires authoritative reconciliation.");
    }
    return current;
  }

  async claimOccurrence(occurrence, campaignId) {
    const at = this.now();
    const now = at.toISOString();
    const expires = new Date(at.getTime() + this.leaseMs).toISOString();
    const owner = this.leaseId();
    const result = await this.d1.batch([
      { sql: `INSERT OR IGNORE INTO book_feature_occurrences
        (id,campaign_id,local_date,weekday,status,attempts,created_at,updated_at)
        VALUES (?,?,?,?, 'failed',0,?,?)`, params: [occurrence.id,campaignId,occurrence.localDate,occurrence.day,now,now] },
      { sql: `UPDATE book_feature_occurrences
        SET status='leased',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
        WHERE id=? AND campaign_id=? AND attempts<3
          AND (status IN ('failed','blocked') OR (status='leased' AND lease_expires_at<=?))`,
        params: [owner,expires,now,occurrence.id,campaignId,now] },
    ]);
    return changes(result[1]) === 1 ? { id: occurrence.id, owner, expiresAt: expires } : null;
  }

  async getOccurrence(id) {
    return first(await this.d1.query("SELECT * FROM book_feature_occurrences WHERE id=?", [id]));
  }

  async renewOccurrence(lease) {
    if (!lease?.id || !lease?.owner) throw new TypeError("A valid Book Feature occurrence lease is required.");
    const now = this.now();
    const at = now.toISOString();
    const expires = new Date(now.getTime() + this.leaseMs).toISOString();
    const result = await this.d1.query(`UPDATE book_feature_occurrences
      SET lease_expires_at=?,updated_at=?
      WHERE id=? AND status='leased' AND lease_owner=? AND lease_expires_at>?`,
    [expires, at, lease.id, lease.owner, at]);
    if (changes(result) !== 1) return false;
    lease.expiresAt = expires;
    return true;
  }

  async assertOccurrenceOwned(lease) {
    if (!lease?.id || !lease?.owner) return false;
    const row = await this.getOccurrence(lease.id);
    return row?.status === "leased" && row.lease_owner === lease.owner &&
      Date.parse(row.lease_expires_at || "") > this.now().getTime();
  }

  async recordCandidateEvidence(campaignId, manuscriptSha256, candidates = [], sourcePages = []) {
    if (!campaignId || !/^[a-f0-9]{64}$/i.test(String(manuscriptSha256 || "")) ||
        !Array.isArray(candidates) || !Array.isArray(sourcePages)) {
      throw new TypeError("Campaign ID, manuscript SHA-256 and candidate evidence are required.");
    }
    const pages = new Map(sourcePages.map((page) => [Number(page?.pdfPage), page]));
    const statements = [];
    for (const candidate of candidates) {
      const name = String(candidate?.name || "").trim();
      if (!name || name.length > 200 || !Array.isArray(candidate.occurrences)) continue;
      for (const occurrence of candidate.occurrences) {
        const page = Number(occurrence?.pdfPage);
        const offset = Number(occurrence?.offset);
        const nameOffset = Number(occurrence?.nameOffsetInPassage);
        // Preserve the passage byte-for-byte: nameOffsetInPassage is relative to
        // the original slice and trimming leading whitespace would shift it.
        const passage = String(occurrence?.passage || "");
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset) || offset < 0 ||
            !Number.isSafeInteger(nameOffset) || nameOffset < 0 || nameOffset > passage.length - name.length ||
            passage.length < 20 || passage.length > 2000 ||
            passage.slice(nameOffset, nameOffset + name.length).toLowerCase() !== name.toLowerCase()) continue;
        const sourcePage = pages.get(page);
        if (typeof sourcePage?.text !== "string" || !Number.isSafeInteger(sourcePage.textOffsetStart)) continue;
        const localNameOffset = offset - sourcePage.textOffsetStart;
        const passageStart = localNameOffset - nameOffset;
        if (passageStart < 0 || !matchedPassage(sourcePage.text.slice(passageStart, passageStart + passage.length), passage)) continue;
        const id = createHash("sha256").update([campaignId, manuscriptSha256.toLowerCase(), page, offset, name.toLowerCase()].join("\u001f")).digest("hex");
        statements.push({ sql: `INSERT OR IGNORE INTO book_feature_evidence
          (id,campaign_id,organisation_id,manuscript_sha256,pdf_page,text_offset,passage,validation,evidence_class,created_at)
          VALUES (?,?,NULL,?,?,?,?, 'candidate','direct',?)`,
          params: [id,campaignId,manuscriptSha256.toLowerCase(),page,offset,passage,this.now().toISOString()] });
      }
    }
    if (!statements.length) return { attempted: 0, recorded: 0 };
    let recorded = 0;
    for (let offset = 0; offset < statements.length; offset += 100) {
      const result = await this.d1.batch(statements.slice(offset, offset + 100));
      recorded += result.reduce((sum, item) => sum + changes(item), 0);
    }
    return { attempted: statements.length, recorded };
  }

  async overview() {
    const campaigns = (await this.d1.query(`SELECT id,iso_week,ebook_id,title,state,manuscript_sha256,updated_at
      FROM book_feature_campaigns ORDER BY iso_week DESC LIMIT 10`)).results || [];
    const occurrences = (await this.d1.query(`SELECT id,campaign_id,local_date,weekday,status,attempts,error_code,updated_at
      FROM book_feature_occurrences ORDER BY local_date DESC LIMIT 20`)).results || [];
    const opportunities = first(await this.d1.query(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN state IN ('qualified','eligible','drafted','qa_passed','queued','sent','awaiting_reply','engaged','developing','outcome_verified') THEN 1 ELSE 0 END) AS qualified
      FROM book_feature_opportunities`));
    const evidence = first(await this.d1.query(`SELECT COUNT(*) AS candidates,
      SUM(CASE WHEN validation='validated' THEN 1 ELSE 0 END) AS validated
      FROM book_feature_evidence`));
    const outbox = first(await this.d1.query(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) AS bounced,
      SUM(CASE WHEN status IN ('quarantined','cancelled') THEN 1 ELSE 0 END) AS blocked
      FROM book_feature_outbox`));
    const recentOutbox = (await this.d1.query(`SELECT id,status,attempt_count,max_attempts,accepted_at,delivered_at,
      failure_class,last_error_code,created_at,updated_at FROM book_feature_outbox
      ORDER BY created_at DESC LIMIT 20`)).results || [];
    const costs = first(await this.d1.query(`SELECT SUM(CASE WHEN cost_status='measured' THEN measured_cost_usd ELSE 0 END) AS measured,
      SUM(CASE WHEN cost_status='measured' THEN 1 ELSE 0 END) AS measured_rows,
      SUM(CASE WHEN cost_status<>'measured' THEN 1 ELSE 0 END) AS unknown_rows,
      SUM(COALESCE(input_tokens,0)) AS input_tokens,SUM(COALESCE(output_tokens,0)) AS output_tokens
      FROM outreach_cost_ledger WHERE campaign_type='book_feature'`));
    const delivered = Number(outbox?.delivered || 0);
    const accepted = Number(outbox?.accepted || 0);
    return { campaigns, occurrences, opportunities: { total: Number(opportunities?.total || 0), qualified: Number(opportunities?.qualified || 0) },
      evidence: { candidateReferences: Number(evidence?.candidates || 0), validatedReferences: Number(evidence?.validated || 0) },
      outbox: { total: Number(outbox?.total || 0), queued: Number(outbox?.queued || 0), unknown: Number(outbox?.unknown || 0),
        accepted, delivered, bounced: Number(outbox?.bounced || 0), blocked: Number(outbox?.blocked || 0), recent: recentOutbox },
      dispatched: accepted + delivered, delivered, responses: null, meaningfulEngagement: null,
      cost: { measuredUsd: Number(costs?.measured_rows || 0) ? Number(costs.measured || 0) : null,
        unknownItems: Number(costs?.unknown_rows || 0), inputTokens: Number(costs?.input_tokens || 0),
        outputTokens: Number(costs?.output_tokens || 0), status: Number(costs?.unknown_rows || 0) ? "partial" :
          Number(costs?.measured_rows || 0) ? "measured" : "not_measured" },
      actualCostUsd: Number(costs?.measured_rows || 0) ? Number(costs.measured || 0) : null,
      costPerQualifiedOpportunity: Number(costs?.measured_rows || 0) && Number(opportunities?.qualified || 0)
        ? Number(costs.measured) / Number(opportunities.qualified) : null,
      costPerMeaningfulEngagement: null, deliveryRate: (accepted + delivered) ? delivered / (accepted + delivered) : null,
      responseRate: null, attribution: Number(costs?.measured_rows || 0) ? "partial" : "unavailable",
      evidenceStatus: Number(outbox?.total || 0) ? "dispatch_evidence_available" : "pre_dispatch" };
  }

  async finishOccurrence(lease, state, { reportKey = null, errorCode = null } = {}) {
    if (!["completed", "completed_zero", "blocked", "failed"].includes(state)) throw new Error("Invalid occurrence terminal state.");
    const at = this.now().toISOString();
    const result = await this.d1.query(`UPDATE book_feature_occurrences SET status=?,report_key=?,error_code=?,
      lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_owner=? AND lease_expires_at>?`,
    [state,reportKey,errorCode,at,lease.id,lease.owner,at]);
    if (changes(result) !== 1) throw new Error("Occurrence lease expired or was taken by another worker.");
  }
}
