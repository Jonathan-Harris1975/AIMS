import { z } from "zod";

const optionalSessionId = z.string().trim().min(1).max(80).optional();

export const ttsOrchestrateBodySchema = z
  .object({
    sessionId: optionalSessionId,
  })
  .passthrough();

export const podcastRunBodySchema = z
  .object({
    sessionId: optionalSessionId,
    data: z
      .object({
        sessionId: optionalSessionId,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const outreachKeywordBodySchema = z
  .object({
    keyword: z.string().trim().min(1).max(200),
  })
  .passthrough();

export const outreachResetBodySchema = z
  .object({
    lastProcessedIndex: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  })
  .passthrough();

export const blogWeeklyBuildBodySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(31).optional(),
    weekId: z.string().trim().min(1).max(100).optional(),
  })
  .passthrough();

export const artworkGenerateBodySchema = z
  .object({
    sessionId: optionalSessionId,
    prompt: z.string().trim().min(1).max(4000).optional(),
  })
  .passthrough();

export const artworkCreateBodySchema = z.custom(
  (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
  {
    message: "body must be a JSON object",
  }
);

export function formatZodError(error) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function validateBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    return {
      ok: false,
      error: formatZodError(result.error),
    };
  }

  return {
    ok: true,
    data: result.data,
  };
}
