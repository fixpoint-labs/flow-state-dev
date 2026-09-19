# FIX-1394 · the probe harness and the four variants

Throwaway. Nothing here merges, nothing here is under `packages/`, and the whole directory is
deleted once the ratify is recorded. The answer it produced lives in
[`spec/FIX-1394/RATIFY.md`](../../spec/FIX-1394/RATIFY.md).

## Run it

```bash
# the matrix — four candidates, six probes, every cell
node_modules/.bin/tsx --tsconfig spec-poc/FIX-1394-probes/tsconfig.json \
  spec-poc/FIX-1394-probes/run.mts

# V1 — six violating fixtures, each red in exactly one row
node_modules/.bin/tsx --tsconfig spec-poc/FIX-1394-probes/tsconfig.json \
  spec-poc/FIX-1394-probes/run.mts --fixtures

# VG — the goal: one capability, two attachment modes, the same working seat
node_modules/.bin/tsx --tsconfig spec-poc/FIX-1394-probes/tsconfig.json \
  spec-poc/FIX-1394-probes/goal.mts

# V0 — the evidence base the spec rests on, re-derived from the repo
node spec/FIX-1394/evidence/check-conventions.mjs --run-tests
node spec/FIX-1394/evidence/check-conventions.mjs --negative-control
```

`tsconfig.json` exists only so `tsx` can resolve `@flow-state-dev/*` from outside a workspace
package. It adds no workspace member and no lockfile entry, so CI is untouched.

## How it is put together

| File | What it is |
|---|---|
| `harness/contract.mts` | The six probes and the one capability, **fixed before any variant** (D2) |
| `harness/real-path.mts` | One turn of one seat: real loader, real `hireWorkforce`, real engine, and a recording model that reports the tool list and the messages the provider received |
| `harness/probes.mts` | The six probes. Imports no candidate |
| `harness/compile.mts` | The stand-in for the codegen a ship ticket would write — shared by B and C, because they differ in what an author writes and not in what it compiles to |
| `variants/` | The four candidates |
| `fixtures/` | V1: the control package with one deliberate defect, six times |

## Two things worth knowing before reading a cell

**Every observation is taken at the model.** Not at a resolver, not at a config key. "Can this
seat call that tool" is a claim about the tool list the provider is handed, so that is what is
read — and "did the block run" is read off a marker the block itself writes, because being
offered a tool and running it are a tool call apart.

**The candidates each get their strongest form.** Variant A carries its document in the
`SKILL.md` body rather than as a supporting file, because a supporting file is stored and then
read only by the delegation surface — it never reaches the holding seat's own context. Authoring
it the idiomatic way would have made A fail P3 for a reason about `files[]`, not about A.
