// services/shared/utils/structuredJson.js
//
// Shared OpenRouter structured-output helpers. Strict JSON Schema responses
// remove the brittle "JSON object" parsing path that can produce truncated or
// syntactically invalid council/QA payloads.

function cleanSchemaName(value = "structured_response") {
  const cleaned = String(value || "structured_response")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return cleaned || "structured_response";
}

export function strictJsonResponseFormat(name, schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("A JSON Schema object is required.");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: cleanSchemaName(name),
      strict: true,
      schema,
    },
  };
}

function stripCodeFences(value = "") {
  return String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function findBalancedObject(value = "") {
  const text = String(value || "");
  const start = text.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return "";
}

export function parseStructuredJson(raw, label = "structured response") {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;

  const text = stripCodeFences(raw);
  if (!text) throw new Error(`${label} was empty.`);

  try {
    return JSON.parse(text);
  } catch (firstError) {
    const candidate = findBalancedObject(text);
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {}
    }
    throw new Error(`${label} was not valid JSON: ${firstError.message}`);
  }
}

export default { strictJsonResponseFormat, parseStructuredJson };
