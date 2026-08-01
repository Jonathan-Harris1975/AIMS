import express from "express";
import { requestDedupe } from "../../services/shared/utils/requestDedupe.js";
import { startWebsiteAuditPipeline } from "../utils/websiteAuditPipeline.js";
import { startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";
import { runContentMasterAudit } from "../utils/contentMasterPipeline.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function saturdayGuard(req, res) {
  const override = ["1","true","yes"].includes(String(req.body?.force || req.query?.force || "").toLowerCase());
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(new Date());
  if (!override && weekday !== "Sat") {
    res.status(409).json({ ok:false, error:"monthly-audits-are-saturday-only", weekday, hint:"MAST should call these endpoints on the first Saturday of the month." });
    return false;
  }
  return true;
}

router.get("/health", (_req,res) => res.json({ok:true,auditType:"monthly",orchestrator:"AIMS",endpoints:["POST /audits/monthly/website","POST /audits/monthly/aims"],policy:"Saturday maintenance lane; RAMS dispatch occurs only after each final audit report is complete."}));

router.post("/website", requestDedupe("audits:monthly:website"), asyncRoute(async (req,res) => {
  if (!saturdayGuard(req,res)) return;
  const result = await startWebsiteAuditPipeline({...(req.body||{}), requestedBy:"MAST monthly first-Saturday audit"});
  res.status(202).json(result);
}));

router.post("/aims", requestDedupe("audits:monthly:aims"), asyncRoute(async (req,res) => {
  if (!saturdayGuard(req,res)) return;
  const job = await startAsyncAuditRouteJob({auditType:"content-master",payload:req.body||{},req,runner:runContentMasterAudit,metadata:{route:"audits.monthly.aims",requestedBy:"MAST monthly second-Saturday AIMS audit"}});
  res.status(202).json(job);
}));

export default router;
