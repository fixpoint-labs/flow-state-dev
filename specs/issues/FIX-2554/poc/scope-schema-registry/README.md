# POC · reconciling scope-state schemas across a flow and its blocks

Throwaway design evidence for the FIX-2554 follow-up (#4770). It is not production code.
Nothing here is imported by a package, exported, built, typechecked or linted
(`eslint.config.mjs` and `.fallowrc.json` already ignore `specs/**/poc/**`).

```bash
cd apps/kitchen-sink && ../../node_modules/.bin/tsx ../../specs/issues/FIX-2554/poc/scope-schema-registry/run.mts
```

## The question

FIX-2554 fills scope state (`ctx.session/user/org.state`) with schema defaults on load,
but only from the **flow's** `stateSchema`. A block's or capability's `sessionStateSchema`
types `ctx.session.state` and is never applied. The owner proposed a schema registry in core.
This POC tests whether a registry is the right shape for that, or whether something
smaller does the same job.

**What would have made me drop B:** if a per-flow union could not see a conflict that
matters (it cannot see cross-flow user/org conflicts on its own, so `checkServerB` was
added and tested), or if the walk were too expensive to run in `defineFlow`. Neither turned out to be true.

## The variants

All three share one set of merge rules (`reconcile.mts`) and FIX-2554's fill, copied
verbatim from #4770's head `8f9bf63` (`fill.mts`). The variants differ in when the rules
run and which declarations they cover.

| | What it is | File |
|---|---|---|
| **A** | A `SchemaRegistry` in core. Blocks register when built, flows when defined, and anything can call `register()` directly. The fill reads the registry's merged schema. | `variant-a-registry.mts` |
| **B** | No registry. `defineFlow` walks its reachable blocks (the same `walkBlockGraph` it already walks for flow config and resources), unions every scope schema, and the fill reads that. `checkServerB` compares user/org across flows when a server admits them. | `variant-b-flow-walk.mts` |
| **C** | #4770 as it stands: flow-only fill. `checkFlowC` generalizes #4770's `hireWorkforce` refusal: a block's defaulted field the flow doesn't restate is refused. | `variant-c-baseline.mts` |

The merge rules: identical declarations merge, and new fields union at any depth. A
different type is refused, and so is a different default. Each error names the field path
and both declarers. If one declarer gives a default and the other gives none, that is
not a conflict. `.nullable()` counts as part of the type.

## What it showed · 2026-11-05, on `main` 7d615e708

| # | Check | A · core registry | B · per-flow walk | C · baseline (#4770) |
|---|---|---|---|---|
| 1 | A block default is present on a fresh session | yes | yes | **no**: `{requestCount:0}` only. `checkFlowC` refuses and asks the author to restate it in the flow's schema |
| 2 | A type or default conflict between two blocks names both | yes, e.g. `session.state.mode … block "blockX" and block "blockY" default it to "ask" and "plan"` | yes, same message | yes, but only through the check. The fill never sees block schemas |
| 2b | The same two blocks, in two **different** flows | **refused**: a false positive, since a session belongs to one flow | ok | ok |
| 2c | A dev edits a block's default and the module re-evaluates (HMR, vitest watch) | **refused** until the process restarts, because the stale registration stays | ok | ok |
| 3 | Non-colliding fields from two blocks union | yes | yes | no, nothing is filled |
| 4 | Nested: the block adds `features.search`, the flow declares `features` | `{features:{biasCheck:false, search:true}}`. A different nested default or a container typed as a record is refused, naming the path `session.state.features.biasCheck` | same | the block's nested default is dropped |
| 4b | Nobody defaults the `features` container | an inner default fills only when `features` is stored. #4770's fill never creates a container. Same in all variants | same | same |
| 5 | Cross-flow user record: undeclared keys kept (no strip) | kept | kept | kept |
| 5b | …no leakage of another flow's defaults | **leaks**: flow-q reads `theme:"dark"`, a default only flow-p declares, and it is persisted on the next full write. Session leaks too: a chat-agent session under A fills 34 fields, most of them the workforce coordinator's | none | none |
| 5c | Two flows type `user.state.theme` as string and number | refused at registration | refused at server admission (`checkServerB`) | not detected |
| 6 | Registration cost | 41 declarations from all 6 kitchen-sink flows: about 0.3 ms in total, once per process | walk + collect + merge per `defineFlow`: about 0.25 to 0.4 ms (coordinator, 94 blocks, 18 declarations). chat-agent reaches its refusal in about 0.09 ms. The walk alone is about 13 µs | 0 (the check alone costs about the same as B) |
| 6 | Per-load fill (session) | fresh: about 51 µs, because the schema covers every flow | fresh: about 20 to 34 µs, against C's 5 to 11 µs. Full record: about 5 to 13 µs, about 1 µs over C | fresh: 5 to 11 µs. Full: 4 to 12 µs |
| 6 | Real flows | **the whole server fails** on the first conflict (below) | **1 of 6 flows refused**: chat-agent, same conflict | the coordinator is refused (`activeSkills` from the skills capability isn't restated), and so is chat-agent |
| 7 | POC code (non-comment lines; shared: rules 156, collect 38, fill 92) | 31, plus a call in `buildBlock` and one in `defineFlow` | 28, inside `defineFlow`, plus about 10 in the engine for the server check | 26 |
| 7 | Public surface added | `SchemaRegistry` / `registerScopeSchema` and a conflict error **at core's root** (direct registration only helps if adopters can reach it), plus a process-global singleton | **none at the root**. An internal merged schema on the flow instance, and the server check in the engine | none |

Overhead is in µs everywhere. A store read is in ms, so cost does not decide this.

### What it found in real code

- **The conflict in check 6 is real**: `session.state.thinkingStyle` is
  `z.enum(["background-work","default"])` in the chat-agent flow and in `apply-manual-style`,
  but `z.string().optional()` in `assistant-generator`
  (`apps/kitchen-sink/flows/chat-agent/run/assistant/assistant.ts:21`). The block's schema is a
  wider *read view* of the flow's field. Under strict structural equality, B refuses chat-agent
  until that one line declares the same enum. The alternative is a "narrower declaration wins
  if assignable" rule, which is more code with subtler semantics. I'd keep the rule strict and fix the block.
- **The owner's complaint, measured**: the workforce coordinator's skills capability declares
  `activeSkills` with a default, and today it is never filled (C). B fills it with no change to the flow.
  On chat-agent, B also fills `reportedSideChainTaskIds` and `reportedBackgroundTaskIds`, which come from
  the background-work blocks. On `main` they are filled nowhere.
- **Capability schemas are not on the built block.** `resolveCapabilities` merges them
  (`extendSchema`, last-wins, silently) and then drops the result. Only
  `config.__resolvedCapabilities` keeps them. A and B both read from there. Schemas that presets
  contribute are not covered by this POC: real code should keep the merged surface per source.

## My pick: B, plus the server check for user/org

**The trade-off.** A's one unique feature is registration without a flow or block. To have it,
A needs a registry that exists before any server does: a process global. That global is the
cause of every A-only failure above: false conflicts between unrelated flows, session and user
defaults leaking across flows (and across servers or tenants in one process), stale
registrations under HMR, one conflict failing every flow, and new public surface on a root
export FIX-2447 is shrinking. If you scope the registry to a server to fix that, blocks can no
longer register themselves when built. Something then has to walk each flow's blocks, which is B.

B gives the owner what was asked for (block and capability defaults at runtime, union, conflicts
named at definition) at about 0.3 ms per `defineFlow` and about 1 µs per load on a stored
record. It needs no new exports and copies an existing pattern (`collectRequiredFlowConfig`,
`collectBlockResources`). A schema that belongs to no block can still be declared on the flow,
or in a capability.

**What would change it:** a real need to read or declare scope schemas **outside any flow**.
Examples: a store adapter or migration that validates user records with no flow loaded, or a
devtool that lists every schema in the process. Then build A, but owned by the server
(`createFlowState`) and fed by B's walk, not a global filled by `buildBlock`.

## What this doesn't cover

Preset-contributed schemas, dynamic `uses` (it contributes no schemas, by design), dynamic
schedules, `reads` roots (`collect.mts` reads roots back off the instance; real code uses
`defineFlow`'s own `reachable`), and the request scope. Refinements are compared by input
structure only, a simplification real code must decide on.
