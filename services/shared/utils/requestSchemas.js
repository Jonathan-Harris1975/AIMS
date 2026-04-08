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

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("://") && !value.includes("/") && !/\s/.test(value), {
    message: "must be a hostname without protocol or path",
  });

const prefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !value.includes("://") && !/\s/.test(value), {
    message: "must be a hostname/path prefix without protocol",
  });

const nonEmptyStringArray = (schema, label) =>
  z.array(schema).min(1, `${label} must contain at least one item`);

export const cloudflarePurgeBodySchema = z
  .object({
    purge_everything: z.literal(true).optional(),
    files: nonEmptyStringArray(z.string().trim().url(), "files").optional(),
    tags: nonEmptyStringArray(z.string().trim().min(1).max(1024), "tags").optional(),
    hosts: nonEmptyStringArray(hostnameSchema, "hosts").optional(),
    prefixes: nonEmptyStringArray(prefixSchema, "prefixes").optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const selectedModes = [
      value.purge_everything === true ? "purge_everything" : null,
      Array.isArray(value.files) ? "files" : null,
      Array.isArray(value.tags) ? "tags" : null,
      Array.isArray(value.hosts) ? "hosts" : null,
      Array.isArray(value.prefixes) ? "prefixes" : null,
    ].filter(Boolean);

    if (value.purge_everything === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purge_everything"],
        message: "purge_everything may only be set to true",
      });
    }

    if (selectedModes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide exactly one purge mode: purge_everything, files, tags, hosts, or prefixes.",
      });
    }

    if (selectedModes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide exactly one purge mode: purge_everything, files, tags, hosts, or prefixes.",
      });
    }
  });

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
