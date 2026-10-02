import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareArticleSources, retrieveArticle, deduplicateArticles, htmlToArticleText, isPublicAddress } from "../services/script/utils/articleSources.js";
import { generateMainLongform, buildSectionPlan } from "../services/script/utils/mainChunker.js";
import { countWords } from "../services/script/utils/wordBudget.js";
import { parseFeedText, filterAndScoreFeedItems } from "../services/script/utils/fetchFeeds.js";
import { validateTranscriptStructure } from "../services/script/utils/scriptValidation.js";
import { OUTRO_CLOSING_TAGLINE } from "../services/script/utils/promptTemplates.js";
import { buildDurationPlan } from "../services/script/utils/durationCalculator.js";
import { evaluateOperationWindowClaim } from "../services/ops/operationWindowState.js";
import { assessAsyncOperationPayload, assessAsyncTaskOutcome } from "../services/ops/asyncOperation.js";

const prose = (n, marker = "Alpha") => Array.from({ length: n }, (_, i) => `${marker}${i}${i % 14 === 13 || i === n - 1 ? "." : ""}`).join(" ");
const articles = () => Array.from({ length: 9 }, (_, i) => ({ title: `Research topic ${i}`, summary: prose(700, `Evidence${i}_`), link: `https://example.com/${i}` }));
const meta = { sessionId: "TT-test-longform", targetMinutes: 60 };
const seconds = buildDurationPlan(meta).mainSeconds;
function harness(request) {
  let state = null;
  return { request, load: async () => structuredClone(state), save: async (_, value) => { state = structuredClone(value); },
    log: () => {}, backoff: async () => {}, state: () => state };
}
function response(options, reason = "stop") {
  const n = Number(options.messages[0].content.match(/word budget is (\d+)/)[1]);
  return { content: prose(n, options.section.replaceAll("-", "") + "_"), finishReason: reason,
    model: "mock-model", providerId: "mock", usage: { completion_tokens: n * 2 } };
}

test("healthy RSS parses full content and filters seven days without future entries", async () => {
  const now = new Date().toUTCString();
  const xml = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>News</title>
${articles().map((a) => `<item><title>${a.title}</title><link>${a.link}</link><pubDate>${now}</pubDate>
<description>Brief summary.</description><content:encoded><![CDATA[<article><p>${a.summary}</p></article>]]></content:encoded></item>`).join("")}</channel></rss>`;
  const feed = await parseFeedText(xml);
  assert.equal(feed.items.length, 9);
  const prepared = await prepareArticleSources(filterAndScoreFeedItems(feed), { expand: async () => { throw new Error("Should not fetch full RSS content"); } });
  assert.equal(prepared.stats.sourceWords, 6300);
  assert.equal(prepared.stats.expandedArticles, 0);
  assert.equal(filterAndScoreFeedItems({ items: [{ pubDate: new Date(Date.now() + 86400000).toISOString() }] }).length, 0);
});

test("summary links expand and an inaccessible article is isolated", async () => {
  const prepared = await prepareArticleSources(articles().slice(0, 4).map((a) => ({ ...a, summary: `A short summary of topic ${a.title}.` })), {
    expand: async (link) => { if (link.endsWith("/1")) throw new Error("unavailable secret query"); return { text: prose(800, link), canonicalUrl: link }; },
  });
  assert.equal(prepared.articles.length, 4);
  assert.equal(prepared.stats.expandedArticles, 3);
  assert.equal(prepared.stats.unavailableArticles.length, 1);
  assert.equal(prepared.stats.unavailableArticles[0].reason, "article_unavailable");
});

test("duplicate story and duplicated body consolidate", () => {
  const base = articles()[0];
  const result = deduplicateArticles([base, { ...base, link: "https://example.com/copy" }, { ...base, title: "Other heading" }]);
  assert.equal(result.articles.length, 1);
  assert.equal(result.duplicates.length, 2);
});

test("thin recent coverage returns a structured insufficient-source condition", () => {
  assert.throws(() => buildSectionPlan(articles().slice(0, 2), seconds), (err) => {
    assert.equal(err.code, "PODCAST_INSUFFICIENT_SOURCE");
    assert.equal(err.statusCode, 422);
    assert.equal(err.details.requiredEpisodeDurationMinutes, 60);
    assert.equal(err.details.eligibleStories, 2);
    assert.ok(err.details.nextRetryAt);
    return true;
  });
  assert.throws(() => buildSectionPlan(articles().map((a) => ({ ...a, summary: prose(45) })), seconds), /Insufficient grounded/);
});

test("sufficient evidence produces all sections above the unchanged 6300-word floor", async () => {
  const events = [];
  const dependencies = harness(async (_, options) => response(options));
  dependencies.log = (event, fields) => events.push({ event, fields });
  const text = await generateMainLongform(meta, articles(), seconds, dependencies);
  assert.equal(countWords(text), Math.ceil(seconds * 2.3));
  assert.ok(countWords(text) > 6300);
  assert.equal(Object.keys(dependencies.state().sections).length, buildSectionPlan(articles(), seconds).length);
  assert.ok(events.some((entry) => entry.fields.finishReason === "stop"));
  assert.equal(validateTranscriptStructure(`${text}\n\n${OUTRO_CLOSING_TAGLINE}`, { targetMinutes: 60 }).ok, true);
});

test("short first section continues locally, successful sections resume without another request", async () => {
  let calls = 0;
  const dependencies = harness(async (_, options) => {
    calls += 1;
    if (options.section === "main-section-1-1") return { content: prose(180, "Short"), finishReason: "stop" };
    return response(options);
  });
  const text = await generateMainLongform(meta, articles(), seconds, dependencies);
  const firstCalls = calls;
  assert.equal(dependencies.state().sections[1].attempts, 2);
  assert.ok(countWords(text) > 6300);
  assert.equal(await generateMainLongform(meta, articles(), seconds, dependencies), text);
  assert.equal(calls, firstCalls);
});

test("output-token truncation is rejected and only its section is regenerated", async () => {
  const calls = [];
  const dependencies = harness(async (_, options) => {
    calls.push(options.section);
    return response(options, options.section === "main-section-2-1" ? "length" : "stop");
  });
  await generateMainLongform(meta, articles(), seconds, dependencies);
  assert.equal(dependencies.state().sections[2].attempts, 2);
  assert.equal(calls.filter((name) => name.startsWith("main-section-1-")).length, 1);
});

test("bounded repairs persist exhausted attempts across retries", async () => {
  let calls = 0;
  const dependencies = harness(async () => { calls += 1; return { content: "Too little.", finishReason: "stop" }; });
  await assert.rejects(generateMainLongform(meta, articles(), seconds, dependencies), { code: "PODCAST_SECTION_EXHAUSTED" });
  assert.equal(calls, 3);
  await assert.rejects(generateMainLongform(meta, articles(), seconds, dependencies), { code: "PODCAST_SECTION_EXHAUSTED" });
  assert.equal(calls, 3);
});

test("1133 words still fail final duration validation", () => {
  const text = prose(1133) + "\n\n" + OUTRO_CLOSING_TAGLINE;
  const validation = validateTranscriptStructure(text, { targetMinutes: 60 });
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.some((reason) => reason.includes("minimum 6300")));
});

test("article extraction removes navigation, executable scripts and boilerplate", () => {
  const html = '<nav>Menu</nav><article><p>Grounded &amp; useful.</p><script>bad()</script><aside>Advert</aside></article><footer>Footer</footer>';
  assert.equal(htmlToArticleText(html), "Grounded & useful.");
});

test("HTML short-link redirects resolve to their own article with bounded retrieval", async () => {
  const urls = [];
  const result = await retrieveArticle("https://example.com/rss-links/story/index.html", {
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal);
      return new Response(urls.length === 1 ? '<meta http-equiv="refresh" content="0;url=https://publisher.example/story">'
        : '<article><p>The full factual story.</p></article>', { headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(result.canonicalUrl, "https://publisher.example/story");
  assert.equal(result.text, "The full factual story.");
  assert.equal(urls.length, 2);
});

test("retrieval rejects private DNS, invalid protocols, oversized responses and redirect loops", async () => {
  const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
  for (const url of ["file:///etc/passwd", "http://127.0.0.1/a", "https://[::ffff:7f00:1]/a"]) {
    await assert.rejects(retrieveArticle(url, { lookupImpl: publicDns }), /article_/);
  }
  await assert.rejects(retrieveArticle("https://example.com", { lookupImpl: async () => [{ address: "10.0.0.1", family: 4 }] }), /private/);
  await assert.rejects(retrieveArticle("https://example.com", { lookupImpl: publicDns,
    fetchImpl: async () => new Response("huge", { headers: { "content-type": "text/html", "content-length": "9000000" } }) }), /size_limit/);
  let calls = 0;
  await assert.rejects(retrieveArticle("https://example.com", { lookupImpl: publicDns,
    fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: "/loop" } }); } }), /redirect_limit/);
  assert.equal(calls, 4);
  assert.equal(isPublicAddress("169.254.169.254"), false);
});

test("Friday orchestration distinguishes deferred sources and observes the next retry time", () => {
  const nextRetryAt = new Date(Date.now() + 3600000).toISOString();
  const result = { ok: false, reason: "PODCAST_INSUFFICIENT_SOURCE", statusCode: 422, nextRetryAt, retryable: true };
  const assessment = assessAsyncOperationPayload({ job: { status: "completed", result } });
  assert.equal(assessment.ok, false);
  assert.equal(assessAsyncTaskOutcome("/podcast/run", assessment).ok, false);
  const receipt = { status: "completed-with-failures", attempt: 1, results: [{ name: "podcast", ...result }], finishedAt: new Date(0).toISOString() };
  const claim = evaluateOperationWindowClaim(receipt, { allowRecovery: true, nowMs: Date.now() });
  assert.equal(claim.claimable, false);
  assert.equal(claim.retryAt, nextRetryAt);
  receipt.results[0].retryable = false;
  assert.equal(evaluateOperationWindowClaim(receipt, { allowRecovery: true }).claimable, false);
});

async function pipelineWithStubs(script) {
  const path = new URL("../services/podcast/runPodcastPipeline.js", import.meta.url);
  let source = await readFile(path, "utf8");
  let ttsCalls = 0;
  const symbol = `podcastRepairTest${Date.now()}${Math.random()}`;
  globalThis[symbol] = { script, tts: async () => { ttsCalls += 1; return { ok: true }; } };
  const modules = {
    "../../logger.js": 'export const info = () => {}; export const warn = info; export const error = info;',
    "../script/index.js": `export const getScriptForPodcast = async () => { const value = globalThis[${JSON.stringify(symbol)}].script;
if (value instanceof Error) throw value; return value; };`,
    "../artwork/index.js": 'export const processArtwork = async () => ({ ok:true, source:"generated", key:"art", publicUrl:"https://example.com/art" });',
    "../tts/index.js": `export const orchestrateTTS = (...args) => globalThis[${JSON.stringify(symbol)}].tts(...args);`,
    "../rss-feed-podcast/index.js": 'export const runRssFeedCreator = async () => ({ ok:true, episode:{url:"https://example.com/episode"} });',
    "../shared/utils/cleanupSession.js": 'export default async () => {};',
    "../shared/utils/cleanupSessionFinal.js": 'export default async () => {};',
    "../shared/utils/cleanupTempMemory.js": 'export default async () => {};',
    "../shared/http-client.js": 'export const fetchWithTimeout = async () => new Response("ok");',
    "../comms-hub/contentAutomationQueue.js": `export const claimPendingEditorialBriefs = async () => [];
export const editorialBriefFingerprint = () => ""; export const editorialBriefIds = () => []; export const editorialBriefPromptContext = () => "";
export const finaliseEditorialBriefsAfterPublication = () => {}; export const markEditorialBriefsReconciliationRequired = () => {};
export const releaseEditorialBriefClaims = async () => {};`,
  };
  source = source.replace(/from "([^"]+)"/g, (full, specifier) => {
    const stub = modules[specifier];
    return `from ${JSON.stringify(stub ? `data:text/javascript;base64,${Buffer.from(stub).toString("base64")}` : new URL(specifier, path).href)}`;
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  return { run: () => module.runPodcastPipeline({ sessionId: "TT-test", targetMinutes: 60 }),
    ttsCalls: () => ttsCalls, clear: () => { delete globalThis[symbol]; } };
}

test("script rejection stops the complete production pipeline before TTS", async () => {
  const pipeline = await pipelineWithStubs(new Error("Final script failed structure validation: minimum 6300"));
  try { await assert.rejects(pipeline.run(), /minimum 6300/); assert.equal(pipeline.ttsCalls(), 0); } finally { pipeline.clear(); }
});

test("validated complete script proceeds to TTS and podcast publication", async () => {
  const dependencies = harness(async (_, options) => response(options));
  const fullText = (await generateMainLongform(meta, articles(), seconds, dependencies)) + "\n\n" + OUTRO_CLOSING_TAGLINE;
  assert.equal(validateTranscriptStructure(fullText, { targetMinutes: 60 }).ok, true);
  const pipeline = await pipelineWithStubs({ ok: true, fullText, metadata: { artworkPrompt: "Grounded artwork" } });
  const hook = process.env.WEBSITE_REBUILD_HOOK;
  process.env.WEBSITE_REBUILD_HOOK = "https://example.com/rebuild";
  try {
    const result = await pipeline.run();
    assert.equal(result.ok, true);
    assert.equal(pipeline.ttsCalls(), 1);
  } finally { pipeline.clear(); if (hook === undefined) delete process.env.WEBSITE_REBUILD_HOOK; else process.env.WEBSITE_REBUILD_HOOK = hook; }
});

test("a transport failure resumes its section while retaining earlier validated sections", async () => {
  let interrupted = false;
  const calls = [];
  const dependencies = harness(async (_, options) => {
    calls.push(options.section);
    if (options.section === "main-section-3-1" && !interrupted) { interrupted = true; throw new Error("provider timeout"); }
    return response(options);
  });
  await assert.rejects(generateMainLongform(meta, articles(), seconds, dependencies), /provider timeout/);
  const result = await generateMainLongform(meta, articles(), seconds, dependencies);
  assert.ok(countWords(result) > 6300);
  assert.equal(calls.filter((name) => name.startsWith("main-section-1-")).length, 1);
  assert.ok(calls.includes("main-section-3-2"));
});

test("a short truncated response is regenerated rather than appended", async () => {
  const dependencies = harness(async (_, options) => {
    if (options.section === "main-section-1-1") return { content: prose(180, "Truncated"), finishReason: "length" };
    if (options.section === "main-section-1-2") assert.doesNotMatch(options.messages[0].content, /Continue only this incomplete section/);
    return response(options);
  });
  const result = await generateMainLongform(meta, articles(), seconds, dependencies);
  assert.doesNotMatch(result, /Truncated/);
});

async function moduleWithStubs(relativePath, modules, prefix = "") {
  const path = new URL(relativePath, import.meta.url);
  let source = prefix + await readFile(path, "utf8");
  source = source.replace(/from "([^"]+)"/g, (full, specifier) => {
    const stub = modules[specifier];
    return `from ${JSON.stringify(stub ? `data:text/javascript;base64,${Buffer.from(stub).toString("base64")}` : new URL(specifier, path).href)}`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("real transcript orchestration uploads every validated word and the real TTS loader receives them all", async () => {
  const dependencies = harness(async (_, options) => response(options));
  const main = await generateMainLongform(meta, articles(), seconds, dependencies);
  const uploaded = new Map();
  const symbol = `podcastUploadTest${Date.now()}`;
  globalThis[symbol] = { main, uploaded, received: null };
  const store = `globalThis[${JSON.stringify(symbol)}]`;
  const silent = 'export const info = () => {}; export const debug = info; export const warn = info; export const error = info;';
  const script = await moduleWithStubs("../services/script/utils/orchestrator.js", {
    "../../../logger.js": silent,
    "./models.js": `export default {
      generateIntro: async () => "We examine the evidence from this week.",
      generateMain: async meta => { meta.sourceItems = [{summary:${store}.main}]; return ${store}.main; },
      generateOutro: async () => ${JSON.stringify(OUTRO_CLOSING_TAGLINE)}
    };`,
    "../../shared/utils/r2-client.js": `export const uploadPrivateText = async (bucket,key,text) => ${store}.uploaded.set(bucket+":"+key,text);
export const uploadText = uploadPrivateText;`,
    "./podcastHelper.js": 'export const generateEpisodeMetaLLM = async () => ({title:"Test episode"});',
    "./episodeCounter.js": 'export const attachEpisodeNumberIfNeeded = async meta => meta;',
    "./editorialPass.js": 'export const runEditorialPass = async (meta,text) => text;',
  }, "const setTimeout = () => 0;\n");
  const envNames = ["R2_BUCKET_RAW_TEXT", "R2_BUCKET_PODCAST"];
  const env = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) process.env[name] = "test";
  try {
    const result = await script.orchestrateScript({ ...meta, sessionId: "TT-test-upload" });
    assert.ok(result.chunks.length > 1);
    assert.equal(validateTranscriptStructure(result.fullText, { targetMinutes: 60 }).ok, true);
    const tts = await moduleWithStubs("../services/tts/utils/orchestrator.js", {
      "../../../logger.js": silent,
      "../../shared/utils/keepalive.js": 'export const startKeepAlive = () => {}; export const stopKeepAlive = startKeepAlive;',
      "../../shared/utils/r2-client.js": `export const listKeys = async (bucket,prefix) => [...${store}.uploaded.keys()]
.filter(key=>key.startsWith(bucket+":"+prefix)).map(key=>key.slice(bucket.length+1));
export const getObject = async (bucket,key) => Buffer.from(${store}.uploaded.get(bucket+":"+key));`,
      "./ttsProcessor.js": `export const ttsProcessor = async (sid,chunks) => {
${store}.received = chunks.map(chunk=>chunk.text).join(" "); return chunks.map(()=>({success:true,r2Uri:"r2://test/audio"})); };`,
      "./mergeProcessor.js": 'export const mergeProcessor = async () => ({key:"merged"});',
      "./editingProcessor.js": 'export const editingProcessor = async () => "edited.mp3";',
      "./podcastProcessor.js": 'export const podcastProcessor = async () => ({key:"episode.mp3",buffer:Buffer.from("mock audio")});',
    });
    assert.equal((await tts.orchestrateTTS({ sessionId: "TT-test-upload" })).ok, true);
    assert.equal(countWords(globalThis[symbol].received), countWords(result.fullText));
    assert.equal(globalThis[symbol].received.replace(/\s+/g, " "), result.fullText.replace(/\s+/g, " "));
  } finally {
    delete globalThis[symbol];
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
