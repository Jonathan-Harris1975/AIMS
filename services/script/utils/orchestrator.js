// ====================================================================
// orchestrator.js 
// ====================================================================

import { info, error, debug } from "../../../logger.js";
import models from "./models.js";
import { composeEpisode } from "../routes/composeScript.js";
import { uploadText } from "../../shared/utils/r2-client.js"
import chunkText from "./chunkText.js";
import { generateEpisodeMetaLLM } from "./podcastHelper.js";
import * as sessionCache from "./sessionCache.js";
import { attachEpisodeNumberIfNeeded } from "./episodeCounter.js";
import editAndFormat from "./editAndFormat.js";
import { runEditorialPass } from "./editorialPass.js";
import { findLongSpokenSentences, validateTranscriptSourceIntegrity, validateTranscriptStructure } from "./scriptValidation.js";
import { validateSpokenCadence } from "../../content-quality/validators/spokenCadenceValidator.js";
import { runReviewCouncilGate } from "../../content-quality/reviewCouncil.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";

function evaluatePodcastTranscriptGate(text = "", sessionMeta = {}) {
  const structure = validateTranscriptStructure(text);
  const sourceIntegrity = validateTranscriptSourceIntegrity(text, sessionMeta);
  const structureReasons = structure.ok ? [] : (structure.reasons || []);
  const cadenceOnly = structureReasons.length > 0 && structureReasons.every((reason) => /sentence\(s\) exceed/i.test(String(reason || "")));
  const hardCadenceDefects = cadenceOnly ? getHardLongSentenceDefects(text) : [];
  const softCadenceOnly = cadenceOnly && hardCadenceDefects.length === 0;
  const defects = [
    ...(softCadenceOnly ? [] : structureReasons),
    ...(sourceIntegrity.ok ? [] : sourceIntegrity.defects || []),
  ];
  const warnings = [
    ...(sourceIntegrity.warnings || []),
    ...(softCadenceOnly ? structureReasons : []),
  ];
  return {
    ok: defects.length === 0,
    score: Math.max(0, 100 - (defects.length * 12)),
    threshold: 88,
    defects,
    warnings,
  };
}

function extractRepairableMain(text = "", lockedIntro = "", lockedOutro = "", fallbackMain = "") {
  let body = String(text || "").trim();
  const intro = String(lockedIntro || "").trim();
  const outro = String(lockedOutro || "").trim();
  if (intro && body.startsWith(intro)) body = body.slice(intro.length).trim();
  if (outro && body.endsWith(outro)) body = body.slice(0, -outro.length).trim();
  return body || String(fallbackMain || "").trim();
}

async function repairPodcastTranscriptForCouncil(candidate = {}, { gate, attempt, sessionMeta, lockedIntro, lockedOutro, fallbackMain } = {}) {
  const fullText = String(candidate?.text || "").trim();
  const mainText = extractRepairableMain(fullText, lockedIntro, lockedOutro, fallbackMain);
  const defects = Array.isArray(gate?.defects) ? gate.defects.slice(0, 10) : [];
  const raw = await resilientRequest("editorialPass", {
    sessionId: sessionMeta?.sessionId,
    section: `transcript-repair-${attempt || 1}`,
    messages: [{
      role: "user",
      content: `You are the final review editor for Turing's Torch, hosted by a recognised British AI industry expert.

Repair only the listed defects in the MAIN BODY below. The intro and branded outro are locked by code and will be reattached after your repair, so DO NOT create an intro or outro. Preserve all supported facts, the existing argument, approximate length and dry Gen-X voice. Use British English. Do not add facts, numbers, quotations, names or claims that are not already in the text. If a claim is flagged as unsupported, remove or soften it rather than guessing. Keep the result natural for spoken delivery. Return the repaired MAIN BODY only as plain transcript text.

Repair attempt: ${attempt || 1}
Defects:
${defects.map((d) => `- ${d}`).join("\n") || "- Transcript quality gate failed"}

MAIN BODY:
${mainText}`,
    }],
    temperature: Math.max(0.12, 0.22 - ((Number(attempt) || 1) * 0.02)),
    max_tokens: Number(process.env.PODCAST_REPAIR_MAX_TOKENS || 16000),
    timeoutMs: Number(process.env.PODCAST_REPAIR_TIMEOUT_MS || 900000),
    reasoning: { effort: process.env.PODCAST_REPAIR_REASONING_EFFORT || "none", exclude: true },
  });
  const repairedMain = String(raw || mainText).trim() || mainText;
  // Never trust an LLM repair to preserve deterministic brand blocks. Reattach them here.
  return { text: [lockedIntro, repairedMain, lockedOutro].filter(Boolean).join("\n\n").trim() };
}

function hasOnlyRepairableSpokenLengthDefects(validation = {}) {
  const reasons = Array.isArray(validation.reasons) ? validation.reasons : [];
  return reasons.length > 0 && reasons.every((reason) => /sentence\(s\) exceed/i.test(String(reason || "")));
}

function hardSentenceLimit() {
  const soft = Number(process.env.PODCAST_TRANSCRIPT_MAX_SENTENCE_WORDS || 25);
  const configured = Number(process.env.PODCAST_TRANSCRIPT_HARD_MAX_SENTENCE_WORDS || 40);
  const base = Number.isFinite(soft) && soft >= 12 ? soft : 25;
  return Number.isFinite(configured) && configured >= base ? Math.floor(configured) : Math.max(40, base + 12);
}

function getHardLongSentenceDefects(text = "") {
  const limit = hardSentenceLimit();
  return findLongSpokenSentences(text, { maxWords: limit });
}


const {
  generateIntro,
  generateMain,
  generateOutro,
} = models;

// Cleanup after a few minutes to avoid session buildup
function scheduleCleanup(sessionId) {
  setTimeout(async () => {
    try {
      sessionCache.clearSession(sessionId);
    } catch (_) {}
  }, 4 * 60 * 1000);
}


function normalisedSpokenWords(text = "") {
  return String(text || "").toLowerCase().replace(/[’']/g, "").match(/[a-z0-9]+/g) || [];
}

function stripLeadingIntroEcho(main = "", intro = "") {
  const body = String(main || "").trim();
  const introText = String(intro || "").trim();
  if (!body || !introText) return body;

  const introWords = normalisedSpokenWords(introText);
  const bodyWords = normalisedSpokenWords(body);
  const probeLength = Math.min(60, introWords.length, bodyWords.length);
  if (probeLength < 20) return body;

  let matches = 0;
  for (let i = 0; i < probeLength; i += 1) {
    if (introWords[i] === bodyWords[i]) matches += 1;
  }
  if (matches / probeLength < 0.9) return body;

  const tokenRe = /[A-Za-z0-9]+/g;
  let match, count = 0, cut = 0;
  while ((match = tokenRe.exec(body)) !== null && count < introWords.length) {
    count += 1;
    cut = tokenRe.lastIndex;
  }
  const tail = body.slice(cut);
  const boundary = tail.match(/^[\s,;:.\-–—!?]*(?:\n\s*)*/);
  return body.slice(cut + (boundary?.[0]?.length || 0)).trim();
}

export async function orchestrateScript(input) {
  // Support both legacy string version and meta-object version
  const sessionMeta =
    typeof input === "string"
      ? { sessionId: input }
      : input && typeof input === "object"
      ? { ...input }
      : {};

  const sid =
    sessionMeta.sessionId ||
    sessionMeta.id ||
    `TT-${new Date().toISOString().slice(0, 10)}`;

  sessionMeta.sessionId = sid;

  debug("🧠 Orchestrate Script: start", { sessionId: sid });

  try {
    // ============================================================
    // 1) Generate intro, main, outro (using updated Option A models)
    // ============================================================
    const intro = await generateIntro(sid);
    const generatedMain = await generateMain(sid);
    const main = stripLeadingIntroEcho(generatedMain, intro);
    if (main !== String(generatedMain || "").trim()) {
      info("script.main.intro_echo_removed", { sessionId: sid });
    }
    const outro = await generateOutro(sid);

    // ============================================================
    // 2) High-level composition pass (structure, ordering, cleanup)
    // ============================================================
    const composed = await composeEpisode({
      sessionId: sid,
      intro,
      main,
      outro,
    });

    const initialFullText =
      composed?.fullText ?? [intro, main, outro].join("\n\n");

    const initialValidation = validateTranscriptStructure(initialFullText);
    if (!initialValidation.ok) {
      const repairableSpokenLength = hasOnlyRepairableSpokenLengthDefects(initialValidation);
      const logPayload = {
        sessionId: sid,
        reasons: initialValidation.reasons,
        repairableSpokenLength,
      };
      if (repairableSpokenLength) {
        info("script.validation.composed.repairable", logPayload);
      } else {
        error("script.validation.composed.needs_repair", logPayload);
      }
    }

    // ============================================================
    // 3) Editorial Pass (main-section only, outro kept deterministic)
    // ============================================================
    const editorialMain = await runEditorialPass(
      { sessionId: sid, ...sessionMeta, section: "main" },
      main
    );

    const mainCandidate = (editorialMain && editorialMain.trim()) || main;
    const editorialCandidate = [intro, mainCandidate, outro].filter(Boolean).join("\n\n");
    const editorialValidation = validateTranscriptStructure(editorialCandidate);
    const safeEditorialText = editorialValidation.ok ? editorialCandidate : initialFullText;

    if (!editorialValidation.ok) {
      info("editorialPass.fallback.initialScript", {
        sessionId: sid,
        reasons: editorialValidation.reasons,
        preservedOutro: true,
      });
    }

    // ============================================================
    // 4) Local formatting pass (punctuation, spacing, flow polish)
    // ============================================================
    const formattedText = editAndFormat(safeEditorialText);

    let finalCandidate =
      (formattedText && formattedText.trim()) ||
      safeEditorialText ||
      initialFullText;

    let transcriptGate = evaluatePodcastTranscriptGate(finalCandidate, sessionMeta);
    if (!transcriptGate.ok) {
      const reviewed = await runReviewCouncilGate({
        councilKey: "podcast-on-brand",
        gate: transcriptGate,
        artifact: { text: finalCandidate },
        contentType: "podcast-transcript",
        repairArtifact: (candidate, context = {}) => repairPodcastTranscriptForCouncil(candidate, {
          ...context,
          sessionMeta: { ...sessionMeta, sessionId: sid },
          lockedIntro: intro,
          lockedOutro: outro,
          fallbackMain: mainCandidate,
        }),
        validate: (candidate) => evaluatePodcastTranscriptGate(candidate?.text || "", sessionMeta),
        logger: error,
      });
      if (!reviewed.ok) {
        throw new Error(`Podcast transcript failed after review council: ${(reviewed.gate?.defects || []).join("; ")}`);
      }
      finalCandidate = String(reviewed.artifact?.text || finalCandidate).trim();
      transcriptGate = reviewed.gate;
      info("script.validation.reviewCouncil.approved", {
        sessionId: sid,
        attemptsUsed: reviewed.reviewCouncil?.attemptsUsed,
        score: reviewed.gate?.score,
      });
    }

    const finalValidation = validateTranscriptStructure(finalCandidate);
    if (!finalValidation.ok) {
      const repairableSpokenLength = hasOnlyRepairableSpokenLengthDefects(finalValidation);
      const hardLongSentences = repairableSpokenLength ? getHardLongSentenceDefects(finalCandidate) : [];
      if (repairableSpokenLength && hardLongSentences.length === 0) {
        info("script.validation.final.soft_warn", {
          sessionId: sid,
          reasons: finalValidation.reasons,
          softMaxSentenceWords: Number(process.env.PODCAST_TRANSCRIPT_MAX_SENTENCE_WORDS || 25),
          hardMaxSentenceWords: hardSentenceLimit(),
        });
      } else {
        error("script.validation.final.fail", {
          sessionId: sid,
          reasons: finalValidation.reasons,
          hardLongSentenceExamples: hardLongSentences.slice(0, 3),
        });
        throw new Error(`Final script failed structure validation: ${finalValidation.reasons.join("; ")}`);
      }
    }

    const transcriptSourceIntegrity = validateTranscriptSourceIntegrity(finalCandidate, sessionMeta);
    if (!transcriptSourceIntegrity.ok) {
      error("script.validation.sourceIntegrity.fail", {
        sessionId: sid,
        defects: transcriptSourceIntegrity.defects,
      });
      throw new Error(`Final script failed source-integrity validation: ${transcriptSourceIntegrity.defects.join("; ")}`);
    }
    if (transcriptSourceIntegrity.warnings.length) {
      info("script.validation.sourceIntegrity.warn", {
        sessionId: sid,
        warnings: transcriptSourceIntegrity.warnings,
      });
    }

    // Non-blocking: flag dense "list of three" enumerations with no worked
    // example between items (audit OB-006). This informs future shaping
    // passes without failing an otherwise-valid episode.
    const spokenCadence = validateSpokenCadence(finalCandidate, { source: "podcast-orchestrator", emit: true });
    if (!spokenCadence.ok) {
      info("script.validation.spokenCadence.warn", { sessionId: sid, defects: spokenCadence.defects });
    }

    const finalFullText = finalCandidate;

    // ============================================================
    // 5) Chunk for TTS + upload to R2
    // ============================================================
    const chunks = chunkText(finalFullText);
    const uploadedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const key = `${sid}/chunk-${String(i + 1).padStart(3, "0")}.txt`;
      await uploadText("rawtext", key, chunks[i], "text/plain");
      uploadedChunks.push(key);
    }

    // ============================================================
    // 6) Store full transcript
    // ============================================================
    await uploadText("transcript", `${sid}.txt`, finalFullText, "text/plain");

    // ============================================================
    // 7) Metadata (title, SEO, artwork prompt, episode number)
    // ============================================================
    let meta = await generateEpisodeMetaLLM(finalFullText, {
      sessionId: sid,
      date: sessionMeta.date,
      episodeNumber: sessionMeta.episodeNumber,
    });

    meta = await attachEpisodeNumberIfNeeded(meta);

    const metaKey = `${sid}.json`;
    await uploadText(
      "meta",
      metaKey,
      JSON.stringify(meta, null, 2),
      "application/json"
    );

    // ============================================================
    // 8) Generate and upload HTML transcript
    // ============================================================
    try {
      const { generateTranscriptHtml } = await import("./generateTranscriptHtml.js");
      const siteBaseUrl = process.env.SITE_BASE_URL || "https://jonathan-harris.online";
      const transcriptHtmlBase =
        process.env.PODCAST_TRANSCRIPT_HTML_BASE_URL ||
        process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML ||
        `${String(siteBaseUrl).replace(/\/$/, "")}/transcripts` ||
        process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT ||
        "";
      const htmlContent = generateTranscriptHtml(sid, finalFullText, meta, transcriptHtmlBase);
      await uploadText("transcript", `${sid}.html`, htmlContent, "text/html");
      info("📄 HTML transcript uploaded", { sessionId: sid });
    } catch (htmlErr) {
      // Non-fatal — txt transcript is already saved, HTML is a bonus
      error("⚠️ HTML transcript generation failed", {
        sessionId: sid,
        error: htmlErr?.message,
      });
    }

    // ============================================================
    // 9) Session cleanup (optional)
    // ============================================================
    scheduleCleanup(sid);

    info("✅ Script orchestration complete");

    return {
      ...composed,
      fullText: finalFullText,
      chunks: uploadedChunks,
      metadata: meta,
      quality: {
        transcriptSourceIntegrity,
      },
    };

  } catch (err) {
    error("💥 Script orchestration failed", {
      sessionId: sid,
      error: err?.message,
      stack: err?.stack,
    });
    throw err;
  }
}

export const orchestrateEpisode = orchestrateScript;
export default orchestrateScript;
