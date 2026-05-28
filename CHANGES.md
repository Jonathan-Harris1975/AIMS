# AIMS Blotato Runtime JSON Fix

## services/blotato/utils/newsShortsService.js
- Removed the Blotato news-short request's strict `response_format` payload. Production logs showed OpenRouter returning a 404 for the standard provider because no endpoint could handle the requested parameters.
- Added one controlled JSON repair retry when the model response is malformed. The retry reuses the same source article context, lowers temperature, and still fails loudly if the repaired output is invalid.
- Added a warning log `blotato.news_short.json_retry` with a short raw preview for operational diagnosis.

## test/blotato-service.test.js
- Added coverage proving Blotato news-short generation does not send `response_format` to OpenRouter.
- Added coverage proving malformed model JSON is retried once and then normalised into the expected short-pack contract.
- Preserved existing Instagram 5-hashtag protection and publish-now coverage.
