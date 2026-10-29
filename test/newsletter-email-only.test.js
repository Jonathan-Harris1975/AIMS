import test from 'node:test';
import assert from 'node:assert/strict';
import { storeNewsletterIssue } from '../services/newsletter/engine/storage.js';
import { selectNewsletterArtLead } from '../services/newsletter/engine/heroImage.js';

test('storage writes exactly one email HTML artefact and keeps compatibility URL on it', async () => {
  const writes = [];
  const storage = {
    uploadText: async (_bucket, key) => { writes.push(key); return `https://example.test/${key}`; },
    putJson: async (_bucket, key, value) => { writes.push(key); assert.equal(value.distribution, 'email-only'); return key; },
  };
  const result = await storeNewsletterIssue({ profile: { storage: { keyPrefix: 'newsletter', htmlBucketKey: 'blog' } },
    sessionId: 'issue', emailHtml: '<html>Email</html>', plaintext: 'Email', metadata: {}, date: new Date('2026-10-29T10:00:00Z') }, storage);
  assert.deepEqual(writes.filter(key => key.endsWith('.html')), ['newsletter/2026-10-29/issue/email.html']);
  assert.equal(result.htmlUrl, result.emailUrl);
  assert.equal(writes.length, 3);
});

test('art direction follows the editorially selected story rather than the initial ranking', () => {
  const lead = { title: 'Ranked lead', link: 'https://example.test/1', summary: 'Compute.' };
  const selected = { title: 'Selected story', link: 'https://example.test/2', summary: 'Patient care.' };
  assert.deepEqual(selectNewsletterArtLead({ lead, stories: [selected], bigThree: [selected] }), selected);
  assert.deepEqual(selectNewsletterArtLead({ lead, stories: [], bigThree: [] }), lead);
});
