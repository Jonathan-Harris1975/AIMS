import express from "express";
import { requestDedupe } from "../../services/shared/utils/requestDedupe.js";
import { startWebsiteAuditPipeline } from "../utils/websiteAuditPipeline.js";
import { startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";
import { runContentMasterAudit } from "../utils/contentMasterPipeline.js";

import { nthWeekdayGuard } from "../utils/monthlyAuditWindow.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


router.get("/health", (_req,res) => res.json({
  ok: true,
  auditType: "monthly",
  orchestrator: "AIMS",
  endpoints: ["POST /audits/monthly/website", "POST /audits/monthly/aims"],
  policy: "Website audit: first Friday. AIMS master content audit: second Friday. RAMS dispatch occurs only after each final audit report is complete.",
}));

router.post("/website", requestDedupe("audits:monthly:website"), asyncRoute(async (req,res) => {
  if (!nthWeekdayGuard(req, res, {
    weekday: "Fri",
    occurrence: 1,
    error: "website-monthly-audit-is-first-friday-only",
    hint: "MAST should call this endpoint on the first Friday of the month.",
  })) return;
  const result = await startWebsiteAuditPipeline({ ...(req.body || {}), requestedBy: "MAST monthly first-Friday audit" });
  res.status(202).json(result);
}));

router.post("/aims", requestDedupe("audits:monthly:aims"), asyncRoute(async (req,res) => {
  if (!nthWeekdayGuard(req, res, {
    weekday: "Fri",
    occurrence: 2,
    error: "aims-monthly-audit-is-second-friday-only",
    hint: "MAST should call this endpoint on the second Friday of the month.",
  })) return;
  const job = await startAsyncAuditRouteJob({auditType:"content-master",payload:req.body||{},req,runner:runContentMasterAudit,metadata:{route:"audits.monthly.aims",requestedBy:
    "MAST monthly second-Friday AIMS audit"}});
  res.status(202).json(job);
}));

export default router;
