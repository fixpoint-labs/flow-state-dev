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

## `rename-human-reasons.ts`

FIX-2151: renames the suspension reasons `"human_approval"` / `"human_input"` to
`"user_approval"` / `"user_input"`. Unlike the codemod above it is textual,
not type-aware: both strings are unique, so it is a word-bounded replace over every tracked file under `packages`, `apps`, `goals`,
`docs` and `.changeset`, leaving history alone (`CHANGELOG.md`, blog posts,
`docs/internal/`, a goal's dated verdict rows, its own release note):

```bash
pnpm tsx scripts/codemod/rename-human-reasons.ts
```

## `rename-chief-of-staff.ts`

FIX-2244: renames the worker id `chief-of-staff` to `shift-coordinator`, the
`chiefOfStaff*` / `ChiefOfStaff*` names, Shift Manager's `cos` route, test ids
and the `cos` names derived from them, and the prose "chief of staff". No old
name collides with a live one, so it is a text pass plus `git mv` for the paths
that name the old id:

```bash
pnpm tsx scripts/codemod/rename-chief-of-staff.ts
```

It leaves retained specs, changelogs, `docs/internal` and a goal's dated verdict
rows alone: they are history.
