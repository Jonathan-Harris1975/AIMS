# Zero-paid-advertising campaign attribution

This upgrade labels first-party marketing referrals **without** adding tracking
vendors, pixels, new subscriptions, paid promotions, or new posting schedules.

## AI Edge newsletter
- The existing Thursday podcast CTA to the owned website receives
  utm_source=ai_edge, utm_medium=email and utm_campaign=podcast_thursday_preview.
- Tuesday featured-book URLs on the owned website receive corresponding campaign
  tags. External Amazon/KDP links remain unchanged.
- Existing campaign parameters are preserved; link fragments remain intact.

## Thursday Zernio podcast promotion
- Default remains the currently published Spotify show URL, unchanged.
- Only if ZERNIO_PODCAST_PROMO_LINK_MODE=website is explicitly configured does
  the Thursday Zernio post link to the owned website with social UTMs.
- A verified published episode's own website link is used for a published
  recommendation. A preview always links to the podcast landing page.
- No early claim that an upcoming episode is already released.
- The setting does not change the Thursday posting time, account, cost,
  content model, creative requirements, audience, or platform distribution.

## Measurement and privacy

GA4 campaign attribution can use the standard UTMs, subject to actual tag,
consent and downstream reporting verification. The existing website event layer
also reads utm_campaign but does not separately expose all GA4 collection
details. Podcast downloads and Spotify plays are **not** proven by a click.
Confirm events reach the analytics destination before attributing performance.
Amazon sales require a separate genuine KDP royalty report.

Only allow-listed HTTPS URLs on jonathan-harris.online are tagged. External URLs
and supplied existing UTM parameters remain untouched. Never add paid ads.

## Production rollout

Deploy under existing CI/trusted admission. The newsletter attribution activates
on the next governed Thursday send. The Zernio website destination is OFF by
default and can be A/B tested only after the original promotional performance
is measured. No other settings need changing.
