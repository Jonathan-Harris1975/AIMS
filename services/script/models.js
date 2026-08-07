// Compatibility shim for the legacy services/script/models.js path.
// Keep one authoritative script model implementation under services/script/utils.
export * from "./utils/models.js";
export { default } from "./utils/models.js";
