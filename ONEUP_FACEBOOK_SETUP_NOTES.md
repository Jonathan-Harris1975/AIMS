# OneUp platform setup check

## What changed

The OneUp scheduler now validates the target OneUp category before live scheduling. This prevents AIMS from reporting a successful OneUp schedule while Facebook, Instagram, or TikTok is absent from the selected category.

## Why this matters

`ONEUP_SOCIAL_NETWORK_ID=ALL` only targets all accounts inside the selected OneUp category. It does not mean every connected OneUp account globally. If the `General` or `Ebooks` category does not contain the Facebook Page, Facebook posts will not be created.

## New env defaults

```env
ONEUP_REQUIRED_NETWORK_TYPES=Facebook,Instagram,TikTok
ONEUP_VALIDATE_TARGET_ACCOUNTS=true
```

`ONEUP_SOCIAL_NETWORK_ID` now also accepts:

```env
ONEUP_SOCIAL_NETWORK_ID=ALL
ONEUP_SOCIAL_NETWORK_ID=fb-page-123
ONEUP_SOCIAL_NETWORK_ID=fb-page-123,ig-account-456
ONEUP_SOCIAL_NETWORK_ID=["fb-page-123","ig-account-456"]
```

Bare and comma-separated account IDs are normalised to OneUp's required JSON-array format before scheduling.

## Diagnostic route

Use:

```text
POST /oneup/setup/check
```

Example body:

```json
{
  "categoryNames": ["General", "Ebooks"],
  "socialNetworkId": "ALL",
  "requiredNetworkTypes": ["Facebook", "Instagram", "TikTok"],
  "includeGlobalAccounts": true
}
```

Expected result: `ok: true` for each category that should create the intended Facebook, Instagram, and TikTok posts.

If the result is `409`, check the returned `warnings`. The likely cause is that one of the required platform accounts is not connected to the OneUp category used by AIMS, or one of the required accounts needs refreshing in OneUp.
