# Blotato Weekly Social Video Skills

Use this skill pack for the Jonathan Harris Blotato short-video lane. It governs five weekday formats and keeps social output practical, source-grounded, and platform-safe.

## Active weekly skills

1. `news-insight` - Monday - explain the current AI news item, why it matters, who it affects, and one practical takeaway.
2. `model-verdict` - Tuesday - judge one AI model, tool, release, or feature by usefulness, limits, and audience fit.
3. `ai-at-work` - Wednesday - show how an AI development affects real workflows, creators, small businesses, or teams.
4. `reality-check` - Thursday - separate signal from hype, including what the headline means and what it does not mean.
5. `ai-playbook` - Friday - turn the source into a practical AI workflow or mini how-to.

## Format rules

- Build faceless vertical videos for Blotato.
- Target at least 30 seconds of spoken script.
- Prefer 4 to 5 scenes with specific `mediaSource` and `script` values.
- Use premium editorial visuals, dark technology palette, clean captions, and no gimmicky robot imagery.
- Keep the voice spartan, informative, British, sceptical, and practical.
- Treat source material as the evidence floor. Never invent facts, quotes, metrics, dates, product capabilities, or claims.

## Platform rules

- Instagram captions must stay within 5 hashtags.
- TikTok captions must stay within 5 hashtags.
- Default publishing channels are Instagram, YouTube, TikTok, and Facebook.
- Facebook publishing must include `target.pageId` when available.
- Keep secrets out of repo. Store only non-secret account IDs and defaults here.

## Endpoint map

- `GET /blotato/shorts/lanes`
- `POST /blotato/shorts/news-insight`
- `POST /blotato/shorts/:lane`
- `POST /blotato/shorts/news-insight/publish-now`
- `POST /blotato/shorts/:lane/publish-now`
- `GET /blotato/jobs/:sessionId`

## Fail-closed rules

- Reject unsupported lanes.
- Reject scripts shorter than the configured minimum where validation is added.
- Fail the job if Blotato returns no visual ID, no media URL, or a failed render status.
- Do not silently drop Facebook page targeting when `BLOTATO_FACEBOOK_PAGE_ID` is configured.
