// services/newsletter/routes/index.js
import express from "express";
import generateRoutes from "./generate.js";
import sendRoutes from "./send.js";
import weekendRoutes from "./weekend.js";
import subscriptionRoutes from "./subscriptions.js";

const router = express.Router();

router.use("/", weekendRoutes);
router.use("/", generateRoutes);
router.use("/", sendRoutes);
router.use("/", subscriptionRoutes);

export default router;
