import { stableId } from "../../comms-hub/domain/ids.js";

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function json(value) {
  return JSON.stringify(value ?? {});
}

export class OutreachRepository {
  constructor(d1) {
    this.d1 = d1;
  }

  async isSuppressed(email, domain = "") {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_outreach_suppression
        WHERE LOWER(email) = LOWER(?) OR (domain <> '' AND LOWER(domain) = LOWER(?))
        LIMIT 1`,
      [email || "", domain || ""]
    );
    return rows(result)[0] || null;
  }

  async suppress({ email = "", domain = "", reason = "opt_out", source = "outreach", metadata = {} } = {}) {
    const at = new Date().toISOString();
    const id = stableId("osup", String(email).toLowerCase(), String(domain).toLowerCase());
    await this.d1.query(
      `INSERT INTO comms_hub_outreach_suppression
        (id, email, domain, reason, source, created_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, source = excluded.source,
         metadata_json = excluded.metadata_json`,
      [id, String(email || "").toLowerCase(), String(domain || "").toLowerCase(), reason, source, at, json(metadata)]
    );
    return { id, email, domain, reason, createdAt: at };
  }

  async getTargetByEmail(email) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_outreach_targets WHERE LOWER(email) = LOWER(?) ORDER BY updated_at DESC LIMIT 1`,
      [email]
    );
    return rows(result)[0] || null;
  }

  async getTargetByConversation(conversationId) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_outreach_targets WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [conversationId]
    );
    return rows(result)[0] || null;
  }

  async upsertTarget(target) {
    const at = new Date().toISOString();
    const id = target.id || stableId("otgt", String(target.email || "").toLowerCase(), String(target.domain || "").toLowerCase());
    const existing = await this.getTargetByEmail(target.email);
    await this.d1.query(
      `INSERT INTO comms_hub_outreach_targets
        (id, keyword, domain, email, recipient_type, state, conversation_id, source_url, source_title,
         follow_up_count, last_sent_at, last_reply_at, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         keyword = excluded.keyword, domain = excluded.domain, recipient_type = excluded.recipient_type,
         state = excluded.state, conversation_id = COALESCE(excluded.conversation_id, comms_hub_outreach_targets.conversation_id),
         source_url = COALESCE(excluded.source_url, comms_hub_outreach_targets.source_url),
         source_title = COALESCE(excluded.source_title, comms_hub_outreach_targets.source_title),
         follow_up_count = excluded.follow_up_count,
         last_sent_at = COALESCE(excluded.last_sent_at, comms_hub_outreach_targets.last_sent_at),
         last_reply_at = COALESCE(excluded.last_reply_at, comms_hub_outreach_targets.last_reply_at),
         updated_at = excluded.updated_at, metadata_json = excluded.metadata_json`,
      [
        id, target.keyword || existing?.keyword || "", target.domain || existing?.domain || "", target.email,
        target.recipientType || existing?.recipient_type || "unknown", target.state || existing?.state || "discovered",
        target.conversationId || existing?.conversation_id || null, target.sourceUrl || existing?.source_url || null,
        target.sourceTitle || existing?.source_title || null, Number(target.followUpCount ?? existing?.follow_up_count ?? 0),
        target.lastSentAt || existing?.last_sent_at || null, target.lastReplyAt || existing?.last_reply_at || null,
        existing?.created_at || at, at, json(target.metadata || {})
      ]
    );
    return { id, ...(await this.getTargetByEmail(target.email)) };
  }

  async updateTarget(id, patch = {}) {
    const allowed = {
      state: "state", conversationId: "conversation_id", followUpCount: "follow_up_count",
      lastSentAt: "last_sent_at", lastReplyAt: "last_reply_at", sourceUrl: "source_url", sourceTitle: "source_title",
    };
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(patch[key]);
    }
    if (patch.metadata !== undefined) {
      sets.push("metadata_json = ?");
      params.push(json(patch.metadata));
    }
    if (!sets.length) return null;
    sets.push("updated_at = ?");
    params.push(new Date().toISOString(), id);
    const result = await this.d1.query(`UPDATE comms_hub_outreach_targets SET ${sets.join(", ")} WHERE id = ? RETURNING *`, params);
    return rows(result)[0] || null;
  }

  async countInitialSendsSince(iso) {
    const result = await this.d1.query(
      `SELECT COUNT(*) AS count FROM comms_hub_outreach_targets WHERE last_sent_at IS NOT NULL AND last_sent_at >= ?`,
      [iso]
    );
    return Number(rows(result)[0]?.count || 0);
  }

  async createOutboundConversation({ email, displayName = "", domain, keyword, subject, sourceUrl = "", sourceTitle = "" }) {
    const now = new Date().toISOString();
    const contactId = stableId("con", "outreach", email.toLowerCase());
    const conversationId = stableId("cnv", "outreach", email.toLowerCase());
    const threadId = stableId("eth", "outreach", email.toLowerCase());
    const providerThreadKey = `outreach:${conversationId}`;
    await this.d1.batch([
      {
        sql: `INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at)
              VALUES (?, ?, ?, NULL, ?, ?)
              ON CONFLICT(id) DO UPDATE SET primary_email = excluded.primary_email,
                display_name = COALESCE(NULLIF(excluded.display_name,''), comms_hub_contacts.display_name), updated_at = excluded.updated_at`,
        params: [contactId, email.toLowerCase(), displayName || email, now, now],
      },
      {
        sql: `INSERT INTO comms_hub_conversations
              (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, metadata_json)
              VALUES (?, 'email', 'one.com', 'outreach_guest_article', 'open', ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET workflow='outreach_guest_article', subject=excluded.subject,
                source_reference=excluded.source_reference, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json`,
        params: [conversationId, contactId, subject, sourceUrl || domain, now, now, now, json({ outreach: true, domain, keyword, sourceUrl, sourceTitle })],
      },
      {
        sql: `INSERT OR IGNORE INTO comms_hub_conversation_operations
              (conversation_id, operational_status, version, updated_by, updated_at)
              VALUES (?, 'open', 1, 'outreach-automation', ?)`,
        params: [conversationId, now],
      },
      {
        sql: `INSERT OR IGNORE INTO comms_hub_contact_aliases
              (id, contact_id, alias_type, alias_value, provider, confidence, verified, active, created_at, updated_at, metadata_json)
              VALUES (?, ?, 'email', ?, 'outreach', 0.9, 0, 1, ?, ?, ?)`,
        params: [stableId("als", "outreach", email.toLowerCase()), contactId, email.toLowerCase(), now, now, json({ source: "outreach_discovery", domain })],
      },
      {
        sql: `INSERT INTO comms_hub_email_threads
              (id, conversation_id, account_key, mailbox, provider_thread_key, internet_message_id, references_json, last_uid, created_at, updated_at, metadata_json)
              VALUES (?, ?, ?, ?, ?, NULL, '[]', NULL, ?, ?, ?)
              ON CONFLICT(account_key, mailbox, provider_thread_key) DO UPDATE SET updated_at=excluded.updated_at, metadata_json=excluded.metadata_json`,
        params: [threadId, conversationId, "info", "INBOX", providerThreadKey, now, now, json({ outreach: true })],
      },
    ]);
    return { contactId, conversationId, threadId, providerThreadKey };
  }

  async saveArticle({ targetId, conversationId, title, version, wordCount, reviewScore, r2Key, status = "approved", metadata = {} }) {
    const now = new Date().toISOString();
    const id = stableId("oart", targetId, String(version));
    await this.d1.query(
      `INSERT INTO comms_hub_outreach_articles
        (id, target_id, conversation_id, title, status, version, word_count, review_score, r2_key, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status, word_count=excluded.word_count,
         review_score=excluded.review_score, r2_key=excluded.r2_key, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json`,
      [id, targetId, conversationId, title, status, version, wordCount, reviewScore, r2Key, now, now, json(metadata)]
    );
    return { id, targetId, conversationId, title, version, wordCount, reviewScore, r2Key, status };
  }
}

export default OutreachRepository;
