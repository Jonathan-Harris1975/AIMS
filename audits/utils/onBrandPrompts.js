const SYSTEM_PROMPT = `You are the senior brand QA auditor for the Jonathan Harris AI ecosystem.

You audit published or scheduled editorial assets across RSS, Zernio/blog/social posts, and podcast transcripts. Historic evidence is calibration data for improving future output, not an instruction to rewrite old posts or transcripts.

You work from supplied evidence only.

You do not invent missing posts, transcripts, feed items, URLs, source files, dates, or runtime behaviour.

You are strict, specific, and unsentimental. Do not praise weak copy. Do not give generic writing advice. Every issue must include exact evidence and a future-facing guardrail that improves the next generated social posts, podcast transcripts, RSS feed wording, prompt guardrails, validators, or QA checks. Do not write as if historic assets must be edited after publication.

The Jonathan Harris brand is British English, Gen-X, dry, sceptical, sharp, calm, precise, human, spoken, and useful. It favours judgement over hype, signal over filler, and plain English over corporate theatre.

The work must not sound like:
- generic AI middleware
- press-release rewriting
- SEO filler
- motivational LinkedIn sludge
- newsroom cliché padding
- overexcited product coverage
- Americanised thought-leadership copy
- robotic explainer prose
- source material stitched together without editorial judgement

Return one strict JSON object only. No markdown. No code fences. No commentary outside JSON.`;

function listNames(values = []) {
  if (!Array.isArray(values)) return String(values || "");
  return values.map((value) => typeof value === "string" ? value : value?.sourceType).filter(Boolean).join(", ") || "None";
}

export function buildOnBrandAuditMessages({ evidence }) {
  const metadata = evidence?.metadata || {};
  const evidenceJson = JSON.stringify(evidence || {}, null, 2);
  const userPrompt = `Perform a complete on-brand audit of the supplied Jonathan Harris ecosystem evidence.

Audit window:
${metadata.windowStart || "Not verified from supplied evidence"} to ${metadata.windowEnd || "Not verified from supplied evidence"}

Sources included:
${listNames(metadata.includedSources)}

Sources blocked or partial:
${listNames([...(metadata.blockedSources || []), ...(metadata.partialSources || [])])}

Primary objective:
Identify patterns in the supplied evidence that should be corrected in future generated output: future social posts, future podcast transcript layout and spoken-copy shaping, and future RSS feed wording.

Do not merely say something is “good” or “needs improvement”. Prove it with exact evidence, then explain the future guardrail. Historic examples are evidence for the QA loop, not a demand to edit old live content.

For each issue:
- quote the exact wording
- identify the source type
- explain why it is off-brand
- name the violated brand rule
- give the smallest useful future-facing guardrail
- group repeated phrase-level findings into one useful generation guardrail per source/item where possible
- provide an improved future shaping example where helpful
- assign severity
- assign confidence
- state whether the issue is content-level, prompt-level, validator-level, source-selection-level, or pipeline-level

Required JSON contract:

{
  "auditCompletionState": "Complete | Partial",
  "sessionId": string,
  "generatedAt": string,
  "window": {
    "start": string,
    "end": string,
    "lookbackDays": number
  },
  "executiveVerdict": {
    "status": "Fully on-brand | Mostly on-brand with minor drift | Partially on-brand with systemic drift | Not on-brand",
    "summary": string,
    "bluntAssessment": string
  },
  "sourceCoverage": [
    {
      "sourceType": "zernio_blog_social | podcast_transcript | rss_feed",
      "status": "complete | partial | blocked",
      "itemsInspected": number,
      "evidenceMethod": string,
      "limitations": string[]
    }
  ],
  "scorecard": {
    "overallBrandFit": number,
    "rssBrandFit": number,
    "zernioBlogSocialBrandFit": number,
    "podcastTranscriptBrandFit": number,
    "titleQuality": number,
    "spokenNaturalness": number,
    "editorialAuthority": number,
    "antiHypeControl": number,
    "implementationReadiness": number
  },
  "confirmedStrengths": [
    {
      "sourceType": string,
      "evidence": string,
      "whyItWorks": string
    }
  ],
  "confirmedDefectsLedger": [
    {
      "issueId": string,
      "severity": "critical | high | medium | low",
      "confidence": "confirmed | probable | needs verification",
      "sourceType": "zernio_blog_social | podcast_transcript | rss_feed | pipeline",
      "itemTitleOrId": string,
      "issueType": string,
      "exactEvidence": string,
      "whyItIsOffBrand": string,
      "violatedRule": string,
      "rootCauseLevel": "content | prompt | validator | source selection | pipeline | unknown",
      "exactRemediation": string,
      "improvedExample": string,
      "verificationMethod": string
    }
  ],
  "rssFindings": {
    "verdict": string,
    "titlePatternAnalysis": string,
    "summaryToneAnalysis": string,
    "defects": []
  },
  "zernioBlogSocialFindings": {
    "verdict": string,
    "postPatternAnalysis": string,
    "defects": []
  },
  "podcastTranscriptFindings": {
    "verdict": string,
    "openingStrength": string,
    "flowAndTransitions": string,
    "repetitionWatchlist": string[],
    "spokenWordFixes": [
      {
        "originalLine": string,
        "improvedLine": string,
        "reason": string
      }
    ],
    "defects": []
  },
  "patternLevelDiagnosis": {
    "repeatedTitleProblems": string[],
    "repeatedToneProblems": string[],
    "repeatedSpokenProblems": string[],
    "crossChannelBrandDrift": string[]
  },
  "promptLevelDiagnosis": [
    {
      "affectedArea": string,
      "diagnosis": string,
      "evidence": string,
      "recommendedPromptChange": string
    }
  ],
  "pipelineLevelDiagnosis": [
    {
      "affectedFileOrService": string,
      "diagnosis": string,
      "evidence": string,
      "smallestSafeFix": string
    }
  ],
  "rankedRemediationPlan": [
    {
      "priority": number,
      "severity": string,
      "action": string,
      "affectedSource": string,
      "affectedFilesOrServices": string[],
      "whyThisComesFirst": string,
      "implementationNotes": string,
      "verificationMethod": string
    }
  ],
  "doNotChange": [
    {
      "area": string,
      "reason": string,
      "evidence": string
    }
  ],
  "limitations": string[]
}

Rules:
- Scores are 0 to 100.
- Use “Not verified from supplied evidence” instead of guessing.
- If a source is blocked, say exactly why.
- If only scheduled Zernio posts are available, do not call them published posts.
- If podcast transcript discovery is partial, say so.
- If the RSS feed is accessible but thin, audit the thinness.
- Every high or critical issue must include a concrete future guardrail.
- Do not use retroactive wording such as “cleanup”, “fix the old post”, “rewrite existing copy”, or “confirm the phrase no longer appears”. Say “tighten future QA”, “future guardrail”, and “confirm fresh output avoids the pattern”.
- Do not list every repeated banned phrase as a separate ticket when one grouped anti-hype guardrail is more useful.
- Do not recommend rewriting whole systems where a prompt, validator, source-selection, layout, or QA guardrail fix is enough.
- Prefer small, safe implementation fixes that improve future output and preserve the existing architecture.

Evidence payload:
${evidenceJson}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}

export function buildOnBrandRepairMessages({ raw, evidence }) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "The previous on-brand audit response was not valid JSON or did not match the required object shape.",
        "Return one corrected strict JSON object only. No markdown. No prose outside JSON.",
        "Do not add facts beyond the evidence.",
        "Previous raw response:",
        String(raw || "").slice(0, 12000),
        "Evidence payload:",
        JSON.stringify(evidence || {}, null, 2),
      ].join("\n\n"),
    },
  ];
}

export default {
  buildOnBrandAuditMessages,
  buildOnBrandRepairMessages,
};
