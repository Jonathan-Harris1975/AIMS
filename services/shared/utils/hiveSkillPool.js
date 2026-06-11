// Compatibility entrypoint for the central HIVE/R2 skill-pool contract.
//
// Runtime modules import from `services/shared/hiveSkillPool.js`, while the
// implementation lives under `services/shared/utils/hiveSkillPool.js` with the
// other shared utilities.  Keep this file lightweight so older/newer imports
// resolve to the same central read-only pool helper.

export * from "./utils/hiveSkillPool.js";
export { default } from "./utils/hiveSkillPool.js";
