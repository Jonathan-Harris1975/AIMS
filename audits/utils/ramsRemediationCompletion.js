// A RAMS processing report is not proof that its fixes have landed.
export async function readRamsRemediationCompletion({ pipeline, runId, config, fetchImpl = fetch }) {
  if (!['website', 'content'].includes(pipeline) || !/^[A-Za-z0-9._:-]{1,128}$/.test(runId || '')) {
    throw new Error('RAMS remediation requires an exact pipeline and runId');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs || 15000);
  try {
    const response = await fetchImpl(`${config.baseUrl}/remediation/${pipeline}/${encodeURIComponent(runId)}`, {
      headers: { authorization: `Bearer ${config.apiKey}` }, signal: controller.signal,
    });
    if (response.status === 202) return { status: 'pending', runId, pipeline };
    if (!response.ok) {
      const error = new Error(`RAMS remediation state returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const state = await response.json();
    if (state.pipeline !== pipeline || state.runId !== runId) throw new Error('RAMS remediation identity mismatch');
    if (!['pending', 'running', 'completed', 'attention_required'].includes(state.status)) {
      throw new Error('RAMS remediation status is invalid');
    }
    if (state.status === 'completed') {
      if (!Array.isArray(state.batches) || !Array.isArray(state.manualReview) || state.manualReview.length ||
          state.batches.some(batch => batch.status !== 'verified' || !/^[a-f0-9]{40}$/.test(batch.mergeSha || '') ||
            !batch.verification?.regressionTestPath || !batch.verification?.productionCheck)) {
        throw new Error('RAMS completion lacks verified repair, merge and production evidence');
      }
    }
    return state;
  } catch (error) {
    if (error instanceof TypeError || error.name === 'AbortError' || error.status >= 500 || error.status === 429) {
      return { status: 'pending', runId, pipeline, probeError: 'RAMS status temporarily unavailable; completion unverified' };
    }
    throw error;
  } finally { clearTimeout(timer); }
}
