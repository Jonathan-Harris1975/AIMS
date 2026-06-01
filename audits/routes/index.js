import express from "express";
import mobileUxRoutes from "./mobileUx.js";
import seoAeoGeoRoutes from "./seoAeoGeo.js";
import onBrandRoutes from "./onBrand.js";
import socialPerformanceRoutes from "./socialPerformance.js";
import brandSocialCouncilRoutes from "./brandSocialCouncil.js";

const router = express.Router();

router.use("/mobile-ux", mobileUxRoutes);
router.use("/seo-aeo-geo", seoAeoGeoRoutes);
router.use("/on-brand", onBrandRoutes);
router.use("/social-performance", socialPerformanceRoutes);
router.use("/brand-social-council", brandSocialCouncilRoutes);

export default router;
