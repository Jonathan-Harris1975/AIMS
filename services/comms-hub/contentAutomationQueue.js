import { deleteObject, getObjectAsText, getObjectAsTextWithMetadata, listObjects, putPrivateJson } from "../shared/utils/r2-client.js";
import { info, warn } from "../../logger.js";
import {
  createContentAutomationQueue,
  editorialBriefFingerprint,
  editorialBriefIds,
  editorialBriefPromptContext,
  editorialBriefTopicSeed,
} from "./contentAutomationQueueCore.js";

const BUCKET = "commsHubPrivate";

const queue = createContentAutomationQueue({
  storage: {
    list: (prefix) => listObjects(BUCKET, prefix),
    get: async (key) => JSON.parse(await getObjectAsText(BUCKET, key)),
    getWithVersion: async (key) => {
      const result = await getObjectAsTextWithMetadata(BUCKET, key);
      return { value: JSON.parse(result.text), version: result.eTag };
    },
    put: (key, value, { ifAbsent = false, ifMatch = "" } = {}) => putPrivateJson(BUCKET, key, value, {
      cacheControl: "no-store, max-age=0",
      ...(ifAbsent ? { ifNoneMatch: "*" } : {}),
      ...(ifMatch ? { ifMatch } : {}),
    }),
    delete: (key) => deleteObject(BUCKET, key),
  },
  logger: { info, warn },
});

export const {
  enqueueEditorialBrief,
  loadPendingEditorialBriefs,
  claimPendingEditorialBriefs,
  releaseEditorialBriefClaims,
  markEditorialBriefsConsumed,
  markEditorialBriefsReconciliationRequired,
  finaliseEditorialBriefsAfterPublication,
} = queue;

export {
  editorialBriefFingerprint,
  editorialBriefIds,
  editorialBriefPromptContext,
  editorialBriefTopicSeed,
};

export default {
  enqueueEditorialBrief,
  loadPendingEditorialBriefs,
  claimPendingEditorialBriefs,
  releaseEditorialBriefClaims,
  markEditorialBriefsConsumed,
  markEditorialBriefsReconciliationRequired,
  finaliseEditorialBriefsAfterPublication,
  editorialBriefFingerprint,
  editorialBriefIds,
  editorialBriefPromptContext,
  editorialBriefTopicSeed,
};
