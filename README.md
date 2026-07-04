# AIMS Fix Package — 1 file, 1 change

## What's in here

This review found exactly **one** file that needs updating: a broken,
dead compatibility shim. The fix is a **deletion**, not an edit, so
there's no "new version" of the file to ship — instead this package
gives you two ways to apply it.

## The file

`services/shared/utils/hiveSkillPool.js`

## Why it needs to go

- The real implementation lives at `services/shared/hiveSkillPool.js` (247 lines).
- This file was meant to be a thin re-export shim, but it re-exports from
  `./utils/hiveSkillPool.js` — which, from its own location
  (`services/shared/utils/`), resolves to the non-existent
  `services/shared/utils/utils/hiveSkillPool.js`.
- Confirmed via `node --check` and a direct `import()`: this module throws
  `Cannot find module` if anything ever imports it.
- Nothing currently imports it (all real call sites correctly import
  `services/shared/hiveSkillPool.js` directly), so it's inert today — but
  it's dead weight and a landmine for the next person who imports it by
  the "obvious" `utils/` path.

## How to apply

**Option A — apply the patch:**
```bash
cd AIMS-main
git apply remove-broken-hiveSkillPool-shim.patch
```

**Option B — do it by hand:**
```bash
cd AIMS-main
rm services/shared/utils/hiveSkillPool.js
```

Either way, nothing else needs to change. After applying, re-run your
existing CI (`npm test`) to confirm — this file wasn't referenced by
anything, so no test should be affected.
