import { createHash, randomUUID } from "node:crypto";
import { effectiveMode } from "./core.js";

const first = (response) => response?.results?.[0] || null;
const changes = (response) => Number(response?.meta?.changes || 0);

export class BookFeatureRepository {
  constructor(d1, { now = () => new Date(), leaseId = randomUUID } = {}) {
    this.d1 = d1;
    this.now = now;
    this.leaseId = leaseId;
  }

  async mode(env = process.env) {
    const row = first(await this.d1.query("SELECT mode,version,updated_at FROM book_feature_configuration WHERE singleton=1"));
    if (!row) throw new Error("Book Feature configuration migration has not been applied.");
    return { persisted: row.mode, effective: effectiveMode(env.BOOK_FEATURE_OUTREACH_MODE, row.mode),
      version: row.version, updatedAt: row.updated_at };
  }

  async transitionMode(next, actor, expectedVersion) {
    // A production-mode transition is reserved for a later, fully accepted dispatch implementation.
    if (!["disabled", "assessment", "shadow", "suspended"].includes(next)) throw new Error("Production modes require separate pilot acceptance.");
    if (!actor || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("An actor and configuration version are required.");
    const at = this.now().toISOString();
    const id = this.leaseId();
    const result = await this.d1.batch([
      { sql: `UPDATE book_feature_configuration SET mode=?,updated_at=?,updated_by=?,version=version+1
              WHERE singleton=1 AND version=?`, params: [next, at, actor, expectedVersion] },
      { sql: `INSERT INTO book_feature_audit (id,entity_type,entity_id,action,actor,evidence_json,created_at)
              SELECT ?,'configuration','1','mode_transition',?,?,? WHERE changes()=1`,
        params: [id, actor, JSON.stringify({ next, expectedVersion }), at] },
    ]);
    if (changes(result[0]) !== 1) throw new Error("Configuration version changed; mode transition rejected.");
    return this.mode();
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
    const expires = new Date(at.getTime() + 15 * 60_000).toISOString();
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

  async recordCandidateEvidence(campaignId, manuscriptSha256, candidates = []) {
    if (!campaignId || !/^[a-f0-9]{64}$/i.test(String(manuscriptSha256 || "")) || !Array.isArray(candidates)) {
      throw new TypeError("Campaign ID, manuscript SHA-256 and candidate evidence are required.");
    }
    const statements = [];
    for (const candidate of candidates) {
      const name = String(candidate?.name || "").trim();
      if (!name || name.length > 200 || !Array.isArray(candidate.occurrences)) continue;
      for (const occurrence of candidate.occurrences) {
        const page = Number(occurrence?.pdfPage);
        const offset = Number(occurrence?.offset);
        const passage = String(occurrence?.passage || "").trim();
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset) || offset < 0 ||
            passage.length < 20 || passage.length > 2000 || !passage.toLowerCase().includes(name.toLowerCase())) continue;
        const id = createHash("sha256").update([campaignId, manuscriptSha256.toLowerCase(), page, offset, name.toLocaleLowerCase()].join("\u001f")).digest("hex");
        statements.push({ sql: `INSERT OR IGNORE INTO book_feature_evidence
          (id,campaign_id,organisation_id,manuscript_sha256,pdf_page,text_offset,passage,validation,evidence_class,created_at)
          VALUES (?,?,NULL,?,?,?,?, 'candidate','direct',?)`,
          params: [id,campaignId,manuscriptSha256.toLowerCase(),page,offset,passage,this.now().toISOString()] });
      }
    }
    if (!statements.length) return { attempted: 0, recorded: 0 };
    const result = await this.d1.batch(statements);
    return { attempted: statements.length, recorded: result.reduce((sum, item) => sum + changes(item), 0) };
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
    return { campaigns, occurrences, opportunities: { total: Number(opportunities?.total || 0), qualified: Number(opportunities?.qualified || 0) },
      evidence: { candidateReferences: Number(evidence?.candidates || 0), validatedReferences: Number(evidence?.validated || 0) },
      dispatched: 0, delivered: null, responses: null, meaningfulEngagement: null,
      actualCostUsd: null, costPerQualifiedOpportunity: null, costPerMeaningfulEngagement: null,
      deliveryRate: null, responseRate: null, attribution: "unavailable", evidenceStatus: "pre_dispatch" };
  }

  async finishOccurrence(lease, state, { reportKey = null, errorCode = null } = {}) {
    if (!["completed", "completed_zero", "blocked", "failed"].includes(state)) throw new Error("Invalid occurrence terminal state.");
    const result = await this.d1.query(`UPDATE book_feature_occurrences SET status=?,report_key=?,error_code=?,
      lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_owner=?`,
    [state,reportKey,errorCode,this.now().toISOString(),lease.id,lease.owner]);
    if (changes(result) !== 1) throw new Error("Occurrence lease expired or was taken by another worker.");
  }
}
