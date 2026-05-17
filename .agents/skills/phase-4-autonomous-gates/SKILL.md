# Phase 4 Autonomous Gates

Use these local rules when applying Phase 4 skills in the Jonathan Harris ecosystem.

## 4A: schema-markup
- Structured data may be generated or patched automatically only when it is template-bounded.
- Required fields for blog/social pages: `@context`, `@type`, `headline`, `description`, `datePublished`, `author`, `mainEntityOfPage`.
- Invalid JSON-LD is a hard fail.

## 4B: social-content
- Social/blog content may publish without manual review only when the Phase 4 content gate passes.
- Claims, numbers, and direct quotes must be present in supplied source material.
- Brand voice must remain British English, sceptical, no-hype, and Jonathan Harris aligned.

## 4C: writing-plans, systematic-debugging, executing-plans
- Engineering automation may prepare and execute bounded diffs only after a written plan and validation result exist.
- Broad refactors, protected paths, dependency changes, DNS/config changes, and outreach sending remain manual-only.
- Fail closed: quarantine content, or mark code tasks `manual_review`.
