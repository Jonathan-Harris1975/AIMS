const YES_SKILLS = [
  {
    name: "content-quality-auditor",
    adoption: "yes",
    mode: "deterministic_report_lens",
    checks: ["content depth", "answer usefulness", "trust/veto-style quality risks", "publish-readiness guidance"],
  },
  {
    name: "geo-content-optimizer",
    adoption: "yes",
    mode: "deterministic_report_lens",
    checks: ["AI-citable answer blocks", "quotable summaries", "entity clarity", "retrieval-friendly structure"],
  },
  {
    name: "schema-markup-generator",
    adoption: "yes",
    mode: "schema_alignment_lens",
    checks: ["PodcastEpisode JSON-LD", "FAQPage JSON-LD", "visible-content/schema alignment", "canonical relationship signals"],
  },
  {
    name: "entity-optimizer",
    adoption: "yes",
    mode: "entity_consistency_lens",
    checks: ["Jonathan Harris entity clarity", "Turing's Torch identity", "AI topic/entity density", "same-owner consistency"],
  },
  {
    name: "internal-linking-optimizer",
    adoption: "yes",
    mode: "recommendation_only_lens",
    checks: ["episode-to-transcript path", "transcript-to-topic path", "transcript-to-book path", "newsletter/commercial journey continuity"],
  },
  {
    name: "on-page-seo-auditor",
    adoption: "yes",
    mode: "deterministic_on_page_lens",
    checks: ["title specificity", "description length", "heading/anchor readiness", "search intent clarity"],
  },
];

const PARTIAL_SKILLS = [
  {
    name: "technical-seo-checker",
    adoption: "partial",
    mode: "owned_signal_lens_only",
    checks: ["canonical URL presence", "duplicate URL risk", "audio/transcript URL integrity", "source-owner route governance"],
    excluded: ["external crawler depth", "rank tools", "backlink tooling"],
  },
  {
    name: "meta-tags-optimizer",
    adoption: "partial",
    mode: "metadata_quality_lens",
    checks: ["description length", "title shape", "HTML meta-description presence where raw HTML is available"],
    excluded: ["live SERP CTR testing", "social preview pixel testing"],
  },
  {
    name: "content-refresher",
    adoption: "partial",
    mode: "staleness_signal_lens",
    checks: ["age of inspected item", "refresh-review recommendation", "no automatic rewrite"],
    excluded: ["automatic historical rewrites", "date-only refreshes"],
  },
  {
    name: "performance-reporter",
    adoption: "partial",
    mode: "report_summary_lens",
    checks: ["source coverage", "measured vs not-yet-evaluated sections", "next-report owner labels"],
    excluded: ["invented analytics", "rank/backlink estimates without source data"],
  },
];

export const AIMS_AUDIT_SKILL_LENSES = [...YES_SKILLS, ...PARTIAL_SKILLS];

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function trim(value) {
  return String(value ?? "").trim();
}

function cleanText(value = "") {
  return String(value ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(trim(value));
}

function safeDate(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function ageDays(value, now = new Date()) {
  const date = safeDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function titleWordCount(value = "") {
  return wordCount(value);
}

function hasQuestionPattern(text = "") {
  return /\b(what|why|how|when|where|who|which)\b[^.?!]{0,80}\?/i.test(cleanText(text));
}

function namedEntityCount(text = "") {
  const cleaned = cleanText(text);
  const matches = cleaned.match(/\b(?:[A-Z][a-z0-9'’.-]+|AI|ML|LLM|GPT|NVIDIA|OpenAI|Google|Microsoft|Anthropic)(?:\s+(?:[A-Z][a-z0-9'’.-]+|AI|ML|LLM|GPT))*\b/g) || [];
  const filtered = matches
    .map((value) => value.trim())
    .filter((value) => value.length > 2 && !/^(The|This|That|And|But|For|With|From|Podcast|Transcript|Episode)$/i.test(value));
  return new Set(filtered).size;
}

function containsBrandEntity(text = "") {
  return /\b(Jonathan\s+Harris|Turing[’']?s\s+Torch|AI\s+ebooks?|artificial\s+intelligence)\b/i.test(cleanText(text));
}

function findingId(prefix, index) {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

function makeOnBrandFinding({ id, severity = "medium", sourceType, itemTitleOrId, issueType, exactEvidence, why, rule, remediation, verification, rootCauseLevel = "pipeline" }) {
  return {
    issueId: id,
    severity,
    confidence: "confirmed",
    sourceType,
    itemTitleOrId: itemTitleOrId || "Not verified from supplied evidence",
    issueType,
    exactEvidence,
    whyItIsOffBrand: why,
    violatedRule: rule,
    rootCauseLevel,
    exactRemediation: remediation,
    improvedExample: "",
    verificationMethod: verification || "Generate fresh output and rerun the AIMS audit; historic examples are calibration evidence, not automatic rewrite targets.",
  };
}

function measuredSignals(evidence = {}) {
  const items = arr(evidence.items);
  const htmlItems = items.filter((item) => item.sourceFormat === "html" || item.htmlFeatureFlags);
  const withDates = items.filter((item) => item.pubDate || item.date || item.lastModified).length;
  const withCanonicalLinks = items.filter((item) => isHttpUrl(item.link) || item.htmlFeatureFlags?.hasCanonicalLink).length;
  const withTranscriptLinks = items.filter((item) => isHttpUrl(item.transcriptUrl)).length;
  const withSchema = htmlItems.filter((item) => item.htmlFeatureFlags?.hasFaqJsonLd || item.htmlFeatureFlags?.hasPodcastEpisodeJsonLd || item.htmlFeatureFlags?.hasJsonLd).length;
  const withAeoBlocks = htmlItems.filter((item) => item.htmlFeatureFlags?.hasAeoSummaryBlock).length;
  const withInternalLinks = htmlItems.filter((item) => item.htmlFeatureFlags?.hasInternalLink || item.htmlFeatureFlags?.hasRelatedBookLink || item.htmlFeatureFlags?.hasTopicLink).length;
  return {
    itemsInspected: items.length,
    withDates,
    withCanonicalLinks,
    withTranscriptLinks,
    htmlItemsInspected: htmlItems.length,
    withSchema,
    withAeoBlocks,
    withInternalLinks,
  };
}

export function buildSkillLensSummary({ evidence = {}, reportKind = "aims-audit" } = {}) {
  return {
    adoptedFrom: "seo-geo-claude-skills-main",
    reportKind,
    sourceType: evidence.sourceType || "unknown",
    mode: "AIMS deterministic/report-first adaptation; no external crawler, backlink, rank, SERP, or competitor tooling is assumed.",
    activeLenses: AIMS_AUDIT_SKILL_LENSES,
    measuredSignals: measuredSignals(evidence),
    missingExternalSignals: [
      "Search Console and analytics exports",
      "rank-tracking data",
      "backlink/domain-authority tools",
      "live SERP/AI Overview monitoring",
      "competitor crawl data",
    ],
    safetyPolicy: {
      reportOnlyByDefault: true,
      generatorFixAllowedOnlyWhenSourceOwnerIsAimsR2: true,
      staticRepoPatchAllowedOnlyWithExactWebsiteOwnedFiles: true,
      historicContentRewriteAllowed: false,
    },
  };
}

function addEpisodeFinding(findings, makeFinding, data) {
  findings.push(makeFinding({
    sourceOwner: "aims_r2_podcast",
    sourceType: "podcast_episode",
    classification: "future_guidance",
    automationReadiness: "skill_lens_future_guardrail",
    ...data,
  }));
}

function addTranscriptFinding(findings, makeFinding, data) {
  findings.push(makeFinding({
    sourceOwner: "podcast_transcript_pipeline",
    sourceType: "podcast_transcript_report",
    classification: "future_guidance",
    automationReadiness: "skill_lens_future_guardrail",
    ...data,
  }));
}

export function buildEpisodeSkillLensFindings(evidence = {}, makeFinding) {
  if (typeof makeFinding !== "function" || evidence.status !== "complete") return [];
  const findings = [];
  const seen = new Set();
  for (const [index, item] of arr(evidence.items).entries()) {
    const n = index + 1;
    const label = item.title || item.guid || `Episode ${n}`;
    const titleWords = titleWordCount(item.title);
    const descWords = wordCount(item.description);
    const combined = `${item.title || ""} ${item.description || ""}`;

    if ((titleWords > 0 && titleWords < 4) || titleWords > 16) {
      addEpisodeFinding(findings, makeFinding, {
        id: findingId("PODCAST-SKILL-ONPAGE-TITLE", n),
        title: "On-page SEO lens: episode title shape needs tightening",
        severity: titleWords > 18 ? "medium" : "low",
        itemTitleOrId: label,
        evidence: [`skill: on-page-seo-auditor`, `titleWords: ${titleWords}`, `title: ${item.title || "missing"}`],
        requiredOutcome: "For future episode metadata, keep titles specific, human-readable and normally within 4-16 words.",
        verificationMethod: "Regenerate podcast metadata and rerun the podcast episode report; titles should pass the on-page lens without manual review.",
      });
    }

    if (descWords < 55 || descWords > 180) {
      addEpisodeFinding(findings, makeFinding, {
        id: findingId("PODCAST-SKILL-META-DESC", n),
        title: "Meta-tags lens: episode description is outside the useful context range",
        severity: descWords < 35 ? "medium" : "low",
        itemTitleOrId: label,
        evidence: [`skill: meta-tags-optimizer`, `descriptionWords: ${descWords}`],
        requiredOutcome: "For future episode descriptions, provide enough answer-first context for snippets and AI citation without turning the RSS summary into a miniature essay.",
        verificationMethod: "Regenerate the podcast RSS feed and confirm recent descriptions sit inside the target context range.",
      });
    }

    if (!hasQuestionPattern(item.description) && descWords >= 35) {
      addEpisodeFinding(findings, makeFinding, {
        id: findingId("PODCAST-SKILL-GEO-ANSWER", n),
        title: "GEO lens: episode description lacks an explicit answer-friendly angle",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: geo-content-optimizer`, "questionLedOrAnswerFirstCue: missing"],
        requiredOutcome: "For future episode descriptions, add one concise answer-first sentence that says what changed, why it matters, and who is affected.",
        verificationMethod: "Rerun the podcast episode report and confirm the GEO lens sees an answer-friendly summary cue.",
      });
    }

    if (namedEntityCount(combined) < 3) {
      addEpisodeFinding(findings, makeFinding, {
        id: findingId("PODCAST-SKILL-ENTITY", n),
        title: "Entity lens: episode metadata has thin named-entity signals",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: entity-optimizer`, `namedEntityCount: ${namedEntityCount(combined)}`],
        requiredOutcome: "For future episode metadata, include the main companies, people, technologies or policy entities discussed so retrieval systems can classify the episode accurately.",
        verificationMethod: "Generate fresh episode metadata and rerun the report; the entity lens should identify the key discussed entities.",
      });
    }

    if (!containsBrandEntity(combined)) {
      const key = "brand-entity";
      if (!seen.has(key)) {
        seen.add(key);
        addEpisodeFinding(findings, makeFinding, {
          id: "PODCAST-SKILL-ENTITY-BRAND-001",
          title: "Entity lens: podcast metadata should keep the Jonathan Harris/Turing's Torch entity clear",
          severity: "low",
          itemTitleOrId: label,
          evidence: [`skill: entity-optimizer`, "brandEntityCue: not found in sampled metadata"],
          requiredOutcome: "For future podcast metadata templates, keep the show/author entity relationship clear without stuffing every description with brand boilerplate.",
          verificationMethod: "Rerun the podcast report and confirm sampled metadata exposes the publisher/show entity at least once in the report window.",
        });
      }
    }

    const itemAge = ageDays(item.pubDate);
    if (itemAge !== null && itemAge > 90) {
      addEpisodeFinding(findings, makeFinding, {
        id: findingId("PODCAST-SKILL-REFRESH", n),
        title: "Content refresher lens: older episode metadata should be reviewed rather than silently carried forward",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: content-refresher`, `ageDays: ${itemAge}`],
        requiredOutcome: "For older evergreen episode entries, review whether the summary, transcript link and related-topic path still reflect the current content model; do not rewrite historic audio/transcripts automatically.",
        verificationMethod: "Rerun the report after the next monthly QA cycle and confirm old items are either intentionally archived or still have current metadata paths.",
      });
    }
  }
  return findings.slice(0, 18);
}

export function buildTranscriptSkillLensFindings(evidence = {}, makeFinding) {
  if (typeof makeFinding !== "function" || evidence.status !== "complete") return [];
  const findings = [];
  for (const [index, item] of arr(evidence.items).entries()) {
    const n = index + 1;
    const label = item.title || item.sessionId || item.r2Key || `Transcript ${n}`;
    const flags = obj(item.htmlFeatureFlags);
    const text = `${item.title || ""} ${item.textExcerpt || ""}`;
    const textWords = wordCount(item.textExcerpt);
    const entities = namedEntityCount(text);

    if (textWords < 900) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-CONTENT-DEPTH", n),
        title: "Content quality lens: transcript text is below the useful-depth threshold",
        severity: textWords < 500 ? "high" : "medium",
        itemTitleOrId: label,
        evidence: [`skill: content-quality-auditor`, `transcriptWords: ${textWords}`],
        requiredOutcome: "For future transcript output, verify the transcript body is complete enough to support readers, summaries and citation extraction before publication.",
        verificationMethod: "Generate a fresh transcript and rerun the report; transcript body extraction should clear the content-depth threshold.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasAeoSummaryBlock === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-GEO-SUMMARY", n),
        title: "GEO lens: transcript page lacks an answer-first summary structure",
        severity: "medium",
        itemTitleOrId: label,
        evidence: [`skill: geo-content-optimizer`, "hasAeoSummaryBlock: false"],
        requiredOutcome: "For future transcript HTML, render an answer-first episode summary, key takeaways and discussed entities before the full transcript body.",
        verificationMethod: "Generate fresh transcript HTML and confirm the GEO summary structure is present before the body.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasFullTranscriptAnchor === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-ONPAGE-ANCHOR", n),
        title: "On-page SEO lens: transcript page lacks a stable full-transcript anchor",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: on-page-seo-auditor`, "hasFullTranscriptAnchor: false"],
        requiredOutcome: "For future transcript HTML, keep a stable full-transcript anchor so readers and crawlers can jump from summary to source text.",
        verificationMethod: "Generate fresh transcript HTML and confirm #full-transcript or equivalent anchor exists.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasPodcastEpisodeJsonLd === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-SCHEMA-PODCAST", n),
        title: "Schema lens: transcript HTML lacks PodcastEpisode JSON-LD",
        severity: "medium",
        itemTitleOrId: label,
        evidence: [`skill: schema-markup-generator`, "hasPodcastEpisodeJsonLd: false"],
        requiredOutcome: "For future transcript HTML, align visible episode title, date, audio/transcript relationship and PodcastEpisode JSON-LD.",
        verificationMethod: "Generate fresh transcript HTML and validate that PodcastEpisode schema matches visible content.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasFaqJsonLd === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-SCHEMA-FAQ", n),
        title: "Schema lens: transcript HTML lacks FAQPage JSON-LD",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: schema-markup-generator`, "hasFaqJsonLd: false"],
        requiredOutcome: "For future transcript HTML, add FAQPage JSON-LD only where matching visible Q&A or takeaway content exists.",
        verificationMethod: "Generate fresh transcript HTML and validate visible-content/schema alignment.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasMetaDescription === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-META", n),
        title: "Meta-tags lens: transcript HTML lacks a meta description",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: meta-tags-optimizer`, "hasMetaDescription: false"],
        requiredOutcome: "For future transcript HTML, include a concise meta description derived from the episode summary, not a raw transcript snippet.",
        verificationMethod: "Generate fresh transcript HTML and confirm the meta description is present and within the expected length range.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasCanonicalLink === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-TECH-CANONICAL", n),
        title: "Technical SEO lens: transcript HTML lacks a canonical link",
        severity: "medium",
        itemTitleOrId: label,
        evidence: [`skill: technical-seo-checker`, "hasCanonicalLink: false"],
        requiredOutcome: "For future transcript HTML, emit a stable canonical URL owned by the AIMS/R2 transcript generator.",
        verificationMethod: "Generate fresh transcript HTML and confirm canonical href is present and points to the published transcript page.",
      });
    }

    if (item.sourceFormat === "html" && flags.hasRelatedBookLink === false && flags.hasTopicLink === false) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-INTERNAL-LINKS", n),
        title: "Internal linking lens: transcript page lacks related book/topic paths",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: internal-linking-optimizer`, "relatedBookOrTopicLink: not detected"],
        requiredOutcome: "For future transcript HTML, add conservative related topic/book links where the episode genuinely supports them; keep this recommendation-only until generator evidence is stable.",
        verificationMethod: "Generate fresh transcript HTML and confirm relevant internal paths appear without unrelated ebook stuffing.",
      });
    }

    if (entities < 5) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-ENTITY", n),
        title: "Entity lens: transcript extraction has thin named-entity signals",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: entity-optimizer`, `namedEntityCount: ${entities}`],
        requiredOutcome: "For future transcript summaries and indexes, expose discussed organisations, people, technologies and policy topics before the full transcript body.",
        verificationMethod: "Rerun the transcript report and confirm the entity lens can identify the main discussed entities from the summary/index area.",
      });
    }

    const itemAge = ageDays(item.date || item.lastModified);
    if (itemAge !== null && itemAge > 90) {
      addTranscriptFinding(findings, makeFinding, {
        id: findingId("TRANSCRIPT-SKILL-REFRESH", n),
        title: "Content refresher lens: older transcript pages should be reviewed for template freshness",
        severity: "low",
        itemTitleOrId: label,
        evidence: [`skill: content-refresher`, `ageDays: ${itemAge}`],
        requiredOutcome: "For older transcript pages, review template-level metadata, schema and related-link freshness without rewriting the historical transcript text automatically.",
        verificationMethod: "Rerun the next monthly report and confirm older pages are either intentionally archived or still pass current template checks.",
      });
    }
  }
  return findings.slice(0, 24);
}

export function buildOnBrandSkillPreflightFindings(evidence = {}) {
  const findings = [];
  let count = 1;
  const push = (data) => findings.push(makeOnBrandFinding({ id: findingId("OB-SKILL", count++), ...data }));

  for (const item of arr(evidence?.rss?.items).slice(0, 12)) {
    const id = item.title || item.guid || item.link || "RSS item";
    const summaryWords = wordCount(item.summary);
    const text = `${item.title || ""} ${item.summary || ""}`;
    if (summaryWords && summaryWords < 35) {
      push({
        severity: "medium",
        sourceType: "rss_feed",
        itemTitleOrId: id,
        issueType: "skill lens: RSS summary below GEO/content depth range",
        exactEvidence: `summaryWords: ${summaryWords}`,
        why: "The adapted content-quality and GEO lenses need enough plain-language context for readers and answer engines.",
        rule: "content-quality-auditor + geo-content-optimizer: summary should carry a concise answer-first point.",
        remediation: "For future RSS output, ensure the summary states the concrete update, consequence and entity context rather than just teasing the item.",
      });
    }
    if (namedEntityCount(text) < 2) {
      push({
        severity: "low",
        sourceType: "rss_feed",
        itemTitleOrId: id,
        issueType: "skill lens: RSS item has thin entity context",
        exactEvidence: `namedEntityCount: ${namedEntityCount(text)}`,
        why: "Entity-light summaries are harder for monthly GEO/entity reports to classify.",
        rule: "entity-optimizer: expose the main named organisations, people, technologies or topics where natural.",
        remediation: "For future RSS rewrite output, preserve the key entity names from the source item when they are relevant and verified.",
      });
    }
  }

  for (const item of arr(evidence?.podcastTranscripts?.items).slice(0, 6)) {
    const id = item.title || item.sessionId || item.r2Key || "Podcast transcript";
    const flags = obj(item.htmlFeatureFlags);
    if (item.sourceFormat === "html" && flags.hasAeoSummaryBlock === false) {
      push({
        severity: "medium",
        sourceType: "podcast_transcript",
        itemTitleOrId: id,
        issueType: "skill lens: transcript lacks answer-first summary block",
        exactEvidence: "hasAeoSummaryBlock: false",
        why: "Transcript pages without a summary/index force readers and answer engines to mine the whole transcript body.",
        rule: "geo-content-optimizer: render summary, key takeaways and entity index before long-form content.",
        remediation: "For future podcast transcript layouts, add summary, takeaways, discussed entities and a transcript anchor before the full transcript body.",
      });
    }
    if (item.sourceFormat === "html" && flags.hasRelatedBookLink === false && flags.hasTopicLink === false) {
      push({
        severity: "low",
        sourceType: "podcast_transcript",
        itemTitleOrId: id,
        issueType: "skill lens: transcript lacks related internal paths",
        exactEvidence: "relatedBookOrTopicLink: not detected",
        why: "Relevant topic/book paths help the user journey without asking RAMS to edit R2-owned pages.",
        rule: "internal-linking-optimizer: add relevant internal paths only where the episode genuinely supports them.",
        remediation: "For future transcript HTML, add conservative related topic/book links from the generator when relevance evidence is available.",
      });
    }
  }

  return findings.slice(0, 18);
}

export default {
  AIMS_AUDIT_SKILL_LENSES,
  buildSkillLensSummary,
  buildEpisodeSkillLensFindings,
  buildTranscriptSkillLensFindings,
  buildOnBrandSkillPreflightFindings,
};
