> **Document status:** Historical implementation record
> **Last reviewed:** 16 June 2026
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Koyeb secret reference build fix

## Confirmed issue

The previous env guard rejected this Koyeb bulk-edit Secret reference shape:

```env
BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}
```

That rejection was too strict. Koyeb's official environment-variable bulk-edit documentation uses this spaced form:

```env
DB_PASSWORD={{ secret.POSTGRESQL_PASS }}
```

The guard now accepts both supported shapes:

```env
BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}
BLOTATO_API_KEY={{secret.BLOTATO_API_KEY}}
```

It still rejects invalid Secret names such as hyphenated names:

```env
BLOTATO_API_KEY={{ secret.BLOTATO-API-KEY }}
```

## Required deployment action

Use the normal Koyeb bulk-edit form:

```env
BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}
```

Make sure the Koyeb Secret named `BLOTATO_API_KEY` exists before redeploying. Undefined references are replaced by a blank value during Koyeb processing, which can make the app boot but leave the Blotato route unconfigured.

## Regression guard

`scripts/koyebEnvDoctor.js` now validates Koyeb Secret references without rejecting Koyeb's documented bulk-edit syntax.
