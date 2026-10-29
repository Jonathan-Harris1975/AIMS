import { fetchWithTimeout } from '../../shared/http-client.js';

export const MAINTENANCE_REPOSITORIES = Object.freeze([
  'AIMS', 'MAST', 'jonathan-harris-website', 'RAMS', 'IRS', 'HIVE-UI', 'HIVE', 'AIMS-UI',
]);
const MAINTENANCE_WORKFLOWS = new Set([
  'ci.yml', 'council.yml', 'dast.yml', 'production-readiness.yml', 'ebook-subsystem-ci.yml',
  'security.yml', 'codeql.yml', 'item6-hardening.yml', 'staging-gate.yml',
]);
let busyCache = null;
export async function checkWeekendMaintenance({ fetcher = fetchWithTimeout, now = new Date() } = {}) {
  // Cache only busy results, never a clearance. Bounds unauthenticated GitHub reads on recovery ticks.
  if (fetcher === fetchWithTimeout && busyCache?.until > now.getTime()) return busyCache.result;
  const token = String(process.env.GITHUB_TOKEN_WEBSITE_AUDITS || '').trim();
  const checks = await Promise.all(MAINTENANCE_REPOSITORIES.map(async repository => {
    try {
      const response = await fetcher(`https://api.github.com/repos/Jonathan-Harris1975/${repository}/actions/runs?status=in_progress&per_page=100`, {
        timeout: 10000, headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.workflow_runs) || data.total_count > 100) throw new Error('Incomplete GitHub workflow evidence');
      return { repository, ok: true, busy: data.workflow_runs.filter(run =>
        MAINTENANCE_WORKFLOWS.has(String(run.path || '').split('/').pop())
      ).map(run => ({ name: run.name, id: run.id })) };
    } catch (error) { return { repository, ok: false, error: error.message, busy: [] }; }
  }));
  const result = { ok: checks.every(check => check.ok), busy: checks.some(check => check.busy.length), checks };
  if (fetcher === fetchWithTimeout && (!result.ok || result.busy)) busyCache = { until: now.getTime() + 10 * 60000, result };
  return result;
}
