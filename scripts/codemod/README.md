# Codemods

One-shot, type-aware codemods used for monorepo-wide renames. Committed so the
rewrites are reproducible and auditable — a reviewer can re-run a codemod on a
fresh clone of `main` and diff the output against the PR.

## `rename-sequencer-then-to-step.ts`

Renames the sequencer DSL `then`-prefix family to the `step` family
(`then`/`thenIf`/`thenAll`/`thenAny` → `step`/`stepIf`/`stepAll`/`stepAny`).

The bare `then` name collides with the JavaScript Promise/thenable protocol, so
a textual find-replace would also rewrite genuine `Promise.then` call sites. The
codemod uses the TypeScript type checker (via `ts-morph`) to rewrite a
`.then`-family call only when the receiver resolves to a `SequencerDefinition`.

Run it **before** renaming the `SequencerDefinition` interface methods, so that
`.then` still resolves on the interface and every link in a chained call keeps a
`SequencerDefinition`-typed receiver:

```bash
pnpm tsx scripts/codemod/rename-sequencer-then-to-step.ts
```

Two patterns the type filter cannot catch must be fixed by hand (see the
FIX-595 spec §4.5):

- `any`-typed receivers (`let chain: any = sequencer(...)`)
- structural generic constraints (`<S extends { then: ... }>`)

Both live in `packages/memory/src/memory-system-blocks.ts`. After running the
codemod, grep the memory package for any remaining sequencer-shaped `.then(`
calls and rewrite them manually.
