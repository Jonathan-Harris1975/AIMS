// Published AI Edge issues are the authority for recent-coverage memory.
// Never mistake a generated-but-unsent draft for a published story.
import { listKeys, getObjectAsText } from '../../shared/utils/r2-client.js';

export function canonicalStoryUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const search = [...url.searchParams.entries()]
      .filter(([key]) => !/^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    return host + pathname + (search.length ? '?' + new URLSearchParams(search).toString() : '');
  } catch {
    return String(value || '').trim().toLowerCase().split(/[?#]/)[0];
  }
}

export function canonicalStoryTitle(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/&(?:amp|quot|#39);/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export async function loadRecentEditorialHistory(profile, {
  now = new Date(), days = 7, list = listKeys, read = getObjectAsText,
} = {}) {
  const bucket = profile.storage.htmlBucketKey;
  const publicationDate = profile.publicationDate || profile.editorialDate || now.toISOString().slice(0, 10);
  const anchor = new Date(publicationDate + 'T12:00:00Z');
  if (Number.isNaN(anchor.getTime())) throw new Error('Invalid newsletter publication date');
  const recentLinks = new Set();
  const recentTitles = new Set();
  const recentIssues = [];
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(anchor.getTime() - day * 86400000).toISOString().slice(0, 10);
    const prefix = profile.storage.keyPrefix + '/' + date + '/';
    const keys = await list(bucket, prefix);
    const published = keys.filter((key) => key.endsWith('/metadata.json'));
    for (const key of published) {
      const campaignKey = key.replace(/metadata\.json$/, 'campaign.json');
      if (!keys.includes(campaignKey)) continue;
      try {
        const [campaignRaw, metadataRaw] = await Promise.all([read(bucket, campaignKey), read(bucket, key)]);
        const campaign = JSON.parse(campaignRaw);
        const metadata = JSON.parse(metadataRaw);
        if (campaign.status !== 'dispatched' || metadata.qa?.passed !== true) continue;
        for (const link of metadata.sourceLinks || []) recentLinks.add(canonicalStoryUrl(link));
        for (const title of metadata.storyTitles || []) recentTitles.add(canonicalStoryTitle(title));
        recentIssues.push({ date, subject: metadata.subject || '', storyCount: (metadata.sourceLinks || []).length });
      } catch {
        // One corrupt historical record must not prevent the other published editions
        // from protecting the next issue. Report incompleteness to the caller.
        recentIssues.push({ date, unreadable: true });
      }
    }
  }
  return {
    recentLinks, recentTitles, recentIssues,
    complete: !recentIssues.some((item) => item.unreadable),
  };
}
