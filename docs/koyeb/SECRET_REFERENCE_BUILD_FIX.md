# Koyeb secret reference build fix

## Confirmed issue

The narrowed Blotato/state env group is valid except for this Secret reference shape:

```env
BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}
```

Use Koyeb's compact Secret reference form instead:

```env
BLOTATO_API_KEY={{secret.BLOTATO_API_KEY}}
```

The compact form stays a single token in shell-based build tooling. The spaced form is risky because shells can treat the braces and spaces as grouping syntax while preparing a build environment.

## Required deployment action

Delete the old `BLOTATO_API_KEY` env variable in Koyeb, then recreate it exactly as:

```env
BLOTATO_API_KEY={{secret.BLOTATO_API_KEY}}
```

Do not paste this over the old value. Remove the old key first so Koyeb is not left with a stale or duplicate env definition.

## Regression guard

`scripts/koyebEnvDoctor.js` now rejects spaced Secret references and accepts the compact `{{secret.NAME}}` form only.
