import express from "express";
import { requestDedupe } from "../../services/shared/utils/requestDedupe.js";
import { getAsyncAuditRouteJobFresh, startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";
import { getContentMasterAuditStatus, runContentMasterAudit } from "../utils/contentMasterPipeline.js";
const router=express.Router(); const AUDIT_TYPE="content-master"; const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.get("/health",(_req,res)=>res.json({...getContentMasterAuditStatus(),routes:["GET /audits/content-master/health","POST /audits/content-master/run","GET /audits/content-master/jobs/:sessionId"],time:new Date().toISOString()}));
router.post("/run",requestDedupe("audits:content-master:run"),asyncRoute(async(req,res)=>{const job=await startAsyncAuditRouteJob({auditType:AUDIT_TYPE,payload:req.body||{},req,runner:runContentMasterAudit,metadata:{route:"audits.content-master.run"}});return res.status(202).json(job);}));
router.get("/jobs/:sessionId",asyncRoute(async(req,res)=>{const job=await getAsyncAuditRouteJobFresh(AUDIT_TYPE,req.params.sessionId,req);if(!job)return res.status(404).json({ok:false,auditType:AUDIT_TYPE,error:"Audit job not found"});return res.json(job);}));
export default router;
