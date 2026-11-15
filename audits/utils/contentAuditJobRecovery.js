import { readAuditJson } from './publishAuditArtifacts.js';

// Repair bookkeeping from saved evidence without rerunning sources or models.
export async function recoverContentAuditJob(sessionId, read = readAuditJson) {
  let latest;
  try { latest = await read({key:'audits/content-master/latest.json'}); }
  catch(error) { if(error?.$metadata?.httpStatusCode===404 || error?.name==='NoSuchKey') return null; throw error; }
  if(latest.sessionId!==sessionId) return null;
  const prefix=`audits/content-master/`;
  const reportPrefix=String(latest.reportPrefix||'');
  if(!reportPrefix.startsWith(prefix) || !/^audits\/content-master\/\d{4}-\d{2}\/[A-Za-z0-9._-]+$/.test(reportPrefix) ||
      reportPrefix.split('/').at(-1)!==sessionId) throw new Error('Saved content audit report identity is invalid');
  const key=`${reportPrefix}/content-audit.json`;
  const report=await read({key});
  if(report.schemaVersion!=='content-audit-report/v2' || report.sessionId!==sessionId) throw new Error('Saved content audit report identity mismatch');
  const complete=report.council?.synthesisState==='Complete' && report.sourceRefresh?.freshnessLocked===true;
  const dispatch=latest.ramsDispatch;
  const dispatched=complete && dispatch?.ok===true && dispatch.pipeline==='content' && dispatch.auditJsonKey===key &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(dispatch.runId||'');
  return {status:dispatched?'running':'failed',phase:dispatched?'awaiting-remediation':'remediation-blocked',evidenceRetentionRequired:true,
    error:dispatched?undefined:{message:'Saved content audit lacks complete synthesis or an exact durable RAMS handoff'},
    result:{ok:dispatched,remediationPending:dispatched,synthesisState:report.council?.synthesisState,sourceRefresh:report.sourceRefresh,
      reportJsonUrl:latest.reportJsonUrl,reportUrl:latest.reportUrl,reportHtmlUrl:latest.reportHtmlUrl,reportPrefix,
      ramsDispatch:dispatch,recoveredFromReport:true},
  };
}
