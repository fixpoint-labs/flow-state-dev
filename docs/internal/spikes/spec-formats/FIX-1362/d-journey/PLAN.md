# FIX-1362 · Plan

Executes [SPEC.md](SPEC.md). `tdd`. One PR, or two at the seam after the hire step.

## Each seam, before → after → proof

### The skills collection · `orchestration`

| | |
|---|---|
| **Before** | `defineSkillsCollection` never forwards `flowIsolation`. Every instance of the kind shares one key |
| **After** | `flowIsolation` forwarded through `DefineSkillsCollectionOptions` and `SkillsLibraryOptions.collectionConfig`. Storage already keys an isolated resource per instance; a seat is minted with the worker's id, so no new key or scope |
| **Proof** | Two instances of one flow → distinct keys. Session scope still refuses it |

### `initialSkills` · `orchestration`

| | |
|---|---|
| **Before** | A static array, indexed at build time. Four seeding sites unwrap it |
| **After** | `array \| (ctx) => array`. Each site resolves before calling `ensureSeeded`, whose signature stays. Under a resolver the build-time index is empty, so `with({ active })` / `with({ allowed })` **refuses loudly**, naming why. The resolver is an O(1) read of `ctx.flow.config.seatSkills`: no walking, no I/O. One collection ref per request, or the `ensureSeeded` memo misses. Empty array → no storage read |
| **Proof** | Different configs → different catalogs. Binding under a resolver throws |
| **Not this** | Seeding sites reading config directly. They're in `orchestration`, which must not learn what a seat is |

### The loader · `workforce`

| | |
|---|---|
| **Before** | `readSeatSkills` and `readWorkforceDirectory` exist. Neither calls the other |
| **After** | One entry point walks the tree once and returns records carrying their union. `WorkerManifest.skills`. No third walker |
| **Proof** | Two seats on two teams → disjoint sets. Colocated needs no list. Errors collect, not throw |

### Hire · `workforce`

| | |
|---|---|
| **Before** | The body becomes `instructions`. `persona:` in frontmatter is refused by name |
| **After** | The record's skills become `seatSkills`, the same way. `seatSkills:` in frontmatter refused by name at the loader **and** here, one constant. Not `skills`: the bag already has an author-written `skills` object. `HireOptions` gains nothing |
| **Proof** | Hand-built record works. `seatSkills:` refused at each door. Existing refusals unchanged |

**Two-PR seam here.** Everything above is the substrate and ships alone. Everything below is the kind.

### The kind · `agent-worker-flow.ts`

| | |
|---|---|
| **Before** | Static skills. Shared drawer. `dynamicActivation: true` unconditionally |
| **After** | Declares `seatSkills`. Passes a resolver to library and activator. `flowIsolation` on. A seat holds the **union** of the app-level `skills` option and its own; a duplicate bare name is refused at the mint naming both |
| **Proof** | Two seats, different skills, each reads only its own. Assert catalog **contents**, never keys. Goal check on a real model: `fsdev run` each seat |

### Activation · `agent-worker-flow.ts`

| | |
|---|---|
| **Before** | Slash + the activate tool, always on, catalog listing every turn |
| **After** | `skills.active` appended **after** the matcher's apply step, deduped (apply replaces the active set by design). `skills.activateTool` gates the tool and its listing, default off. Both activators slash-only. Empty catalog → no listing, no tool slot |
| **Proof** | Defaults render every turn. Slash adds without clobbering. Both off → no listing, no tool, no classifier call in the trace |

### The fence · delegation surface

| | |
|---|---|
| **Before** | The generator's `tools:` mapping is the only registration path. Library catalog registration off. Load tool contributes only itself. Delegation hands board workers catalog seats from a skill's `allowed-tools`, which was harmless while the catalog was the kind's |
| **After** | A seat's *own* skill can declare `agents:`. Board workers' catalog seats are capped to the seat's `tools:`. The fence is the seat's, not the skill's |
| **Proof** | `tools: []` + own skill with `agents:` → no app tool reachable |

### Refresh · `orchestration`

| | |
|---|---|
| **Before** | No refresh. `seedOne` writes the manifest and each *source* file; it never enumerates what's already there |
| **After** | One exported function. Touches only names whose manifest still exists. For each, replaces the folder whole: `list()` the prefix, `delete()` keys the source dropped, write. `ensureSeeded` stays additive. FIX-918 migration reseed untouched |
| **Proof** | Org edit → unchanged until refresh. Deleted copy survives. Withdrawn file gone and `prompt-ref` fails. Ordinary seeding deletes nothing |

### The contract · in the impl PR, not this branch

| | |
|---|---|
| **Before** | C5 and Known-gaps assign *reconciling* the two entry points to FIX-1362. "No mechanism yet" for refresh. Per-seat seeding listed as a gap |
| **After** | FIX-1362 pins the choice and draws the docs boundary; FIX-1390 owns deprecation. Refresh and seeding marked built. File is being renamed by FIX-1366: find it by content |

## Order

1. Collection → 2. `initialSkills` → 3. Loader → 4. Hire (needs 3) → 5. Kind (needs 1, 2, 4) → 6. Activation, 7. Fence, 8. Refresh (each needs 5) → 9. Contract + docs (needs 6, 8).

## Edge cases not covered above

| Case | Expected |
|---|---|
| No skills at any level | Hires. No storage read, no seeding, no context |
| `skills.active` names an unheld skill | Refused at the mint, by name, listing what it holds |
| Same bare name on two teams | Fine. Different seats, different keys |
| Collection seeded before this change | Read moves to a new key. Old rows orphaned. No migration. Say so in the PR |
| Slash emitted by the model | Not a match. `message` input only |

Everything that refuses: fatal, collected, one run names every bad worker.

## Docs

- `workforce/workers-on-disk.md`: a worker's skills, after settings, before channels. Say "keeps its own copy", not "isolation" or "seeding".
- `skills/activation.md`: two ways → three, one sentence. FIX-1366 owns the rest of the page.
- `packages/workforce/README.md`: the joined loader, the skills settings.
- One `minor` changeset for `workforce` + `orchestration`.

## Follow-ups

FIX-1390 filed · per-seat cost unmeasured · `scope` vs `flowIsolation` can contradict, flag on a third caller.
