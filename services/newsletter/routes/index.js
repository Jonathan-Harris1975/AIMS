// services/newsletter/routes/index.js
import express from "express";
import generateRoutes from "./generate.js";
import sendRoutes from "./send.js";
import subscriptionRoutes from "./subscriptions.js";

const router = express.Router();

router.use("/", generateRoutes);
router.use("/", sendRoutes);
router.use("/", subscriptionRoutes);

export default router;
