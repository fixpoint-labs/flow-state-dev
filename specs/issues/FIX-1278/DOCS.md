# FIX-1278 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No site page or package README changes.** The change is repo tooling (a CI boundary script)
plus code comments. Nothing a user of `@flow-state-dev/store-postgres` calls, configures or
observes changes.

Checked and left as is:

- `packages/store-postgres/README.md` and `packages/store-sqlite/README.md` don't describe the
  boundary rules.
- `docs/architecture/overview.md` → "Boundary rules (locked)" lists no store-adapter rule. D1
  adds no locked contract, so nothing goes there.
- `.agents/skills/add-store-adapter/SKILL.md` points at both adapters as templates and says
  nothing about engine type-only imports, so nothing there is now wrong.

The only prose this issue owns is the comment above the new rule in
`scripts/validate-package-boundaries.mjs` (shape in [SPEC → What changes](SPEC.md#what-changes)).
It should say, in one or two lines, that `store-postgres` value-imports engine runtime (its
trace store and live-tail helpers) where `store-sqlite` keeps local copies.
