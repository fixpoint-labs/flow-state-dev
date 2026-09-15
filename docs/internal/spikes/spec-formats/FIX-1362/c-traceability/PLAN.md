# FIX-1362 · Plan

Executes [SPEC.md](SPEC.md). `tdd`. One PR, or two at the seam after S4.

## Surfaces

| ID | Package · file | Change | Serves |
|---|---|---|---|
| S1 | `orchestration` · `defineSkillsCollection`, `SkillsLibraryOptions.collectionConfig` | Forward `flowIsolation` | R1 |
| S2 | `orchestration` · `createSkillsLibrary`, `createSkillActivator`, 4 seeding sites (`binding-reader`, both in `load-tool`, `seed-step`) | `initialSkills: array \| (ctx) => array`. Each site resolves before `ensureSeeded`; its signature stays. Build-time `with({ active })` / `with({ allowed })` under a resolver refuses loudly | R1 |
| S3 | `workforce` · loader | One new entry point: walk once, return records carrying their union. Reuse `readSeatSkills` + `readWorkforceDirectory`. `WorkerManifest.skills` | R2 R10 |
| S4 | `workforce` · `hire.ts` | Impose `seatSkills` like the body becomes `instructions`. Refuse `seatSkills:` frontmatter by name, one constant, both doors | R9 R10 |
| S5 | `workforce` · `agent-worker-flow.ts` | Declare the setting. Pass the resolver to library and activator. `flowIsolation` on | R1 · G |
| S6 | `workforce` · `agent-worker-flow.ts` | Always-on append **after** the matcher's apply step. Per-seat switches `skills.active`, `skills.activateTool`. Both activators slash-only | R3 R4 R5 |
| S7 | `orchestration` · delegation surface | Cap board workers' catalog seats to the seat's `tools:`. The generator's `tools:` mapping stays the only registration path | R6 |
| S8 | `orchestration` · refresh | Exported refresh: touch only names whose manifest exists; replace that folder whole (`list` prefix → `delete` dropped keys → write). `ensureSeeded` stays additive | R7 R8 |
| S9 | `docs/architecture/workforce-agent-kind.md` (being renamed by FIX-1366, find by content) · in the **impl PR** | C5 + Known-gaps: FIX-1362 pins the choice; FIX-1390 owns deprecation. Drop the "no mechanism yet" refresh line, the seeding gap, `dynamicActivation: true` | — |
| S10 | Docs | `workers-on-disk.md` EXTEND (a worker's skills) · `skills/activation.md` EXTEND minimum (two ways → three; FIX-1366 owns the rest) · workforce README · one `minor` changeset for both packages | — |

## Checks

| ID | Check | Passes when |
|---|---|---|
| V1 | Isolation | Two instances of one flow → distinct keys. Session scope still refuses |
| V2 | Resolver | Different configs → different catalogs. `with({ active })` under a resolver throws, naming why |
| V3 | Loader | Two seats on two teams → disjoint. Colocated needs no list. Errors collect |
| V4 | Hire | Hand-built record works. `seatSkills:` refused by name at each door. `HireOptions` unchanged. Existing refusals unchanged |
| V5 | Kind | Two seats, different skills, each reads only its own. Assert **contents** |
| V6 | Activation | Defaults render. Slash adds without clobbering. Both off → no listing, no tool, no classifier call in the trace |
| V7 | Fence | `tools: []` + own skill with `agents:` → no app tool reachable |
| V8 | Refresh | Org edit → unchanged until refresh. Deleted copy survives. Withdrawn file gone and `prompt-ref` fails. Seeding deletes nothing |
| VG | Goal, real model | Two seats, two skills, `fsdev run` each. Own skill visible, other's absent |

## Sequence

| # | Touches | Verify | After |
|---|---|---|---|
| 1 | S1 | V1 | — |
| 2 | S2 | V2 | — |
| 3 | S3 | V3 | — |
| 4 | S4 | V4 | 3 |
| 5 | S5 | V5 · VG | 1 2 4 |
| 6 | S6 | V6 | 5 |
| 7 | S7 | V7 | 5 |
| 8 | S8 | V8 | 5 |
| 9 | S9 S10 | by eye · docs build | 6 8 |

**Seam:** (a) 1–4 substrate, shippable alone. (b) 5–9 the kind.

## Pinned names · the only three

| Where | Name | Why |
|---|---|---|
| `WorkerManifest` | `skills` | Loader fills it. Absent on a hand-built record |
| Settings bag | `seatSkills` | Imposed. Not `skills`: an author-written `skills` object already exists there |
| Frontmatter | `seatSkills:` | Refused by name at both doors. Two doors refusing two spellings is the failure |

## Guardrails

| Rule | Because |
|---|---|
| Resolver is an O(1) read of `ctx.flow.config.seatSkills` | Runs on every render of every binding |
| One collection ref per request across reader, load tool, seed step | `ensureSeeded` memoizes on the ref. Empty array → no storage read |
| Seat holds the **union** of the app-level `skills` option and its own set. Duplicate bare name → refused at the mint naming both | Same no-precedence rule `readSeatSkills` already applies |
| Seeding sites never read config directly | They're in `orchestration`, which must not learn what a seat is. Hire is sync, before storage. Can't express the union |
| Library `fullCatalog()` stays off (`registerCatalogTools: false`) · load tool contributes only itself | One convergence point for registration |
| FIX-918 migration reseed untouched | Schema mismatch only, never a body edit. Not a hole in D3 |
| No third directory walker | The join reuses the two that exist |

## Edge cases

| Case | Expected |
|---|---|
| No skills at any level | Hires. No storage read, no seeding, no context |
| `skills.active` names an unheld skill | Refused at the mint, by name, listing what it holds |
| Same bare name from two levels · from app option + folders | Refused, both named |
| Same bare name on two teams | Fine. Different seats, different keys |
| Collection seeded before this change | New key. Old rows orphaned. No migration. Say so in the PR |
| Slash emitted by the model | Not a match. `message` input only |
| Refresh after the seat deleted a skill | Stays deleted |
| Seat added a file inside a skill folder, then refresh | Lost. D3 |
| Activate tool on, catalog empty | No listing, no tool slot |

Everything that refuses: fatal, collected, one run names every bad worker. Nothing retries, nothing hires partially.

## Follow-ups

- FIX-1390 filed.
- Per-seat cost unmeasured: large roster × large catalog. A measurement issue.
- `scope` vs `flowIsolation` can contradict. Flag on a third caller.
