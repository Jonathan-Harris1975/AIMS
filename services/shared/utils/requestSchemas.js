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

const optionalBlogSocialDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional();

export const newsletterGenerateBodySchema = z
  .object({
    profileId: z.string().trim().min(1).max(100).optional(),
    sessionId: z.string().trim().min(1).max(150).optional(),
  })
  .passthrough();

export const newsletterSendBodySchema = z
  .object({
    profileId: z.string().trim().min(1).max(100).optional(),
    sessionId: z.string().trim().min(1).max(150).optional(),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
  })
  .passthrough();

export const blogSocialDailyBuildBodySchema = z
  .object({
    date: optionalBlogSocialDate,
    days: z.coerce.number().int().min(1).max(7).optional().default(1),
    dryRun: booleanish.optional().default(false),
    force: booleanish.optional().default(false),
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
  .refine((value) => !/\s/.test(value), {
    message: "must be a hostname/path prefix without whitespace",
  });

const cloudflareFileEntrySchema = z.union([
  z.string().trim().url(),
  z
    .object({
      url: z.string().trim().url(),
      headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
    })
    .passthrough(),
]);

const nonEmptyStringArray = (schema, label) =>
  z.array(schema).min(1, `${label} must contain at least one item`);

export const cloudflarePurgeBodySchema = z
  .object({
    purge_everything: z.literal(true).optional(),
    files: nonEmptyStringArray(cloudflareFileEntrySchema, "files").optional(),
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
const optionalTimeString = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/, "must be HH:MM")
  .optional();
const zernioAccountIdSchema = z.union([z.string().trim().min(1).max(400), z.array(z.string().trim().min(1).max(200)).min(1)]).optional();

export const zernioDailyBodySchema = z
  .object({
    publishDate: optionalIsoDate,
    scheduledDateTime: optionalScheduledDateTime,
    dryRun: booleanish.optional(),
    profileName: z.string().trim().min(1).max(120).optional(),
    // Opt-in: when provided, buildAndScheduleDailyLaneAccountVariants schedules
    // the canonical post to the first entry, then an automatically varied
    // copy of it to each remaining account/category.
    profileNames: z.union([
      z.string().trim().min(1).max(120),
      z.array(z.string().trim().min(1).max(120)).min(1).max(10),
    ]).optional(),
    accountId: zernioAccountIdSchema,
    imageUrl: z.string().trim().url().optional(),
    buildContext: z.string().trim().max(2000).optional(),
    apiKey: z.string().trim().min(1).max(200).optional(),
    // Explicit override to permit scheduling content that matches the
    // recent-duplicate content hash window (config/thresholds.js
    // scheduler.dedupeWindowHours). `crosspost` accepted as a back-compat alias.
    allowDuplicate: booleanish.optional(),
    crosspost: booleanish.optional(),
    // Per-request override of the duplicate-detection window, in hours.
    dedupeWindowHours: z.coerce.number().int().min(1).max(720).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    accountId: Array.isArray(value.accountId)
      ? JSON.stringify(value.accountId)
      : value.accountId,
    profileNames: Array.isArray(value.profileNames)
      ? value.profileNames
      : typeof value.profileNames === "string"
        ? value.profileNames.split(/[,;]/g).map((item) => item.trim()).filter(Boolean)
        : value.profileNames,
  }));


const zernioMiniSeriesSourceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(5000),
  link: z.string().trim().url(),
  pubDate: z.union([z.string().trim().min(1).max(120), z.number()]).optional(),
}).passthrough();

export const zernioMiniSeriesBodySchema = z
  .object({
    weekStartDate: optionalIsoDate,
    dryRun: booleanish.optional(),
    profileName: z.string().trim().min(1).max(120).optional(),
    accountId: zernioAccountIdSchema,
    apiKey: z.string().trim().min(1).max(200).optional(),
    topicSeed: z.string().trim().max(500).optional(),
    sourceItems: z.array(zernioMiniSeriesSourceSchema).min(1).max(20).optional(),
    force: booleanish.optional(),
    minimumSuitabilityScore: z.coerce.number().int().min(0).max(100).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    accountId: Array.isArray(value.accountId) ? JSON.stringify(value.accountId) : value.accountId,
  }));

export const zernioPodcastPromoBodySchema = z
  .object({
    publishDate: optionalIsoDate,
    scheduledDateTime: optionalScheduledDateTime,
    dryRun: booleanish.optional(),
    profileName: z.string().trim().min(1).max(120).optional(),
    accountId: zernioAccountIdSchema,
    imageUrl: z.string().trim().url().optional(),
    feedUrl: z.string().trim().url().optional(),
    apiKey: z.string().trim().min(1).max(200).optional(),
    force: booleanish.optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    accountId: Array.isArray(value.accountId) ? JSON.stringify(value.accountId) : value.accountId,
  }));

export const zernioQuizBodySchema = z
  .object({
    questionPublishDate: optionalIsoDate,
    answerPublishDate: optionalIsoDate,
    questionScheduledDateTime: optionalScheduledDateTime,
    answerScheduledDateTime: optionalScheduledDateTime,
    dryRun: booleanish.optional(),
    profileName: z.string().trim().min(1).max(120).optional(),
    accountId: zernioAccountIdSchema,
    questionImageUrl: z.string().trim().url().optional(),
    answerImageUrl: z.string().trim().url().optional(),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    accountId: Array.isArray(value.accountId)
      ? JSON.stringify(value.accountId)
      : value.accountId,
  }));


const zernioEbookFeaturedBookSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    shortDescription: z.string().trim().max(2000).optional(),
    description: z.string().trim().max(4000).optional(),
    summary: z.string().trim().max(4000).optional(),
    keywords: z.union([z.string().trim().max(2000), z.array(z.string().trim().min(1).max(120)).max(50)]).optional(),
    keywordsText: z.string().trim().max(2000).optional(),
    audience: z.string().trim().max(2000).optional(),
    whoThisBookIsFor: z.string().trim().max(4000).optional(),
    whatThisBookCovers: z.string().trim().max(4000).optional(),
    whatYouWillLearn: z.string().trim().max(4000).optional(),
    whyItMatters: z.string().trim().max(4000).optional(),
    bookUrl: z.string().trim().url(),
    coverArtUrl: z.string().trim().url().optional(),
    manuscriptUrl: z.string().trim().url().optional(),
    slug: z.string().trim().min(1).max(300).optional(),
  })
  .passthrough();

export const zernioEbookWeeklyBodySchema = z
  .object({
    weekStartDate: optionalIsoDate,
    dryRun: booleanish.optional(),
    profileName: z.string().trim().min(1).max(120).optional(),
    accountId: zernioAccountIdSchema,
    imageUrl: z.string().trim().url().optional(),
    featuredBook: zernioEbookFeaturedBookSchema.optional(),
    usePodcastFeaturedBook: booleanish.optional(),
    publishTimes: z
      .object({
        tuesday: optionalTimeString,
        thursday: optionalTimeString,
        saturday: optionalTimeString,
      })
      .partial()
      .optional(),
    scheduledDateTimes: z
      .object({
        tuesday: optionalScheduledDateTime,
        thursday: optionalScheduledDateTime,
        saturday: optionalScheduledDateTime,
      })
      .partial()
      .optional(),
    tuesdayScheduledDateTime: optionalScheduledDateTime,
    thursdayScheduledDateTime: optionalScheduledDateTime,
    saturdayScheduledDateTime: optionalScheduledDateTime,
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    accountId: Array.isArray(value.accountId)
      ? JSON.stringify(value.accountId)
      : value.accountId,
  }));

export const zernioPublishedHistoryBodySchema = z
  .object({
    start: z.coerce.number().int().min(0).max(100000).optional().default(0),
    maxPages: z.coerce.number().int().min(1).max(20).optional().default(4),
    lookbackDays: z.coerce.number().int().min(1).max(365).optional().default(31),
    apiKey: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();


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



export const onBrandAuditRunBodySchema = z
  .object({
    sessionId: optionalSessionId,
    lookbackDays: z.coerce.number().int().min(1).max(31).optional().default(7),
    includeZernio: booleanish.optional().default(true),
    includePodcastTranscripts: booleanish.optional().default(true),
    includeRss: booleanish.optional().default(true),
    runPodcastWebsiteReports: booleanish.optional().default(true),
    dryRun: booleanish.optional().default(false),
  })
  .passthrough();

export const auditAnalysisBodySchema = z
  .object({
    auditType: z.string().trim().min(1).max(80).optional().default("seo-aeo-geo"),
    sessionId: z.string().trim().min(1).max(120),
    baseUrl: z.string().trim().url(),
    generatedAt: z.string().trim().min(1).max(80).optional(),
    inventory: z.record(z.string(), z.any()),
    priorityPages: z.array(z.record(z.string(), z.any())).min(1),
    allRoutes: z.array(z.record(z.string(), z.any())).min(1),
    heuristicIssues: z.array(z.record(z.string(), z.any())).optional().default([]),
    repoSignals: z.record(z.string(), z.any()),
    liveDynamicUrls: z.array(z.record(z.string(), z.any())).optional().default([]),
    coverage: z.array(z.record(z.string(), z.any())).optional().default([]),
    coverageFamilies: z.array(z.record(z.string(), z.any())).optional().default([]),
  })
  .passthrough();

export const auditCallbackBodySchema = z
  .object({
    auditType: z.string().trim().min(1).max(80),
    sessionId: z.string().trim().min(1).max(120),
    status: z.enum(["queued", "running", "completed", "failed"]).optional().default("completed"),
    reportPrefix: z.string().trim().min(1).max(500),
    reportUrl: z.string().trim().url().optional(),
    reportHtmlUrl: z.string().trim().url().optional(),
    reportJsonUrl: z.string().trim().url().optional(),
    summaryUrl: z.string().trim().url().optional(),
    coverageUrl: z.string().trim().url().optional(),
    executionUrl: z.string().trim().url().optional(),
    preflightUrl: z.string().trim().url().optional(),
    evidenceUrl: z.string().trim().url().optional(),
    reconciliationUrl: z.string().trim().url().optional(),
    screenshotManifestUrl: z.string().trim().url().optional(),
    focusedPageAppendixUrl: z.string().trim().url().optional(),
    repositoryIssueAppendixUrl: z.string().trim().url().optional(),
    mandatoryMobileScorecardUrl: z.string().trim().url().optional(),
    responsiveFixAppendixUrl: z.string().trim().url().optional(),
    workflowRunUrl: z.string().trim().url().optional().or(z.literal("")),
    screenshotCount: z.coerce.number().int().min(0).optional(),
    mobileFailureCount: z.coerce.number().int().min(0).optional(),
    issueCount: z.coerce.number().int().min(0).optional(),
    rootCauseGroupCount: z.coerce.number().int().min(0).optional(),
    confidenceModel: z.record(z.string(), z.any()).optional(),
    executionCoverageConfidence: z.record(z.string(), z.any()).optional(),
    findingConfidence: z.record(z.string(), z.any()).optional(),
    scoringConfidence: z.record(z.string(), z.any()).optional(),
    releaseConfidence: z.record(z.string(), z.any()).optional(),
    sourceRevisionSha: z.string().trim().min(7).max(64).optional(),
    liveReleaseSha: z.string().trim().min(7).max(64).optional(),
    liveReleaseMarkerUrl: z.string().trim().url().optional(),
    liveSourceParity: z.enum(["matched", "mismatched", "unverified"]).optional(),
    accessibilityEvidence: z.record(z.string(), z.any()).optional(),
    visualDesignEvidence: z.record(z.string(), z.any()).optional(),
    performanceEvidence: z.record(z.string(), z.any()).optional(),
    searchConsoleEvidence: z.record(z.string(), z.any()).optional(),
    securityEvidence: z.record(z.string(), z.any()).optional(),
    message: z.string().trim().min(1).max(4000).optional(),
    error: z
      .union([z.string().trim().min(1).max(4000), z.null()])
      .optional()
      .transform((value) => value ?? undefined),
    failedStep: z.string().trim().min(1).max(500).optional(),
    exitCode: z.union([z.coerce.number().int(), z.string().trim().min(1).max(80)]).optional(),
    workflowLogTail: z.string().max(20000).optional(),
    storageUploadError: z.string().trim().min(1).max(4000).optional(),
    existingCallbackMarker: z.record(z.string(), z.any()).optional(),
    existingCallbackMarkerReadError: z.string().trim().min(1).max(1000).optional(),
    finishedAt: z.string().trim().min(1).max(80).optional(),
    artefacts: z.record(z.string().trim(), z.string().trim().url()).optional(),
  })
  .passthrough();
