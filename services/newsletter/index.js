// services/newsletter/index.js
import express from "express";
import routes from "./routes/index.js";

const router = express.Router();

// mount at /newsletter/*
router.use("/", routes);

export default router;
