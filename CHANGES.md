# CHANGES

## services/tts/utils/mergeProcessor.js
- Fixed `fetchWithTimeout(url)` so the timeout is cleared after the fetch settles.
- Added `unref()` on the timeout when available so a completed remote fetch does not keep the process alive.
- Patch is safe because it does not change timeout duration, retry behaviour, merge flow, upload flow, route shapes, or storage contracts. It only removes an unintended lingering timer on a successful fast path.
