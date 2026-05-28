# CHANGES

## services/blotato/utils/autoPublishService.js
- Added a publish-time Instagram hashtag limiter.
- Instagram generated captions are now clamped to 5 hashtags before calling Blotato `/v2/posts`.
- YouTube, TikTok, Facebook and manual visual routes are left unchanged.

## services/blotato/utils/newsShortsService.js
- Updated the Blotato news-short prompt so `instagramCaption` asks for no more than 5 hashtags.
- Added an explicit output rule matching Instagram's 5-hashtag ceiling.

## test/blotato-service.test.js
- Added regression coverage proving the auto publish flow sends exactly 5 Instagram hashtags and drops the sixth generated tag.

## Safety
- No route names, payload shapes, env names, account ids, template ids, storage paths, or scheduling behaviour were changed.
