# Mobile UX Council Skill

## Purpose
A standing monthly council that receives the fresh rendered Mobile UX hard-gate audit and turns it into a RAMS-readable master decision report.

The council focuses on rendered evidence, screenshots, responsive source ownership and safe website-repo remediation.

## Council members

- Mobile UX Lead — owns release verdict, mobile quality score, P0/P1 blocker themes and user-journey risk.
- CSS & Responsive Systems Lead — owns shared CSS, grids, overflow, breakpoints, typography and image responsiveness.
- Navigation & Interaction Lead — owns hamburger menu, drawer, overlay, Escape/outside click and desktop breakpoint reset behaviour.
- Accessibility Lead — owns Phase 5C WCAG evidence, focus order, accessible names, labels and keyboard behaviour.
- Conversion Journey Lead — owns CTA continuity, touch targets, buy/newsletter/contact paths and conversion friction.
- Visual Evidence & Screenshot Lead — owns screenshot evidence quality, viewport recurrence and before/after proof.
- Performance & Asset Efficiency Lead — owns image/media sizing and mobile asset behaviour exposed by the hard gate.
- QA Regression Lead — owns validation commands, repeated MUX group tracking and rerun requirements before release.
- Automation Safety Lead — owns RAMS patch safety, protected paths, source ownership and PR-gated remediation.

## RAMS rules

- Prefer this council report over the raw Mobile UX report.
- Auto-patch only exact website-owned files such as shared partials, CSS, JS or HTML with deterministic rendered evidence.
- Protect R2-owned podcast/blog/transcript content from Mobile UX repo patching.
- Every code-fix candidate must be rerun through the Mobile UX hard gate after patching.
