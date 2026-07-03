// ============================================================
// 🎙️ Spoken cadence validator
// ============================================================
// Flags podcast script passages that would read as dense briefing-memo
// prose rather than natural spoken delivery (audit OB-006).
//
// Long-sentence detection already exists and is actively used in
// services/script/utils/scriptValidation.js (findLongSpokenSentences,
// validateSpokenCopy) with its own configurable soft/hard limits — this
// validator deliberately reuses that implementation rather than
// re-implementing sentence splitting, per "improve existing systems, don't
// replace working systems". The net-new check here is the "list of three"
// pattern: ordinal enumerations with no worked example or pause cue between
// items, which nothing in the codebase currently flags.
// ============================================================

import { findLongSpokenSentences } from "../../script/utils/scriptValidation.js";
import { emitQaEvent } from "../../shared/utils/qaEvents.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

// Matches "First habit: ... Second habit: ... Third ..." style enumerations
// and generic ordinal list markers without an inline example/pause cue.
const ORDINAL_LIST_MARKER = /\b(first|second|third|fourth|fifth)\b[,:]?/gi;
const EXAMPLE_CUE = /\bfor example\b|\be\.g\.\b|\bsay\b|\bimagine\b|\[pause/i;

export function validateSpokenCadence(text = "", { source = "unknown", emit = false, maxClauseWords } = {}) {
  const longSentences = findLongSpokenSentences(text, {
    maxWords: maxClauseWords || THRESHOLDS.validators.spokenMaxClauseWords,
  });

  const listMarkers = [...String(text || "").matchAll(ORDINAL_LIST_MARKER)];
  const bareListRun = listMarkers.length >= THRESHOLDS.validators.spokenMaxBareListItems + 1 && !EXAMPLE_CUE.test(text);

  const defects = [];
  if (longSentences.length) {
    defects.push(
      `${longSentences.length} sentence(s) exceed ${maxClauseWords || THRESHOLDS.validators.spokenMaxClauseWords} spoken words; insert a pause marker or split into shorter spoken sentences.`
    );
  }
  if (bareListRun) {
    defects.push(
      `${listMarkers.length} ordinal list items detected with no worked example or [pause] cue between them; add a one-line example per item.`
    );
  }

  const result = {
    ok: defects.length === 0,
    defects,
    longSentenceCount: longSentences.length,
    longSentenceSamples: longSentences.slice(0, 3).map((item) => item.sentence.slice(0, 140)),
    listMarkerCount: listMarkers.length,
  };

  if (emit && defects.length) {
    emitQaEvent({
      source: `validator.spoken-cadence.${source}`,
      type: "spoken_cadence_defects",
      severity: "low",
      message: `${defects.length} spoken cadence defect(s) found`,
      detail: result,
    });
  }

  return result;
}

export default { validateSpokenCadence };
