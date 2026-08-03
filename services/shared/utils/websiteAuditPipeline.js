// Compatibility bridge. The canonical website audit pipeline lives under
// audits/utils; keeping one implementation prevents the shared-services copy
// drifting away from the routes that actually execute in production.
export * from "../../../audits/utils/websiteAuditPipeline.js";
export { default } from "../../../audits/utils/websiteAuditPipeline.js";
