#!/usr/bin/env node
// One bounded, non-sending artwork check for the explicit repair release.
// Uses the production image/QA/storage path; never creates or sends an issue.
import "../config/loadEnv.js";
import { generateHeroImage } from "../services/newsletter/engine/heroImage.js";
import { getNewsletterProfile } from "../services/newsletter/config/profiles.js";

const result = await generateHeroImage({
  profile: getNewsletterProfile("ai-edge"),
  heroHeadline: "How attackers persuade AI agents to break the rules",
  leadStory: {
    title: "How attackers persuade AI agents to break the rules",
    summary: "AI agents can browse the web and use external tools. Untrusted material they encounter can attempt to redirect their instructions. " +
      "The editorial theme is restricting tool access and isolating an agent's permissions.",
  },
  bigThree: [],
  sessionId: `NL-artwork-verification-${process.env.EXPECTED_DEPLOYMENT_SHA?.slice(0, 12) || Date.now()}`,
});
const verified = result.ok === true && result.imageStatus === "generated" && Boolean(result.imageUrl && result.key && result.bucketKey);
console.log(JSON.stringify({
  event: verified ? "newsletter.artwork.verified" : "newsletter.artwork.verification_failed",
  ok: verified, imageStatus: result.imageStatus || null,
  diagnostics: result.artworkDiagnostics || null,
}));
if (!verified) process.exitCode = 1;
