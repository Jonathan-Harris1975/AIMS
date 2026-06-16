> **Document status:** Historical implementation record  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# AIMS tone and artwork control update

## Scope

This cumulative patch includes the previous Koyeb blog-social duplicate-date fix and podcast `a.m.` / `p.m.` validation fix, plus the following tone and artwork controls.

## Artwork

- Added `services/artwork/utils/artworkPromptPolicy.js`.
- Enforced absolute text-free image instructions for weekly blog, daily social blog and podcast artwork.
- Prohibited readable text, pseudo-text, letters, numerals, punctuation, glyphs, labels, captions, code, signage, logos, trademarks and watermarks.
- Applied the policy at prompt-building level and again immediately before the image-provider request.
- Added deterministic Northern Hemisphere seasonal accent palettes while retaining the AIMS deep navy and charcoal base.
- Passed blog/social publication dates and podcast session dates into artwork generation.

## Blotato

- Added stricter text-free rules to the script prompt, final visual prompt and every normalised scene input.
- Removed the actual thumbnail wording from visual-generation prompts.
- Replaced text-prone visual signatures such as headline cards, benchmark cards, documents and numbered cards with unlabelled object-based compositions.

## Shared tone setter

The following content lanes now use `services/script/utils/toneSetter.js` directly:

- weekly blog generation and QA;
- daily social-blog generation and QA;
- RSS rewrite, repair, short-title and relevance-classifier prompts;
- OneUp daily, quiz and ebook social prompts;
- Blotato short-script generation;
- podcast intro, story segments, main synthesis, outro, editorial clean-up, metadata, SEO keywords and artwork-prompt generation.

## Verification

- `npm run build`
- focused blog, social-blog, RSS, OneUp, Blotato and podcast validation tests
- new `test/tone-artwork-policy.test.js` coverage for all shared tone lanes, seasonal palettes and strict no-text controls
