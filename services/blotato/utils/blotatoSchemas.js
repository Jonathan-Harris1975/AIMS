import { z } from "zod";

export const BLOTATO_PLATFORMS = [
  "twitter",
  "linkedin",
  "facebook",
  "instagram",
  "pinterest",
  "tiktok",
  "threads",
  "bluesky",
  "youtube",
  "other",
];

const booleanish = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return ["1", "true", "yes", "on", "y"].includes(String(value).trim().toLowerCase());
  });

const optionalApiKey = z.string().trim().min(1).max(500).optional();
const platformSchema = z.enum(BLOTATO_PLATFORMS);
const jsonObjectSchema = z.record(z.string(), z.any());
const isoDateTimeWithOffset = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/, "must be ISO 8601 with timezone, e.g. 2026-03-04T16:30:00+00:00")
  .optional();

export const listAccountsQuerySchema = z
  .object({
    platform: platformSchema.optional(),
    apiKey: optionalApiKey,
  })
  .passthrough();

export const listTemplatesQuerySchema = z
  .object({
    fields: z.string().trim().min(1).max(300).optional().default("id,name,description,inputs"),
    search: z.string().trim().min(1).max(200).optional(),
    id: z.string().trim().min(1).max(200).optional(),
    apiKey: optionalApiKey,
  })
  .passthrough();

export const createVisualBodySchema = z
  .object({
    templateId: z.string().trim().min(1).max(300),
    inputs: jsonObjectSchema.optional().default({}),
    prompt: z.string().trim().min(1).max(8000).optional(),
    render: booleanish.optional().default(true),
    isDraft: booleanish.optional().default(false),
    apiKey: optionalApiKey,
  })
  .passthrough();

const mediaUrlArraySchema = z.array(z.string().trim().url()).max(20).optional().default([]);

export const publishPostBodySchema = z
  .object({
    accountId: z.string().trim().min(1).max(300),
    platform: platformSchema,
    text: z.string().trim().min(1).max(6000),
    mediaUrls: mediaUrlArraySchema,
    target: jsonObjectSchema.optional().default({}),
    additionalPosts: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(6000),
            mediaUrls: mediaUrlArraySchema,
          })
          .passthrough()
      )
      .max(25)
      .optional(),
    scheduledTime: isoDateTimeWithOffset,
    useNextFreeSlot: booleanish.optional(),
    apiKey: optionalApiKey,
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const targetType = value.target?.targetType || value.platform;
    if (targetType !== value.platform) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target", "targetType"],
        message: "must match platform",
      });
    }
  });

const articleSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(2500).optional(),
    link: z.string().trim().url().optional(),
    source: z.string().trim().max(150).optional(),
    pubDate: z.string().trim().max(80).optional(),
  })
  .passthrough();

const sourceResolutionSchema = z
  .object({
    sourceType: z.enum(["text", "article", "youtube", "twitter", "tiktok", "perplexity-query", "audio", "pdf"]),
    url: z.string().trim().url().optional(),
    text: z.string().trim().min(1).max(20000).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (["article", "youtube", "twitter", "tiktok", "audio", "pdf"].includes(value.sourceType) && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "url is required for this sourceType",
      });
    }

    if (["text", "perplexity-query"].includes(value.sourceType) && !value.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "text is required for this sourceType",
      });
    }
  });

const autoPublishPlatformSchema = z.enum(["instagram", "youtube"]);
const optionalStringMap = z.record(z.string(), z.string().trim().min(1).max(500)).optional().default({});

export const newsInsightBodySchema = z
  .object({
    article: articleSchema.optional(),
    articles: z.array(articleSchema).max(8).optional(),
    theme: z
      .enum(["ai-news-bite", "what-it-means", "workflow-tip", "podcast-angle", "reality-check", "ebook-insight"])
      .optional()
      .default("what-it-means"),
    durationSeconds: z.coerce.number().int().min(20).max(90).optional().default(45),
    cta: z.string().trim().max(500).optional(),
    audience: z.string().trim().max(300).optional().default("curious readers, creators, authors, and small business owners"),
    dryRun: booleanish.optional().default(true),
    createVisual: booleanish.optional().default(false),
    templateId: z.string().trim().min(1).max(300).optional(),
    inputs: jsonObjectSchema.optional().default({}),
    render: booleanish.optional().default(true),
    isDraft: booleanish.optional().default(false),
    apiKey: optionalApiKey,
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const articleCount = (value.article ? 1 : 0) + (Array.isArray(value.articles) ? value.articles.length : 0);
    if (articleCount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["article"],
        message: "provide article or articles",
      });
    }

    if (value.createVisual && !value.templateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["templateId"],
        message: "templateId is required when createVisual is true",
      });
    }
  });

export const newsInsightAutoPublishBodySchema = z
  .object({
    sessionId: z.string().trim().min(1).max(120).optional(),
    article: articleSchema.optional(),
    articles: z.array(articleSchema).max(8).optional(),
    articleUrl: z.string().trim().url().optional(),
    source: sourceResolutionSchema.optional(),
    theme: z
      .enum(["ai-news-bite", "what-it-means", "workflow-tip", "podcast-angle", "reality-check", "ebook-insight"])
      .optional()
      .default("what-it-means"),
    durationSeconds: z.coerce.number().int().min(20).max(90).optional().default(45),
    cta: z.string().trim().max(500).optional(),
    audience: z.string().trim().max(300).optional().default("curious readers, creators, authors, and small business owners"),
    channels: z.array(autoPublishPlatformSchema).min(1).max(2).optional().default(["instagram", "youtube"]),
    accounts: optionalStringMap,
    templateId: z.string().trim().min(1).max(300).optional(),
    inputs: jsonObjectSchema.optional().default({}),
    render: booleanish.optional().default(true),
    isDraft: booleanish.optional().default(false),
    publish: booleanish.optional().default(true),
    scheduledTime: isoDateTimeWithOffset,
    useNextFreeSlot: booleanish.optional(),
    instagram: jsonObjectSchema.optional().default({}),
    youtube: jsonObjectSchema.optional().default({}),
    targets: z.record(z.string(), jsonObjectSchema).optional().default({}),
    apiKey: optionalApiKey,
  })
  .passthrough();

export function formatZodError(error) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function validatePayload(schema, payload) {
  const parsed = schema.safeParse(payload ?? {});
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}
