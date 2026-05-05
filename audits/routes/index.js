import express from "express";
import mobileUxRoutes from "./mobileUx.js";
import seoAeoGeoRoutes from "./seoAeoGeo.js";
import onBrandRoutes from "./onBrand.js";

const router = express.Router();

router.use("/mobile-ux", mobileUxRoutes);
router.use("/seo-aeo-geo", seoAeoGeoRoutes);
router.use("/on-brand", onBrandRoutes);

export default router;
