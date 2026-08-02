function normaliseStatus(value) {
  const status = String(value || "completed").trim().toLowerCase();
  return ["queued", "running", "completed", "failed"].includes(status) ? status : "completed";
}

export function buildAuditCallbackDiagnostics(payload = {}, existingJob = {}) {
  const artefacts = payload.artefacts && typeof payload.artefacts === "object" ? payload.artefacts : {};
  const blockedTests = Array.isArray(payload.blockedTests) ? payload.blockedTests : [];
  const stage3Blocks = Array.isArray(payload.stage3Blocks) ? payload.stage3Blocks : [];
  return {
    receivedStatus: normaliseStatus(payload.status),
    message: payload.message || null,
    error: payload.error || null,
    storageUploadError: payload.storageUploadError || null,
    workflowRunUrl: payload.workflowRunUrl || existingJob?.workflowRunUrl || null,
    failedStep: payload.failedStep || null,
    exitCode: payload.exitCode ?? null,
    sourceRevisionSha: payload.sourceRevisionSha || null,
    workflowLogTail: payload.workflowLogTail || null,
    existingCallbackMarker: payload.existingCallbackMarker || null,
    existingCallbackMarkerReadError: payload.existingCallbackMarkerReadError || null,
    artefactNames: Object.keys(artefacts),
    artefactCount: Object.keys(artefacts).length,
    blockedTests: blockedTests.slice(0, 40),
    blockedTestCount: blockedTests.length,
    stage3Blocks: stage3Blocks.slice(0, 40),
    stage3BlockCount: stage3Blocks.length,
    callbackKeys: Object.keys(payload).sort(),
  };
}

export const __auditCallbackDiagnosticsTestHooks = { normaliseStatus };

export default { buildAuditCallbackDiagnostics };
