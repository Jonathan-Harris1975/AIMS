import express from "express";

export function mountServiceRoutes(routes) {
  const router = express.Router();
  router.use("/", routes);
  return router;
}
