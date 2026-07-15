import express from "express";
import socialRoutes from "./social.js";

const router = express.Router();

router.use("/", socialRoutes);

export default router;
