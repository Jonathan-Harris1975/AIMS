# Model-routing audit — 28 October 2026

Reviewed AIMS `8d6a4e0080f790afdf8aca05c279e3271bd86642`, HIVE
`92384d636dffc2631be0db00fcdae1fc9dd9f233` and RAMS
`2f8f6972f21376b2f70a3ae80557a73107abdeaa` production source, request builders,
model routers and committed environment templates. Tests, documentation examples,
model-name family detection and deprecated-model exclusions were distinguished
from actual model selections. Searches covered literal provider/model IDs and
bare GPT/Claude/Gemini model names in production JS/TS/Python and deployment files.

| Repository | Finding | Resolution |
| --- | --- | --- |
| AIMS | Request models resolve through the central route registry. Outreach status contained independent Sonnet/Opus/Sol display fallbacks that could disagree with the actual route. | Report the configured primary and full route chain; preserve the existing status field types. |
| HIVE | Production Python requests use Settings/ModelRouter, but `HIVE-PRODUCTION-SHARED.env` retained Gemini/Terra/Codex assignments that could override the newer defaults. | Align its four stale role values with Luna/Sonnet/Sol. Guard production/example templates against Settings drift. |
| RAMS | No literal model-ID request bypass found. Planner and council use configured role assignments. | No runtime code change needed. Keep configured defaults and deprecated-model exclusions. |

Central defaults, explicit premium roles, free fallback assignments and image-model
settings remain intentional configuration, not rogue hard-coded request models.
The audit does not prove the contents of deployed Koyeb variables or HIVE's live
D1 registry. Those can override committed defaults and must be read from runtime
routing/usage evidence before asserting which model actually handled a task.
