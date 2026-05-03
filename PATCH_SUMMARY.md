# Podcast transcript QA and metadata hardening patch

## Scope
This patch hardens the Turing's Torch podcast script and RSS pipeline for:

- non-generic podcast and episode metadata
- Jonathan Harris host attribution
- deterministic 30/45/60 minute duration planning
- duration-aware title and description prompts
- RSS duration fallback from planned duration when actual audio probing is unavailable
- transcript cleanup for common mojibake artefacts such as â€” and â€˜
- stricter prompts against stitched article-summary narration

## Validation
Run from the repo root:

```bash
npm test
```

Validation completed in this workspace:

- 67 tests passed
- 0 failed
