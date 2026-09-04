import { info, warn } from "../../logger.js";
function clean(v){return String(v||"").trim();} function boolEnv(name,fallback){const r=clean(process.env[name]).toLowerCase();if(!r)return fallback;if(["1","true","yes",
  "on"].includes(r))return true;if(["0","false","no","off"].includes(r))return false;return fallback;} function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
export function getRamsContentDispatchConfig(){return {enabled:boolEnv("CONTENT_AUDIT_TRIGGER_RAMS",false),baseUrl:clean(process.env.RAMS_BASE_URL||
  process.env.RMS_BASE_URL).replace(/\/+$/, ""),apiKey:clean(process.env.RAMS_API_KEY||process.env.RMS_API_KEY),timeoutMs:Math.max(1000,Number(
    process.env.RAMS_DISPATCH_TIMEOUT_MS||15000)),maxAttempts:Math.max(1,Math.min(5,Number(process.env.RAMS_DISPATCH_MAX_ATTEMPTS||5)))};}
function validateKey(key){const v=clean(key).replace(/^\/+/,"");if(!/^audits\/content-master\/\d{4}-\d{2}\/[A-Za-z0-9._-]+\/content-audit\.json$/.test(v))throw new Error(
  `RAMS content dispatch requires final content audit JSON key; received ${v||"<empty>"}`);return v;}
export async function dispatchContentAuditToRams({sessionId,auditJsonKey}){const c=getRamsContentDispatchConfig();if(!c.enabled)return {ok:true,status:"disabled",enabled:false,
  reason:"Enable CONTENT_AUDIT_TRIGGER_RAMS only after RAMS exposes POST /rebuild/content/run"};if(!c.apiKey)throw new Error(
    "CONTENT_AUDIT_TRIGGER_RAMS is enabled but RAMS_API_KEY or RMS_API_KEY is not configured");if(!c.baseUrl)throw new Error(
      "CONTENT_AUDIT_TRIGGER_RAMS is enabled but RAMS_BASE_URL is empty");const finalKey=validateKey(auditJsonKey);let last;for(let attempt=1;attempt<=c.maxAttempts;attempt++){
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),c.timeoutMs);try{const response=await fetch(`${c.baseUrl}/rebuild/content/run`,{
          method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${c.apiKey}`,"x-idempotency-key":`content-audit:${sessionId}`},body:JSON.stringify({
            audit_json_key:finalKey,audit_session_id:sessionId,schema_version:"rams-content/v1"}),signal:controller.signal});const t=await response.text();let payload={};try{
              payload=t?JSON.parse(t):{};}catch{payload={raw:t.slice(0,1000)}}if(response.status!==202){const e=new Error(
                `RAMS content rebuild dispatch returned HTTP ${response.status}`);e.status=response.status;throw e;}info("audit.content-master.rams.dispatched",{sessionId,
                  attempt});return {ok:true,status:"accepted",enabled:true,attempt,...payload};}catch(e){last=e;warn("audit.content-master.rams.dispatch_retry",{sessionId,
                    attempt,maxAttempts:c.maxAttempts,message:e?.message||String(e)});if(attempt<c.maxAttempts)await sleep(500*attempt);}finally{clearTimeout(timer);
                      }}throw last||new Error("RAMS content rebuild dispatch failed");}
export const __ramsContentDispatchTestHooks={validateKey,boolEnv};
