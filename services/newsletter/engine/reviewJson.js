import { parseStructuredJson } from "../../shared/utils/structuredJson.js";

// Review routes use the portable JSON-instructions payload: some configured
// endpoints reject optional reasoning/response_format parameters. Validate the
// required verdict locally before any review can authorise publication.
export function parseNewsletterReview(raw, schema, label) {
  let data;
  try { data = parseStructuredJson(raw, label); }
  catch (cause) {
    const error = new Error(`${label} was not valid structured JSON`, { cause });
    error.code = "AI_INVALID_STRUCTURED_OUTPUT";
    error.status = "invalid_completion";
    throw error;
  }
  for (const key of schema.required) {
    const spec = schema.properties[key];
    const value = data?.[key];
    const valid = spec.type === "array"
      ? Array.isArray(value) && value.every((item) => typeof item === "string")
      : typeof value === spec.type;
    if (!valid || (spec.enum && !spec.enum.includes(value))) {
      const error = new Error(`${label} has an invalid or missing ${key}`);
      error.code = "AI_INVALID_STRUCTURED_OUTPUT";
      error.status = "invalid_completion";
      throw error;
    }
  }
  if (!Number.isFinite(data.score) || data.score < 0 || data.score > 100) {
    const error = new Error(`${label} score must be between 0 and 100`);
    error.code = "AI_INVALID_STRUCTURED_OUTPUT";
    error.status = "invalid_completion";
    throw error;
  }
  return data;
}
