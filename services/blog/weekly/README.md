# Weekly blog pipeline

This module implements the weekly long-form blog generation lane used by `POST /blog/weekly/build`.

## Responsibilities

1. Determine the target week and gather eligible source/context material.
2. Select a coherent editorial angle rather than concatenate unrelated feed items.
3. Generate the article in the shared Jonathan Harris voice.
4. Apply long-form editorial, source-integrity, structure, readability and content-quality checks.
5. Generate/associate suitable artwork.
6. Store the article in the configured blog R2 location.
7. Update the blog RSS/publication artefacts required by the website.
8. Persist job state for `/blog/weekly/jobs/:lane/:sessionId`.

## Editorial standard

The article must provide original judgement, not merely restate source summaries. Openings must establish the argument quickly; sections must advance it; conclusions must leave a clear takeaway. Unsupported factual claims fail closed. British English and the shared Jonathan voice are mandatory.

## Configuration

Use the blog, artwork, OpenRouter, RSS and R2 variables documented in `services/blog/README.md` and the production environment templates.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
