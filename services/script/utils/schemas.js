import { z } from "zod";

const optionalText = () => z.string().trim().min(1).optional();

export const SessionSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(80).optional(),
  })
  .passthrough();

export const IntroSchema = SessionSchema.extend({
  date: optionalText(),
  prompt: optionalText(),
});

export const MainSchema = SessionSchema.extend({
  rssUrl: z.string().url().optional(),
  maxItems: z.coerce.number().int().positive().max(20).optional(),
  prompt: optionalText(),
});

export const OutroSchema = SessionSchema.extend({
  prompt: optionalText(),
});

export const ComposeSchema = SessionSchema.extend({
  intro: optionalText(),
  main: z.array(z.string()).optional(),
  outro: optionalText(),
  editorPrompt: optionalText(),
});

export const OrchestrateSchema = SessionSchema.extend({
  date: optionalText(),
  tone: optionalText(),
  location: optionalText(),
});

export function formatSchemaError(error) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseSchema(schema, payload) {
  const result = schema.safeParse(payload ?? {});
  if (!result.success) {
    return { ok: false, error: formatSchemaError(result.error) };
  }

  return { ok: true, data: result.data };
}
