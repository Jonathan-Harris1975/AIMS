// Read-only evaluation of independently labelled real/known-failure comparisons.
export function evaluateCouncilShadow(rows, { minimumCases = 50, minimumBlockers = 10 } = {}) {
  const unique = new Map();
  for (const row of rows) {
    const id = row.fingerprint || row.caseId;
    if (!id || unique.has(id)) throw new Error("Missing or duplicate evaluation case identity");
    unique.set(id, row);
  }
  const cases = [...unique.values()];
  const comparisons = cases.filter(row => row.baseline?.attendanceComplete === true && typeof row.baseline.ok === "boolean");
  const complete = comparisons.filter(row => row.candidate?.completed === true && typeof row.candidate.ok === "boolean");
  const blockerCases = cases.filter(row => row.expectedBlocking === true);
  const missedKnownBlockers = blockerCases.filter(row => row.candidate?.completed === true &&
    (row.candidate.ok === true || row.candidate.blocking !== true)).length;
  const candidateOnlyApprovals = complete.filter(row => row.candidate.ok && !row.baseline.ok).length;
  const baselineBlockerMisses = complete.filter(row => row.baseline.blocking === true && row.candidate.blocking !== true).length;
  const labelled = complete.filter(row => typeof row.expectedBlocking === "boolean" &&
    typeof row.qualityDelta === "number" && Number.isFinite(row.qualityDelta));
  const averageQualityDelta = labelled.length ? labelled.reduce((sum, row) => sum + row.qualityDelta, 0) / labelled.length : null;
  const measuredCosts = complete.filter(row => row.fullCostVerified === true &&
    [row.baselineCostGbp, row.candidateCostGbp].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0));
  const baselineCostGbp = measuredCosts.reduce((sum, row) => sum + row.baselineCostGbp, 0);
  const candidateCostGbp = measuredCosts.reduce((sum, row) => sum + row.candidateCostGbp, 0);
  const sufficientEvidence = cases.length >= minimumCases && comparisons.length === cases.length &&
    complete.length === cases.length && labelled.length === cases.length && blockerCases.length >= minimumBlockers &&
    measuredCosts.length === cases.length && baselineCostGbp > 0;
  return {
    protocol: "newsletter-targeted-shadow-evaluation-v1", cases: cases.length, completed: complete.length,
    labelled: labelled.length, blockerCases: blockerCases.length, missedKnownBlockers, candidateOnlyApprovals, baselineBlockerMisses,
    averageQualityDelta, measuredCostCases: measuredCosts.length,
    costComparison: measuredCosts.length ? { baselineCostGbp, candidateCostGbp, savingGbp: baselineCostGbp - candidateCostGbp,
      savingPercent: baselineCostGbp > 0 ? 100 * (baselineCostGbp - candidateCostGbp) / baselineCostGbp : null } : null,
    sufficientEvidence,
    readyForReview: sufficientEvidence && missedKnownBlockers === 0 && baselineBlockerMisses === 0 && candidateOnlyApprovals === 0 &&
      averageQualityDelta >= 0 && candidateCostGbp < baselineCostGbp,
    promotionAllowed: false, // This report never switches the publication policy.
  };
}
