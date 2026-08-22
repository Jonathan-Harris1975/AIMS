import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("current external-provider contracts stay aligned", async () => {
  const [
    outreach, zeroBounce, blotato, autoPublish, ai, zernio, artworkPayload, artwork,
    brevo, podcastPipeline, dailyBlog, weeklyBlog, zernioInbox, thresholds, d1, d1Backup,
    aiSearch, jotform, podcastIndex, cloudflarePurge, weather, sheets, siteSyncWorkflow, envBootstrap, polly, r2,
  ] = await Promise.all([
    readFile(new URL("../services/outreach/services/outreachCore.js", import.meta.url), "utf8"),
    readFile(new URL("../services/outreach/services/zeroBounceBatch.js", import.meta.url), "utf8"),
    readFile(new URL("../services/blotato/utils/blotatoClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8"),
    readFile(new URL("../services/shared/utils/ai-service.js", import.meta.url), "utf8"),
    readFile(new URL("../services/zernio/utils/zernioClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/artwork/utils/openrouterImagePayload.js", import.meta.url), "utf8"),
    readFile(new URL("../services/artwork/utils/artwork.js", import.meta.url), "utf8"),
    readFile(new URL("../services/newsletter/brevo/client.js", import.meta.url), "utf8"),
    readFile(new URL("../services/podcast/runPodcastPipeline.js", import.meta.url), "utf8"),
    readFile(new URL("../services/blog/social/buildDailySocialBlogPost.js", import.meta.url), "utf8"),
    readFile(new URL("../services/blog/weekly/buildWeeklyBlogPost.js", import.meta.url), "utf8"),
    readFile(new URL("../services/comms-hub/clients/zernioInboxClient.js", import.meta.url), "utf8"),
    readFile(new URL("../config/thresholds.js", import.meta.url), "utf8"),
    readFile(new URL("../services/comms-hub/clients/d1Client.js", import.meta.url), "utf8"),
    readFile(new URL("../services/comms-hub/clients/cloudflareBackupClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/comms-hub/clients/aiSearchClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/comms-hub/clients/jotformClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/shared/utils/podcastIndexClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/cloudflare-purge/utils/purgeCloudflareCache.js", import.meta.url), "utf8"),
    readFile(new URL("../services/script/utils/getWeatherSummary.js", import.meta.url), "utf8"),
    readFile(new URL("../services/outreach/services/leadStore.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/weekly-podcast-site-sync.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/envBootstrap.js", import.meta.url), "utf8"),
    readFile(new URL("../services/tts/utils/ttsProcessor.js", import.meta.url), "utf8"),
    readFile(new URL("../services/shared/utils/r2-client.js", import.meta.url), "utf8"),
  ]);

  assert.match(zeroBounce, /\/validatebatch/);
  assert.doesNotMatch(zeroBounce, /\/batch-validate/);
  assert.match(zeroBounce, /item\?\.address/);
  assert.match(zeroBounce, /ZEROBOUNCE_BATCH_SIZE", 25, 100/);
  assert.match(outreach, /openpagerank\.keywordseverywhere\.com/);
  assert.match(outreach, /\/v1\/domains\/bulk/);
  assert.doesNotMatch(outreach, /api\.prospeo\.io\/api\/email-finder/);
  assert.doesNotMatch(outreach, /api\.apollo\.io\/v1\/mixed_people\/search/);
  assert.match(blotato, /blotato-api-key/);
  assert.match(blotato, /isSafeBlotatoRetry/);
  assert.match(blotato, /ambiguous 5xx\/network retry could create a duplicate paid video\/post/);
  assert.match(blotato, /`videos\/\$\{encodeURIComponent\(cleaned\)\}`/);
  assert.match(autoPublish, /return extractUuid\(value\).*DEFAULT_AI_STORY_TEMPLATE_UUID/);
  assert.match(ai, /max_completion_tokens: max_tokens/);
  assert.match(ai, /retry-after/);
  assert.match(zernio, /account\?\.isActive === false/);
  assert.match(artworkPayload, /ARTWORK_PROVIDER_RETRIES \|\| 1/);
  assert.match(artwork, /ARTWORK_VISUAL_QA_MAX_REGENERATIONS \?\? 0/);
  assert.match(thresholds, /PODCAST_ARTWORK_SHORT_PROMPT_RETRY", false/);
  assert.match(brevo, /function isSafeBrevoRetry/);
  assert.match(brevo, /ambiguous 5xx\/network retry could duplicate a campaign/);
  assert.match(brevo, /isIdempotentMethod\(method\) && attempt < retries/);
  assert.match(zernioInbox, /x-request-id idempotency for POST \/v1\/posts/);
  assert.match(zernioInbox, /const providerAttempts = [\s\S]*?\? this\.config\.providerRetryAttempts\s*:\s*1;/);
  for (const source of [podcastPipeline, dailyBlog, weeklyBlog]) {
    assert.match(source, /process\.env\.WEBSITE_REBUILD_HOOK \|\| ""/);
    assert.doesNotMatch(source, /pages\/webhooks\/deploy_hooks\/[0-9a-f-]{20,}/i);
  }

  // Cloudflare D1, backups, AI Search and cache purge.
  assert.match(d1, /\/d1\/database\/\$\{this\.config\.d1DatabaseId\}\/query/);
  assert.match(d1, /authorization: `Bearer \$\{this\.config\.d1ApiToken\}`/);
  assert.match(d1Backup, /this\.endpoint\(databaseId, "export"\)/);
  assert.match(d1Backup, /this\.endpoint\(targetDatabaseId, "import"\)/);
  assert.match(aiSearch, /\/ai-search\/instances\/\$\{encodeURIComponent\(instanceId\)\}\/search/);
  assert.match(aiSearch, /messages: \[\{ role: "user", content:/);
  assert.match(aiSearch, /max_num_results:/);
  assert.match(cloudflarePurge, /\/zones\/\$\{encodeURIComponent\(config\.zoneId\)\}\/purge_cache/);

  // Jotform, Podcast Index, WeatherAPI/RapidAPI and outreach R2 storage.
  assert.match(jotform, /headers: \{ accept: "application\/json", APIKEY: this\.config\.jotformApiKey \}/);
  assert.match(jotform, /\/submission\/\$\{encodeURIComponent\(submissionId\)\}/);
  assert.match(podcastIndex, /https:\/\/api\.podcastindex\.org\/api\/1\.0/);
  assert.match(podcastIndex, /"X-Auth-Key": API_KEY/);
  assert.match(podcastIndex, /"X-Auth-Date": ts\.toString\(\)/);
  assert.match(podcastIndex, /createHash\("sha1"\)/);
  assert.match(weather, /weatherapi-com\.p\.rapidapi\.com/);
  assert.match(weather, /\/current\.json\?q=/);
  assert.match(weather, /"x-rapidapi-key": apiKey/);
  assert.match(sheets, /putPrivateJson\("commsHub"/);
  assert.match(sheets, /outreachLeadPrefix/);

  // Amazon Polly and Cloudflare R2 S3-compatible API.
  assert.match(polly, /new SynthesizeSpeechCommand\(/);
  assert.match(polly, /OutputFormat: "mp3"/);
  assert.match(polly, /VoiceId: VOICE_ID/);
  assert.match(polly, /Engine: "neural"/);
  assert.match(r2, /new S3Client\(/);
  assert.match(r2, /region: R2_REGION \|\| "auto"/);
  assert.match(r2, /endpoint: R2_ENDPOINT/);
  assert.match(r2, /accessKeyId: R2_ACCESS_KEY_ID/);
  assert.match(r2, /secretAccessKey: R2_SECRET_ACCESS_KEY/);
  assert.match(r2, /new PutObjectCommand\(/);
  assert.match(r2, /new GetObjectCommand\(/);
  assert.match(r2, /new ListObjectsV2Command\(/);
  assert.match(r2, /new DeleteObjectCommand\(/);

  // Deploy hooks are credentials and may only come from configured secrets.
  assert.match(siteSyncWorkflow, /secrets\.WEBSITE_REBUILD_HOOK/);
  assert.doesNotMatch(siteSyncWorkflow, /pages\/webhooks\/deploy_hooks\/[0-9a-f-]{20,}/i);
  assert.match(envBootstrap, /WEBSITE_REBUILD_HOOK: opt\("WEBSITE_REBUILD_HOOK"\)/);
  assert.match(envBootstrap, /AI_MAX_RETRIES: num\("AI_MAX_RETRIES", 4\)/);
  assert.match(envBootstrap, /ARTWORK_PROVIDER_ATTEMPTS: num\("ARTWORK_PROVIDER_ATTEMPTS", 1\)/);
  assert.match(envBootstrap, /ARTWORK_VISUAL_QA_MAX_REGENERATIONS: num\("ARTWORK_VISUAL_QA_MAX_REGENERATIONS", 0\)/);
});
