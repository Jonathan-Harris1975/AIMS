// Compatibility entrypoint. The canonical artwork prompt policy lives under
// services/artwork/utils; keep a single implementation so repository hygiene
// does not flag byte-identical duplicate source files.
export * from "../services/artwork/utils/artworkPromptPolicy.js";
export { default } from "../services/artwork/utils/artworkPromptPolicy.js";
