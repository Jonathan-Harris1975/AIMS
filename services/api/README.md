# API aggregator

## Status

**Present but not wired.** This page documents behaviour backed by files in `services/api/`.

## Purpose

Contains an Express router that mounts podcast, script, TTS and artwork routers under one aggregator path, but the current root route registry does not mount this router.

## Routes

No active HTTP route. `routes/index.js` mounts those services directly instead.

## Main files

- `services/api/index.js`

## Workflow

- Imports podcast, script, TTS and artwork routers.
- Exports `router` and default router.
- No current caller was found in the active server route registry.

## Environment variables

No service-specific env vars.

## External integrations

Express only; child routers have their own integrations.

## Storage

No storage.

## Tests

No dedicated test found.

## Common troubleshooting

- Do not document `/api/*` as active until this router is mounted.
- If mounting it later, add tests and update the root route map.

## Connections to other services

Aggregator for services that are currently mounted directly at root-level paths.
