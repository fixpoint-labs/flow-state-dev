# FIX-1362 · Plan

Executes [SPEC.md](SPEC.md). `tdd`. Three packages. One PR, or two at the seam after step 4.

## Steps

| # | Do | Test | After |
|---|---|---|---|
| 1 | Forward `flowIsolation` through `defineSkillsCollection` and `SkillsLibraryOptions.collectionConfig` | Two instances of one flow → distinct storage keys. Session scope still refuses it | — |
| 2 | Make `initialSkills` resolvable per execution: `array \| (ctx) => array` in `createSkillsLibrary` and `createSkillActivator`, and at the four seeding sites (`binding-reader`, both in `load-tool`, the activator's `seed-step`). `ensureSeeded`'s signature stays: each site resolves first. Build-time `with({ active })` / `with({ allowed })` under a resolver **refuses loudly** | A resolver returning different arrays for different configs seeds different catalogs. `with({ active })` under a resolver throws, naming why | — |
| 3 | Join the loader: one entry point walks the tree once, returns records carrying their union. Reuse `readSeatSkills` + `readWorkforceDirectory` unchanged. Grow `WorkerManifest` by `skills` | Two seats on two teams → disjoint sets. A colocated skill needs no list. Loader errors still collect, not throw | — |
| 4 | Impose `seatSkills` at hire, like the body becomes `instructions`. Refuse a `seatSkills:` frontmatter key by name at loader **and** hire: one constant, both doors, like `REFUSED_PERSONA_KEY` | Hand-built record works. `seatSkills:` refused by name at each door. `HireOptions` gains nothing | 3 |
| 5 | Wire the kind: declare the setting, pass the resolver to library and activator, turn on `flowIsolation` | **R1** · two seats, different skills, each reads only its own. Assert catalog **contents** | 1 2 4 |
| 6 | Activation: always-on append step after the matcher; per-seat switches for it and the activate tool; both activators slash-only | R3 R4 R5 | 5 |
| 7 | Close the delegation seat hole (fence below) | R6 | 5 |
| 8 | Refresh with full-folder replacement | R7 R8 | 5 |
| 9 | Narrow the contract, in the **impl PR** (BP-037): C5 and Known-gaps say FIX-1362 *pins* the entry point and draws the docs boundary; FIX-1390 owns deprecation. Drop C5's "no mechanism yet" refresh line, the per-seat seeding gap, and the unconditional `dynamicActivation: true`. File is being renamed by FIX-1366: find it by content | Read by eye | 6 8 |

**Two-PR seam.** (a) steps 1–4, the substrate, independently shippable. (b) steps 5–9, the kind. One PR if it stays reviewable.

## Three pinned names · the only ones

| Where | Name | Why pinned |
|---|---|---|
| `WorkerManifest` | `skills` | The loader fills it. Absent on a hand-built record |
| The kind's settings bag | `seatSkills` | Imposed at hire. Not `skills`: the bag already has an author-written `skills` object |
| `WORKER.md` frontmatter | `seatSkills:` | Refused by name at both doors. Two doors refusing two spellings is the failure |

## Implementer traps

| Trap | Rule |
|---|---|
| Build-time index is empty under a resolver | Refuse `with({ active })` loudly. Skipping validation widens the tool surface |
| Resolver cost | O(1) read of `ctx.flow.config.seatSkills`. No walking, parsing, I/O. It runs on every render of every binding |
| `ensureSeeded` memoizes on the collection **ref** | Share one ref per request across binding reader, load tool, seed step. Resolve the array first; empty → no storage read |
| App-level `skills` option still exists | A seat holds the **union**. A bare name from both is refused at the mint naming both sources. No precedence rule |
| Always-on vs the matcher | The matcher's apply step **replaces** `activeSkills` by design. Append the always-on set **after** it, deduped |
| Activate tool listing | Per-turn token cost proportional to the catalog. Behind the per-seat switch, default off. Empty catalog → no listing, no tool slot |

## The fence · one convergence point

A seat calls exactly the catalog keys its `tools:` names. The generator's own `tools:` mapping in `agent-worker-flow.ts` is the only registration path.

| Writer | Today | Must stay |
|---|---|---|
| Skills library `fullCatalog()` | Off · `registerCatalogTools: false` | Off |
| `createLoadSkillTool` | Contributes only `loadSkill` | Unchanged |
| Delegation surface `buildDelegationTools` | Hands board workers catalog seats from a skill's `allowed-tools` | **Closed.** A seat's own skill can now declare `agents:`. A seat with `tools: []` must not reach app tools through a board worker |

## Refresh · two rules

1. Touch only names whose manifest still exists. A skill the seat deleted stays deleted.
2. For a name it touches, replace the folder whole: `list()` the `<name>/` prefix, `delete()` every key the source no longer carries, then write. `ResourceCollectionRef` already has both.

`ensureSeeded` stays additive: a file the source never had is the seat's edit. The FIX-918 migration reseed stays: it fires on schema mismatch, never on a body edit.

## Rejected in the plan · don't reopen

| Alternative | Why not |
|---|---|
| Seeding sites read `ctx.flow.config.seatSkills` directly | Those sites are in `orchestration`, which must not learn what a seat is. Hire is synchronous, before storage exists. Can't express the union with the app option |
| A third directory walker | The join reuses the two that exist. The epic flagged a third as the outcome to avoid |

## Edge cases

| Case | Expected |
|---|---|
| `seatSkills:` in frontmatter | Refused by name, both doors |
| No skills at any level | Hires. Empty array. No storage read, no seeding, no context |
| `skills.active` names a skill the seat doesn't hold | Refused at the mint, by name, listing what it holds |
| Same bare name from two levels · from app option + folders | Refused, both paths named. No precedence |
| Same bare name on two teams | Fine. Different seats, different keys |
| Own skill declares `agents:`, seat has `tools: []` | Board workers get no catalog seats beyond the seat's `tools:` |
| Collection seeded before this change | Read moves to a new key. Seat re-seeds. Old rows orphaned, not lost. No migration. Say so in the PR (BP-030) |
| Slash token emitted by the model | Not a match. Matcher reads the turn's `message` only |
| Refresh after the seat deleted a skill | Stays deleted |
| Seat added a file inside a skill folder, then refresh | Lost. All-or-nothing per skill (D3) |
| Activate tool on, catalog empty | No listing, no tool |

Everything that refuses is a startup misconfiguration: fatal, collected, one run names every bad worker. Nothing retries, nothing hires partially.

## Docs

| Surface | Change |
|---|---|
| `apps/docs/docs/workforce/workers-on-disk.md` | EXTEND: a worker's skills. Three folders, colocated needs no list, the `skills:` settings. After settings, before channels. Say "each worker keeps its own copy", never "isolation" or "seeding" |
| `apps/docs/docs/skills/activation.md` | EXTEND, **minimum**: "two ways" → three, one sentence on the built-in. FIX-1366 owns the rest of the page |
| `packages/workforce/README.md` | EXTEND: the joined loader entry point and the kind's skills settings |
| Contract | Step 9 |
| Changeset | One `minor` covering `workforce` + `orchestration` |

## Follow-ups · filed or flagged

- **FIX-1390** deprecates one of the two skills entry points. Filed.
- Per-seat cost unmeasured: large roster × large catalog = one bucket and one seed pass per seat. A measurement issue.
- `defineSkillsCollection`'s `scope` and `flowIsolation` can now contradict. Flag for `improve-codebase-architecture` if a third caller appears.
