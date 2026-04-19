import { z } from "zod";

const optionalSessionId = z.string().trim().min(1).max(80).optional();


const booleanish = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
  });

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


const optionalIsoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional();
const optionalScheduledDateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "must be YYYY-MM-DD HH:MM")
  .optional();

export const oneupDailyBodySchema = z
  .object({
    publishDate: optionalIsoDate,
    scheduledDateTime: optionalScheduledDateTime,
    dryRun: booleanish.optional(),
    categoryName: z.string().trim().min(1).max(120).optional(),
    socialNetworkId: z.union([z.string().trim().min(1).max(400), z.array(z.string().trim().min(1).max(200)).min(1)]).optional(),
    imageUrl: z.string().trim().url().optional(),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    socialNetworkId: Array.isArray(value.socialNetworkId)
      ? JSON.stringify(value.socialNetworkId)
      : value.socialNetworkId,
  }));

export const oneupQuizBodySchema = z
  .object({
    questionPublishDate: optionalIsoDate,
    answerPublishDate: optionalIsoDate,
    questionScheduledDateTime: optionalScheduledDateTime,
    answerScheduledDateTime: optionalScheduledDateTime,
    dryRun: booleanish.optional(),
    categoryName: z.string().trim().min(1).max(120).optional(),
    socialNetworkId: z.union([z.string().trim().min(1).max(400), z.array(z.string().trim().min(1).max(200)).min(1)]).optional(),
    questionImageUrl: z.string().trim().url().optional(),
    answerImageUrl: z.string().trim().url().optional(),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    socialNetworkId: Array.isArray(value.socialNetworkId)
      ? JSON.stringify(value.socialNetworkId)
      : value.socialNetworkId,
  }));


const auditExcludePatternsSchema = z.array(z.string().trim().min(1).max(200)).max(20).optional();

export const auditRunBodySchema = z
  .object({
    sessionId: optionalSessionId,
    websiteUrl: z.string().trim().url().optional(),
    reportPrefix: z.string().trim().min(1).max(300).optional(),
    workflowRef: z.string().trim().min(1).max(120).optional(),
    requestedBy: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().min(1).max(4000).optional(),
    excludePatterns: auditExcludePatternsSchema,
  })
  .passthrough();

export const auditCallbackBodySchema = z
  .object({
    auditType: z.string().trim().min(1).max(80),
    sessionId: z.string().trim().min(1).max(120),
    status: z.enum(["queued", "running", "completed", "failed"]).optional().default("completed"),
    reportPrefix: z.string().trim().min(1).max(500),
    reportUrl: z.string().trim().url().optional(),
    summaryUrl: z.string().trim().url().optional(),
    executionUrl: z.string().trim().url().optional(),
    preflightUrl: z.string().trim().url().optional(),
    evidenceUrl: z.string().trim().url().optional(),
    reconciliationUrl: z.string().trim().url().optional(),
    workflowRunUrl: z.string().trim().url().optional().or(z.literal("")),
    screenshotCount: z.coerce.number().int().min(0).optional(),
    mobileFailureCount: z.coerce.number().int().min(0).optional(),
    issueCount: z.coerce.number().int().min(0).optional(),
    message: z.string().trim().min(1).max(4000).optional(),
    error: z.string().trim().min(1).max(4000).optional(),
    finishedAt: z.string().trim().min(1).max(80).optional(),
    artefacts: z.record(z.string().trim(), z.string().trim().url()).optional(),
  })
  .passthrough();
