# FIX-1484 · path-matching characterization

This pins what the legacy matcher in `packages/core/src/tools/resource-tools.ts`
(`tryMatchPath`, used by the CRUD tools, `resolveResourceByPath` and
`resolveResourceByUri`) resolves today. It runs against the real engine
resource registry, not stubs.

```bash
pnpm install
cd packages/engine
npx vitest run --config ../../specs/issues/FIX-1484/poc/path-matching-characterization/vitest.config.mjs
```

What it showed (2026-09-30, `main` @ 67a3bb9b):

- **Parameterized collections (`[topic]/observations`) can't be reached by path at all.**
  Every entry point throws `requires an object key`. The matcher passes the whole path
  as a string key, and its extracted params are never used.
- **A nested path under a single-wildcard collection resolves differently depending on
  the entry point.** Take `nest/x/y` with `nest/*` registered before `nest/**`. The CRUD
  tools and `resolveResourceByPath` let `nest/*` claim it and then throw. `resolveResourceByUri`
  falls through to `nest/**` and resolves it.
- Replacing the matcher with the collection mechanism (`matchesPattern`, or
  `resolveCollectionKey` with extracted params) changes both kinds of row. So
  "align with collection URIs" and "no behaviour change" can't both hold.

Negative control: making the wildcard branch match single segments only (the
`matchesPattern` rule) turns the snapshot red. Reverting it turns it green again.

This is throwaway design evidence. It sits outside every package's vitest root, so
`pnpm test` never runs it.
