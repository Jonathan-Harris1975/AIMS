// services/blog/routes/index.js
import express from "express";
import weeklyRoutes from "./weekly.js";

const router = express.Router();

router.use("/weekly", weeklyRoutes);

export default router;
