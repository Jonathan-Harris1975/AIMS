import { randomUUID } from "node:crypto";
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
        current.canonical_url !== book.bookUrl || current.manuscript_key !== book.manuscriptR2Key) {
      throw new Error("Weekly featured-book selection changed; campaign requires authoritative reconciliation.");
    }
    return current;
  }

  async claimOccurrence(occurrence, campaignId) {
    const at = this.now();
    const now = at.toISOString();
    const expires = new Date(at.getTime() + 15 * 60_000).toISOString();
    const owner = this.leaseId();
    await this.d1.query(`INSERT OR IGNORE INTO book_feature_occurrences
      (id,campaign_id,local_date,weekday,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?, 'failed',0,?,?)`, [occurrence.id,campaignId,occurrence.localDate,occurrence.day,now,now]);
    const result = await this.d1.query(`UPDATE book_feature_occurrences
      SET status='leased',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
      WHERE id=? AND campaign_id=? AND attempts<3
        AND (status IN ('failed','blocked') OR (status='leased' AND lease_expires_at<=?))`,
    [owner,expires,now,occurrence.id,campaignId,now]);
    return changes(result) === 1 ? { id: occurrence.id, owner, expiresAt: expires } : null;
  }

  async getOccurrence(id) {
    return first(await this.d1.query("SELECT * FROM book_feature_occurrences WHERE id=?", [id]));
  }

  async finishOccurrence(lease, state, { reportKey = null, errorCode = null } = {}) {
    if (!["completed", "completed_zero", "blocked", "failed"].includes(state)) throw new Error("Invalid occurrence terminal state.");
    const result = await this.d1.query(`UPDATE book_feature_occurrences SET status=?,report_key=?,error_code=?,
      lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='leased' AND lease_owner=?`,
    [state,reportKey,errorCode,this.now().toISOString(),lease.id,lease.owner]);
    if (changes(result) !== 1) throw new Error("Occurrence lease expired or was taken by another worker.");
  }
}
