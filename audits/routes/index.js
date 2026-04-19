import express from "express";
import mobileUxRoutes from "./mobileUx.js";
import seoAeoGeoRoutes from "./seoAeoGeo.js";

const router = express.Router();

router.use("/mobile-ux", mobileUxRoutes);
router.use("/seo-aeo-geo", seoAeoGeoRoutes);

export default router;
