# CI npm executable

This private bundle locks the existing workflow npm version and its integrity metadata. It is separate from application dependencies. Renovate's standard npm manager owns its manifest and lock updates under the repository's existing safe/manual policy.

Workflows bootstrap with `npm ci --prefix .github/ci-toolchain --ignore-scripts --no-audit --no-fund`, then prepend the bundle's `node_modules/.bin` to PATH within each command step. Child npm commands inherit that PATH. No global install or GitHub environment file is needed. Verification reads the executable version from the committed lock, so Renovate updates do not require a second version writer.
