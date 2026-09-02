const MAX_BODY_BYTES = 1_048_576;
const MAX_BATCH_STATEMENTS = 100;
const MAX_SQL_BYTES = 65_536;
const MAX_PARAMS = 200;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isDailyRowReadLimit(value) {
  const message = text(value?.message || value).toLowerCase();
  return message.includes("exceeded d1's free tier daily row read limit")
    || /d1[^.]{0,80}daily[^.]{0,80}row read limit/.test(message);
}

function bearer(request) {
  const match = text(request.headers.get("authorization")).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(text(left));
  const b = new TextEncoder().encode(text(right));
  if (!a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function validateStatement(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Each statement must be an object.");
  }
  const sql = text(candidate.sql);
  if (!sql) throw new Error("Statement SQL is required.");
  if (new TextEncoder().encode(sql).length > MAX_SQL_BYTES) throw new Error("Statement SQL exceeds the limit.");
  const withoutTrailing = sql.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) throw new Error("Multiple SQL statements are not allowed in one item.");
  const operation = withoutTrailing.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() || "";
  if (!["SELECT", "INSERT", "UPDATE", "DELETE"].includes(operation)) {
    throw new Error("Only runtime SELECT, INSERT, UPDATE and DELETE statements are allowed.");
  }
  const params = candidate.params === undefined ? [] : candidate.params;
  if (!Array.isArray(params) || params.length > MAX_PARAMS) throw new Error("Statement params are invalid.");
  return { sql: withoutTrailing, params };
}

async function executeStatement(db, statement) {
  const prepared = db.prepare(statement.sql).bind(...statement.params);
  const result = await prepared.all();
  return {
    success: true,
    results: Array.isArray(result?.results) ? result.results : [],
    meta: result?.meta || {},
  };
}

async function executePayload(db, payload) {
  if (Array.isArray(payload?.batch)) {
    if (!payload.batch.length || payload.batch.length > MAX_BATCH_STATEMENTS) {
      throw new Error(`Batch size must be between 1 and ${MAX_BATCH_STATEMENTS}.`);
    }
    const statements = payload.batch.map(validateStatement);
    const prepared = statements.map(({ sql, params }) => db.prepare(sql).bind(...params));
    const results = await db.batch(prepared);
    return results.map((result) => ({
      success: true,
      results: Array.isArray(result?.results) ? result.results : [],
      meta: result?.meta || {},
    }));
  }
  const statement = validateStatement(payload);
  return [await executeStatement(db, statement)];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "comms-hub-data-plane" });
    }
    if (request.method !== "POST" || url.pathname !== "/query") {
      return json({ success: false, errors: [{ message: "Not found" }] }, 404);
    }
    if (!env.COMMS_HUB_DB || !constantTimeEqual(bearer(request), env.COMMS_HUB_D1_PROXY_TOKEN)) {
      return json({ success: false, errors: [{ message: "Unauthorized" }] }, 401);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ success: false, errors: [{ message: "Request body too large" }] }, 413);
    }

    let raw;
    try {
      raw = await request.arrayBuffer();
    } catch {
      return json({ success: false, errors: [{ message: "Request body could not be read" }] }, 400);
    }
    if (raw.byteLength > MAX_BODY_BYTES) {
      return json({ success: false, errors: [{ message: "Request body too large" }] }, 413);
    }

    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return json({ success: false, errors: [{ message: "Invalid JSON" }] }, 400);
    }

    try {
      const result = await executePayload(env.COMMS_HUB_DB, payload);
      return json({ success: true, result });
    } catch (error) {
      const message = text(error?.message || error).slice(0, 500) || "D1 operation failed";
      const dailyRowReadLimit = isDailyRowReadLimit(message);
      return json({
        success: false,
        retryable: false,
        errors: [{
          code: dailyRowReadLimit ? "d1_daily_row_read_limit" : "d1_operation_failed",
          message,
        }],
      }, dailyRowReadLimit ? 429 : 400);
    }
  },
};

export { constantTimeEqual, executePayload, isDailyRowReadLimit, validateStatement };
