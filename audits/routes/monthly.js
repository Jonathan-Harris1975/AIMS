import express from "express";
import { requestDedupe } from "../../services/shared/utils/requestDedupe.js";
import { startWebsiteAuditPipeline } from "../utils/websiteAuditPipeline.js";
import { startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";
import { runContentMasterAudit } from "../utils/contentMasterPipeline.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function nthWeekdayGuard(req, res, { weekday, occurrence, error, hint }) {
  const override = ["1", "true", "yes"].includes(String(req.body?.force || req.query?.force || "").toLowerCase());
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const actualWeekday = values.weekday;
  const dayOfMonth = Number(values.day);
  const actualOccurrence = Math.ceil(dayOfMonth / 7);
  if (!override && (actualWeekday !== weekday || actualOccurrence !== occurrence)) {
    res.status(409).json({ ok: false, error, weekday: actualWeekday, occurrence: actualOccurrence, hint });
    return false;
  }
  return true;
}

router.get("/health", (_req,res) => res.json({
  ok: true,
  auditType: "monthly",
  orchestrator: "AIMS",
  endpoints: ["POST /audits/monthly/website", "POST /audits/monthly/aims"],
  policy: "Website audit: first Sunday. AIMS master content audit: second Saturday. RAMS dispatch occurs only after each final audit report is complete.",
}));

router.post("/website", requestDedupe("audits:monthly:website"), asyncRoute(async (req,res) => {
  if (!nthWeekdayGuard(req, res, {
    weekday: "Sun",
    occurrence: 1,
    error: "website-monthly-audit-is-first-sunday-only",
    hint: "MAST should call this endpoint on the first Sunday of the month.",
  })) return;
  const result = await startWebsiteAuditPipeline({ ...(req.body || {}), requestedBy: "MAST monthly first-Sunday audit" });
  res.status(202).json(result);
}));

router.post("/aims", requestDedupe("audits:monthly:aims"), asyncRoute(async (req,res) => {
  if (!nthWeekdayGuard(req, res, {
    weekday: "Sat",
    occurrence: 2,
    error: "aims-monthly-audit-is-second-saturday-only",
    hint: "MAST should call this endpoint on the second Saturday of the month.",
  })) return;
  const job = await startAsyncAuditRouteJob({auditType:"content-master",payload:req.body||{},req,runner:runContentMasterAudit,metadata:{route:"audits.monthly.aims",requestedBy:"MAST monthly second-Saturday AIMS audit"}});
  res.status(202).json(job);
}));

export default router;
