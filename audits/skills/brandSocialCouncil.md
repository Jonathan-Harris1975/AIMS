# Brand & Social Media Performance Council — Skill File

## Purpose
A monthly decision layer that combines the on-brand QA report with the Zernio social-performance report. The council turns historic evidence into future-facing content, prompt, scheduling, and packaging recommendations.

The council is analysis-only by default. It produces a RAMS-readable master report, but direct repository patching remains gated and should only happen where a future report contains deterministic file-level findings.

## Council members

| Role | What it reviews | Output focus |
|---|---|---|
| Brand Editor | Tone, hype control, duplicate phrasing, practical Jonathan Harris voice | Future prompt and copy guardrails |
| Social Performance Analyst | Zernio metrics, platform winners, weak posts, lane-level performance | Platform and content-lane recommendations |
| Hook Analyst | First lines, episode/post openings, scroll-stopping clarity | Hook patterns to keep, cut, or test |
| Thumbnail & Visual Packaging Expert | Shorts/Reels thumbnails, first-frame clarity, visual promise, text clutter, recognisable style | Video packaging recommendations for Blotato and future shorts |
| Repurposing Lead | Podcast/blog/RSS material that can become carousels, shorts, quizzes, ebook posts, or newsletter hooks | Reuse opportunities without inventing weak filler |
| Comments & Replies Auditor | Audience questions, objections, repeated comments, saves/shares clues | Topic intelligence and follow-up ideas |
| Cross-Platform Coherence Lead | Whether Facebook, Instagram, YouTube, TikTok, RSS and podcast framing remain aligned | Message consistency across platforms |
| Podcast & Transcript Lead | Podcast excerpt quality, transcript usefulness, AEO-ready content blocks | Spoken-copy and transcript recommendations |
| Commercial Lead | Ebook clicks, newsletter CTA, book relevance, weak/strong conversion signals | Commercial actions and CTA tests |
| Automation Safety Lead | Whether a finding is safe for RAMS, AIMS prompt tuning, manual review, or future guidance only | RAMS policy and automation-readiness labels |

## Monthly agenda

1. Social performance review: platform, pipeline, lane and top/bottom post signals.
2. Brand-fit review: recurring tone defects, hype drift, duplicate phrasing and RSS/social guardrails.
3. Hook and packaging review: opening-line strength plus thumbnail/first-frame evidence where available.
4. Repurposing review: which podcast/blog/RSS material deserves another format.
5. Audience and commercial review: comments, clicks, saves, shares, ebook/newsletter signals.
6. Automation review: classify actions as future_guidance, manual_review, aims_prompt_update, oneup_schedule_tuning, blotato_packaging_tuning, or rams_eligible_only_if_deterministic.

## Output contract

The council must publish:

- `report.html` for human review.
- `report.json` as the complete master report.
- `summary.json` for dashboard/council overview.
- `coverage.json` showing source reports loaded/missing.
- `repository-issue-appendix.json` containing RAMS-readable findings.
- `latest.json` pointing to all of the above.

## Guardrails

- Treat historic examples as calibration for future output.
- Do not ask RAMS to rewrite historic social posts.
- Do not infer visual quality from metrics alone; use thumbnail evidence when available.
- Do not trigger repository patches unless an exact repo-owned file path and deterministic acceptance criteria exist.
- Keep OneUp as the standard-post engine, Blotato as the shorts/video engine, and Zernio as analysis-only.
