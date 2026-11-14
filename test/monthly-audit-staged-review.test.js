import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceChunks, reviewAuditEvidence } from '../audits/utils/stagedAuditReview.js';
import { collectMonthlyPublishedContent } from '../audits/utils/monthlyPublishedContent.js';
import { runContentMasterCouncil, CONTENT_MASTER_COUNCIL_MEMBERS, __contentMasterCouncilTestHooks } from '../audits/utils/contentMasterCouncil.js';
import { __ramsContentDispatchTestHooks } from '../audits/utils/ramsContentDispatch.js';
import { startAsyncAuditRouteJob, getAsyncAuditRouteJobFresh } from '../audits/utils/asyncAuditRouteJobs.js';
import aiConfig from '../ai-config.js';

test('bounded chunks preserve every evidence character and run sequentially', async () => {
  const sources = { social: { text: 'a'.repeat(50000), findingId: 'SOC-1' } };
  const chunks = evidenceChunks(sources);
  assert.equal(chunks.map(c => c.evidence).join(''), JSON.stringify(sources.social));
  assert.ok(chunks.every(c => c.evidence.length <= 24000));
  let active = 0;
  const reviews = await reviewAuditEvidence(sources, async (route, options) => {
    assert.equal(++active, 1);
    assert.equal(route, 'auditEvidenceReview');
    assert.equal(options.maxRetries, 0);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { content: JSON.stringify({ summary: 'Observed SOC-1', findings: [], limitations: [] }), model: 'test:free' };
  });
  assert.equal(reviews.length, chunks.length);
});

test('free capacity failure retains exact original evidence for the paid final pass', async () => {
  const source = { findingId: 'P-1', affectedPaths: ['services/podcast/index.js'] };
  const reviews = await reviewAuditEvidence({ podcast: source }, async () => { throw new Error('429'); });
  assert.equal(reviews[0].status, 'free_review_unavailable');
  assert.deepEqual(JSON.parse(reviews[0].evidence), source);
  assert.equal(aiConfig.routeModels.auditFinalReport.join(','), 'auditEconomy');
  assert.deepEqual(aiConfig.routeModels.auditEvidenceReview, ['auditFreePrimary', 'auditFreeBackup']);
});

function validReport() {
  return { synthesisState: 'Complete', executiveSummary: 'Evidence reviewed', councilVerdict: { overallDiagnosis: 'Monthly review' },
    scorecard: Object.fromEntries(['overallContentQuality','zernioSocial','blotatoShorts','ebookConversion','hashtagStrategy','weeklyBlog',
      'blogSocial','podcastTranscript','podcastKeywords','newsletter','crossChannelCoherence','councilConfidence'].map(k => [k, {score:null,basis:'Evidence not supplied'}])),
    laneFindings: Object.fromEntries(['zernioSocial','blotatoShorts','ebookPosts','hashtagStrategy','weeklyBlog','blogSocial','podcastTranscript','podcastKeywords','newsletter'].map(k => [k, []])),
    masterIssueLedger: [], topActions: [], definitionOfDone: ['Verify the next published output'],
    councilRecord: { seats: CONTENT_MASTER_COUNCIL_MEMBERS.map(s => ({...s, reviewNote:'Missing metrics remain unscored'})) } };
}

test('empty JSON is incomplete and missing scores remain null', async () => {
  const council = await runContentMasterCouncil({}, async route => route === 'auditEvidenceReview' ? {content:'{}'} : '{}');
  assert.equal(council.synthesisState, 'Incomplete');
  assert.equal(council.scorecard.newsletter.score, null);
  assert.equal(__contentMasterCouncilTestHooks.normalise({}, {}).synthesisState, 'Incomplete');
});

test('invented file paths cannot become executable code fixes', async () => {
  const report = validReport();
  report.masterIssueLedger.push({ findingId:'C-1', title:'Fix', owner:'RAMS', confidence:'Confirmed', classification:'code_fix',
    affectedPaths:['invented.js'], sourceFindingIds:['S-1'], exactRemediation:'Edit', acceptanceCriterion:'Pass', verificationMethod:'node --test' });
  const council = await runContentMasterCouncil({onBrand:{status:'complete',report:{findingId:'S-1',affectedPaths:['real.js']}}}, async route =>
    route === 'auditEvidenceReview' ? {content:JSON.stringify({summary:'Evidence',findings:[],limitations:[]})} : JSON.stringify(report));
  assert.equal(council.synthesisState, 'Complete');
  assert.equal(council.masterIssueLedger[0].classification, 'manual_review');
  assert.deepEqual(council.masterIssueLedger[0].affectedPaths, []);
  assert.equal(__ramsContentDispatchTestHooks.validateKey('audits/content-master/2026-11/session-1/content-audit.json'), 'audits/content-master/2026-11/session-1/content-audit.json');
});

test('published blog audit reads actual monthly HTML and exposes failures', async () => {
  const evidence = await collectMonthlyPublishedContent({ now:new Date('2026-11-14T12:00:00Z'), storage: {
    listObjects:async () => [{key:'blog/posts/current/index.html',lastModified:'2026-11-10'}, {key:'blog/posts/old/index.html',lastModified:'2025-01-01'}],
    getObjectAsText:async () => '<h1>Actual article</h1><p>Evidence.</p><a href="/ebooks">Book</a><script>ignored</script\t\n bar>'
  }});
  assert.equal(evidence.itemsInspected, 1);
  assert.match(evidence.items[0].content, /Actual article/);
  assert.doesNotMatch(evidence.items[0].content, /ignored/);
  assert.deepEqual(evidence.items[0].links, ['/ebooks']);
  const failed = await collectMonthlyPublishedContent({storage:{listObjects:async()=>{throw new Error('R2 unavailable');}}});
  assert.equal(failed.status, 'partial');
  assert.deepEqual(failed.errors, ['R2 unavailable']);
});

test('an unsuccessful audit result is a failed MAST job with diagnostic links retained', async () => {
  const sessionId = `monthly-failure-${Date.now()}`;
  await startAsyncAuditRouteJob({auditType:'content-master',payload:{sessionId},runner:async()=>({ok:false,error:'Incomplete synthesis',reportJsonUrl:'r2://audits/diagnostic.json'})});
  await new Promise(resolve=>setTimeout(resolve,30));
  const result=await getAsyncAuditRouteJobFresh('content-master',sessionId);
  assert.equal(result.status,'failed');
  assert.equal(result.result.reportJsonUrl,'r2://audits/diagnostic.json');
});
