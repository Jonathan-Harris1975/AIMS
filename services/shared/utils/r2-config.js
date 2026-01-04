// services/shared/utils/r2-config.js
import { ENV } from "../../../scripts/envBootstrap.js";

export function getR2Config() {
  const r2 = ENV.r2;

  if (!r2) {
    throw new Error("ENV.r2 missing — envBootstrap did not run");
  }

  return {
    endpoint: r2.endpoint,
    region: r2.region,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
    buckets: r2.buckets,
    publicUrls: r2.publicBase,
  };
}
