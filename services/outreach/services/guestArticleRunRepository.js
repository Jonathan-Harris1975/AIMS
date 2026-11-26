import { randomUUID } from "node:crypto";

const first = (result) => result?.results?.[0] || null;
const changes = (result) => Number(result?.meta?.changes || 0);

export class GuestArticleRunRepository {
  constructor(d1, { now = () => new Date(), leaseId = randomUUID, leaseMs = 15 * 60_000 } = {}) {
    if (!d1?.query || !d1?.batch) throw new TypeError("A durable Comms Hub D1 binding is required.");
    this.d1 = d1;
    this.now = now;
    this.leaseId = leaseId;
    this.leaseMs = leaseMs;
  }

  async claim(localDate, triggerRunKey = "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDate || "")) ||
        Number.isNaN(Date.parse(`${localDate}T00:00:00Z`))) throw new TypeError("A valid London local date is required.");
    const now = this.now();
    const at = now.toISOString();
    const expiry = new Date(now.getTime() + this.leaseMs).toISOString();
    const occurrenceId = `guest-article:${localDate}`;
    const owner = this.leaseId();
    const key = String(triggerRunKey || "").slice(0, 200) || null;
    const result = await this.d1.batch([
      { sql: `INSERT OR IGNORE INTO comms_hub_guest_article_runs
        (occurrence_id,local_date,status,attempts,created_at,updated_at)
        VALUES (?,?,'failed',0,?,?)`, params: [occurrenceId, localDate, at, at] },
      { sql: `UPDATE comms_hub_guest_article_runs
        SET status='leased',trigger_run_key=?,lease_owner=?,lease_expires_at=?,
            attempts=attempts+1,started_at=COALESCE(started_at,?),completed_at=NULL,
            error_code=NULL,updated_at=?
        WHERE occurrence_id=? AND attempts<3
          AND (status='failed' OR (status='leased' AND lease_expires_at<=?))`,
        params: [key, owner, expiry, at, at, occurrenceId, at] },
    ]);
    if (changes(result?.[1]) === 1) return { acquired: true, occurrenceId, owner, expiresAt: expiry,
      attempt: Number((await this.get(occurrenceId))?.attempts || 1) };
    const existing = await this.get(occurrenceId);
    const completed = ["completed", "completed_zero", "blocked"].includes(existing?.status);
    let previousResult = null;
    try { previousResult = existing?.result_json ? JSON.parse(existing.result_json) : null; } catch {}
    return { acquired: false, occurrenceId, status: existing?.status || "unknown", completed,
      attempts: Number(existing?.attempts || 0), result: previousResult };
  }

  async get(occurrenceId) {
    return first(await this.d1.query(
      "SELECT * FROM comms_hub_guest_article_runs WHERE occurrence_id=?",
      [occurrenceId]
    ));
  }

  async renew(lease) {
    if (!lease?.occurrenceId || !lease?.owner) throw new TypeError("A valid Guest Article lease is required.");
    const now = this.now();
    const at = now.toISOString();
    const expiry = new Date(now.getTime() + this.leaseMs).toISOString();
    const response = await this.d1.query(`UPDATE comms_hub_guest_article_runs
      SET lease_expires_at=?,updated_at=?
      WHERE occurrence_id=? AND status='leased' AND lease_owner=? AND lease_expires_at>?`,
    [expiry, at, lease.occurrenceId, lease.owner, at]);
    if (changes(response) !== 1) return false;
    lease.expiresAt = expiry;
    return true;
  }

  async assertOwned(lease) {
    if (!lease?.occurrenceId || !lease?.owner) return false;
    const row = await this.get(lease.occurrenceId);
    return row?.status === "leased" && row.lease_owner === lease.owner &&
      Date.parse(row.lease_expires_at || "") > this.now().getTime();
  }

  async finish(lease, status, { result = null, errorCode = null } = {}) {
    if (!lease?.occurrenceId || !lease?.owner ||
        !["completed", "completed_zero", "blocked", "failed"].includes(status)) {
      throw new TypeError("A valid lease and terminal run status are required.");
    }
    const at = this.now().toISOString();
    const response = await this.d1.query(`UPDATE comms_hub_guest_article_runs
      SET status=?,result_json=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,
          completed_at=?,updated_at=?
      WHERE occurrence_id=? AND status='leased' AND lease_owner=?`,
    [status, result ? JSON.stringify(result) : null, errorCode ? String(errorCode).slice(0, 100) : null,
      at, at, lease.occurrenceId, lease.owner]);
    if (changes(response) !== 1) throw new Error("Guest Article run lease expired or was taken by another worker.");
    return this.get(lease.occurrenceId);
  }
}
