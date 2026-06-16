> **Document status:** Historical implementation record  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Koyeb truncated env paste-file fix

## Confirmed issue

The narrowed Blotato/state variables supplied in the latest deployment note validate correctly and do not fail the local build or deploy smoke path.

The remaining production hazard was in the checked-in AIMS Koyeb paste files. Several values contained literal three-dot truncation markers from the spreadsheet/export layer. Those are not valid production values and must never be pasted into Koyeb.

## Applied fix

- `scripts/koyebEnvDoctor.js` now rejects any paste-ready value containing a literal three-dot truncation marker.
- `scripts/buildCheck.js` now validates repository Koyeb env paste files during `npm run build`.
- The two AIMS bulk paste files now omit unresolved truncated values instead of carrying broken replacements.
- Companion `*.omitted-truncated-values.md` files list the omitted keys so the real values can be retained in Koyeb or re-added only after verification.
- Koyeb CLI delete-directive files using `!KEY` are now accepted by the env doctor, matching the repo's existing remove-legacy-conflicts helper.

## Deployment instruction

For the current Blotato/state unblock, use:

```env
koyeb-env/blotato-state-with-api-key.env
```

That file contains the validated variables from the latest narrowed env group, including `BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}`.

Do not paste the omitted values back from the workbook or old bulk files unless the full value is verified. Keep the current Koyeb values for those keys during this deploy.

## Validation

Run:

```bash
npm run env:doctor:file -- koyeb-env/blotato-state-with-api-key.env
npm run env:doctor:file -- koyeb-env/aims.bulk-env.safe-no-google-private-key.txt
npm run build
npm test
```

Expected result: all commands pass.
