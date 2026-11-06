import express from "express";
import { getAsyncServiceRouteJobFresh, startAsyncServiceRouteJob } from "../shared/utils/asyncServiceRouteJobs.js";
import { CONFIRMATION, createHousekeepingService } from "./service.js";

export function createStorageHousekeepingRouter({ service = createHousekeepingService() } = {}) {
  const router = express.Router();
  router.get("/status", async (_req, res, next) => {
    try {
      const status = await service.status();
      res.status(status.ok ? 200 : 503).json(status);
    } catch (error) { next(error); }
  });
  router.post("/run", async (req, res, next) => {
    try {
      for (const field of ["dryRun", "force"]) {
        if (req.body?.[field] !== undefined && typeof req.body[field] !== "boolean") {
          return res.status(400).json({ ok: false, error: `${field} must be a boolean` });
        }
      }
      const dryRun = req.body?.dryRun !== false;
      if (!dryRun && req.body?.confirmation !== CONFIRMATION) return res.status(422).json({ ok: false, error: "Housekeeping confirmation is required" });
      const job = await startAsyncServiceRouteJob({
        service: "storage-housekeeping", lane: "weekly", req, statusBasePath: "/storage/housekeeping/jobs",
        payload: { sessionId: req.body?.sessionId }, runner: () => service.run({ dryRun, force: req.body?.force === true }),
        metadata: { route: "/storage/housekeeping/run", dryRun },
      });
      return res.status(202).json(job);
    } catch (error) { next(error); }
  });
  router.get("/jobs/weekly/:sessionId", async (req, res, next) => {
    try {
      const job = await getAsyncServiceRouteJobFresh("storage-housekeeping", "weekly", req.params.sessionId, req);
      return res.status(job ? 200 : 404).json(job || { ok: false, error: "Housekeeping job not found" });
    } catch (error) { next(error); }
  });
  return router;
}

export default createStorageHousekeepingRouter();
