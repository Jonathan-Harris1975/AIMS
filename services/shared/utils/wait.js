// services/shared/utils/wait.js
// ------------------------------------------------------------
// ⏱️ Shared async delay helper
// ------------------------------------------------------------
// - No env access
// - No defaults
// - No logic
// - Pure Promise-based delay
// ------------------------------------------------------------

export function wait(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms)) {
    throw new Error(`wait(ms) requires a number, received: ${ms}`);
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
