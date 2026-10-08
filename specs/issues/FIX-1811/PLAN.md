# FIX-1811 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (Dn). `tdd`. One PR.

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `core` · the block definition type (`types/block.ts`, beside `asTool`) | Add `as(options: { name?: string; description?: string })`, returning a `BlockDefinition` with the same schema generics. Doc comment says how it differs from `.asTool()` (D3) | BR-1–3 BR-6 |
| S2 | `core` · the shared rebuild (`buildBlock`, beside `connectInput` / `rescue`) | Implement `.as()` as one more rebuild: the config with the new name and description, and every field the other rebuilds forward (resources, own resources, capabilities, children, static tools, dispatch address, model-output mapper). Re-apply a sequencer's informational output schema, which the sequencer stamps on the built block after `buildBlock` and a plain rebuild drops (D1) | BR-1–6 BR-13 BR-14 |
| S3 | `core` · the builders that read their own name while running: generator, router, evaluator, sequencer | Read the running name, not the authored one captured at construction. Known sites at [At implement time](#at-implement-time) (D1) | BR-7 BR-11 |
| S4 | `workforce` · tests only | A spec that defines the agent worker flow with a renamed catalog entry, and one with a mismatched key. **No source change** (D2) | BR-17 BR-18 BR-20 |
| S5 | Docs and release | [DOCS.md](DOCS.md)'s three operations; a `minor` changeset for `@flow-state-dev/core` | — |
| S6 | `goals/block-as/presents-a-block-under-a-new-name/` | The goal check, two legs, `GOAL_CONTROL=no-as` | BR-1 BR-7 BR-9 BR-17 |

Nothing is removed in this issue. The wrapper sites are FIX-1812's.

## Sequence

```mermaid
flowchart TD
  S1["S1 · the type"] --> S2["S2 · the rebuild"]
  S2 --> S3["S3 · running name in four builders"]
  S3 --> S4["S4 · Workforce specs"]
  S3 --> S6["S6 · goal check"]
  S4 --> S5["S5 · docs and changeset"]
  S6 --> S5
```

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S2 | A renamed handler as a generator tool (mock model): the compiled tool has the new name and description and the original's schema (BR-1–3); two copies make two tools (BR-4); a duplicate is refused (BR-5); a blank name is refused (BR-6) |
| V2 | S2 | Property fidelity: for each property in BR-13, the copy carries it. A sequencer copy still reports its output schema. Chained rebuilds in both orders agree (BR-14) |
| V3 | S3 | **Totality (BR-7).** For each of the five kinds, build a block with a distinctive name, run its `.as()` copy as a generator tool and as a sequencer step, collect every item, trace capture, status line, observer call and the error of a failing variant, and assert the original name appears in **none**. **Negative control:** run the same check on a copy made by overwriting only `name` on the definition object (no rebuild); it must fail for at least the generator and the router. Show that failure in the PR |
| V4 | S3 | Suspension (BR-9, BR-10, BR-11): a renamed tool that calls `ctx.suspend()` resumes under the new name with its side effect counted once from a real counter; a deny reaches the model; a renamed router whose branch suspends resumes on its recorded route |
| V5 | S2 | `.asTool()` in both orders (BR-15, BR-16); `ctx.wasRescued` and route lookups by the copy (BR-12); the original beside its copy keeps its own name (BR-8) |
| V6 | S4 | Workforce: `defineAgentWorkerFlow` with catalog `{ hire: <the real Workforce hire block>.as({ name: "hire", … }) }` passes the one-name check under the new name and is offered to a worker naming it, with the new description (BR-17). Control: the same catalog with the block passed without `.as()` must be refused; a mismatched key is refused with today's message (BR-18); a capability and the catalog giving different copies under one key are refused (BR-20) |
| VG | S6 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): both legs PASS on `openai/gpt-5.4-mini`, after both FAILED under `GOAL_CONTROL=no-as`. Verdict log rows for both runs |

The second path (BP-035) is V4's resume and V5's original-beside-copy: a rename that only works
on a first, unsuspended call, or only when the original is absent, fails there.

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Block method | `.as({ name?, description? })` | The product owner chose it on #2866 |
| Goal check | `goals/block-as/presents-a-block-under-a-new-name/`, control `GOAL_CONTROL=no-as` | Cited by `SPEC.md` |

Everything else is yours to name.

## Guardrails

| Rule | Because |
|---|---|
| `.as()` is a rebuild through the one shared path, never a spread copy of the definition object | A spread keeps the old name inside every closure that captured it, which is the half-rename V3's control plants (tenet 5: one convergence point for a block's identity) |
| Every reading of a block's own name at run time goes through the running identity | D1 promises one name; a builder that quotes its construction name breaks it in one item nobody looks at |
| No Workforce source change. If S4 fails without one, stop and surface it | D2 rests on the existing check reading `.name`; needing an edit means D1 was built wrong, not that Workforce should learn about renames (layer rule) |
| The original block is never mutated | BR-8, and the issue's persisted-name concern: nothing stored under the original may move |

## Docs

Reconcile [DOCS.md](DOCS.md) with the shipped behavior after V6, then publish its three operations
in the same PR. No new page.

## Sketch · pseudocode, illustrative, react to the shape

```
on every block definition:
    as(options):
        rebuild through the shared path with
            config  = this block's config, name ← options.name ?? name,
                      description ← options.description ?? description
            and every forwarded field the other rebuilds carry
        if this block reported an output schema of its own: carry it   ← sequencer only

inside a builder's run:
    my name = the running identity's name      ← not the one captured when it was built
```

**POC:** none. The premise that downstream reads `block.name` was checked by reading the tool
compiler, the tool executor, the resume reconstruction and Workforce's three one-name checks; V3
proves it on the real path.

## At implement time

- **Name sites captured at construction** (S3), found on `main` at the time of writing; re-grep,
  there may be more: the generator's run-time `blockName` (default `agentName`, tool attribution,
  errors); the router's route-selection record and `RouteUnavailableError`; the evaluator's
  `blockName`; the sequencer's output validation, `/connect-input` step name and `.validate()`
  error. Build-time messages (before any copy exists) may keep the authored name.
- The running identity may be absent when a block runs outside the engine (a unit harness). Fall
  back to the rebuilt definition's name there, never the construction closure.
- FIX-1791's PR #2865 edits Workforce's agent flow near the catalog code. Rebase on whatever has
  merged; S4 adds tests only.
- FIX-1812 (spec PR #2873) is blocked by this and starts after merge. It owns the devteam host and the Workforce pages and README that teach the wrapper; don't touch them here.

## Follow-ups

- FIX-1812 · replace the one-step rename wrappers with `.as()` (filed, blocked by this).
