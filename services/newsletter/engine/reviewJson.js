import { parseStructuredJson } from "../../shared/utils/structuredJson.js";

// Review routes use the portable JSON-instructions payload: some configured
// endpoints reject optional reasoning/response_format parameters. Validate the
// required verdict locally before any review can authorise publication.
export function parseNewsletterReview(raw, schema, label) {
  const data = parseStructuredJson(raw, label);
  for (const key of schema.required) {
    const spec = schema.properties[key];
    const value = data?.[key];
    const valid = spec.type === "array"
      ? Array.isArray(value) && value.every((item) => typeof item === "string")
      : typeof value === spec.type;
    if (!valid || (spec.enum && !spec.enum.includes(value))) {
      throw new Error(`${label} has an invalid or missing ${key}`);
    }
  }
  if (!Number.isFinite(data.score) || data.score < 0 || data.score > 100) {
    throw new Error(`${label} score must be between 0 and 100`);
  }
  return data;
}
