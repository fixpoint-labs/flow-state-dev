# FIX-2449 · Curate engine's root and remove same-name collisions and scaffolding exports across foundation roots

**Spec** · [Decisions](DECISIONS.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **autocompletes `@flow-state-dev/engine` in an app** | 383 names: lease planners, `BoundedQueue`, 26 of core's and contracts' names again. Apps, examples, labs and docs show 37 | Only what an app needs, each in the README |
| **writes a host or store adapter** | Hunts the same 383 names. Some carry an `unstable_` prefix | Imports `engine/host`: documented, semver-covered |
| **imports `DispatchHandle` from core and from engine** | Two different types, one name | Engine's is `InboundDispatchHandle` |
| **calls `isRetryableError`** | Core's takes an error; engine's also a policy | Engine's leaves the root; if a reader keeps it, it is `isRetryableUnder` |
| **autocompletes `react`, `client` or `testing`** | `reactPackageMarker`, `coreItemImportProof`, two more markers, client's unread `ExecuteActionRequestBody` | Gone; the proof is a type test |
| **adds an export whose name another published package uses** | Nothing notices; 22 exist | The export check fails, naming both |

Engine's root has five `export *` lines, so whatever a sub-barrel exports lands on it unreviewed.

## The goal, and how we'll know it's met

**An app author who imports `@flow-state-dev/engine` or `@flow-state-dev/client` sees only what
an app needs; an adapter author finds their contracts on `engine/host`; across every published
root and the foundation's subpaths one name means one thing; and no package root ships scaffolding.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's *Surface* row for engine and client, and its collisions ([FIX-2447](../../epics/FIX-2447/SPEC.md#the-goal-and-how-well-know-its-met)) |
| **Smaller, and rejected** | "Replace `export *` with an explicit list." Met by listing today's 383 names (367 when the issue was filed). And "fix the three named collisions": the census finds 22 |
| **Bigger, and not this issue's** | Core's root ([FIX-2448](https://linear.app/fixpoint-labs/issue/FIX-2448)), React's hook names (FIX-2450, 2455, 2456), the store factory family (FIX-2452). The other side of ten collisions: the harnesses' eight (FIX-2458), the stores' `initializeSchema` (FIX-2452), orchestration's `camelToKebab` (FIX-2459) |
| **Not done if** | An engine or client root name has no outside consumer: no adopter import and no README or docs entry · engine's root re-exports a name declared in another package · an adapter-only contract is missing from `engine/host` and a first-party adapter still imports it from the root · two entries in the check's scope export one name for different declarations, once every contributor has landed · a marker or the import proof survives under any name |

```mermaid
flowchart LR
  S["every published root · the foundation's public subpaths · read from source"] --> I["FIX-2448's census module · per-entry index"]
  I --> X["the export check · outside consumer · one collision assertion"]
  X --> M["closure manifest · engine and client roots · collisions · markers"]
  M -->|"roots all consumed · zero collisions · no marker"| P["PASS · goal met"]
  C["control · main at d6a38c09 · a name planted on two roots"] -.-> X
  X -.->|"under the control"| F["must FAIL · 22 collisions · 215 orphans"]
```

The check reads every published root from source, so no installed-tarball copy is needed.

| How we verify | |
|---|---|
| **Goal check** | No `goals/` directory: the surface is the outcome. FIX-2448's export check, extended here with one collision assertion, gates every PR. It reads FIX-2448's one census module and its per-entry index of `packageExports`; this issue adds no walker. Until they exist, `node specs/issues/FIX-2449/poc/root-census/census.mjs --all --public` and `consumers.mjs` are the same assertions. In FIX-2564's manifest this issue flips client's root cell and the marker assertion. It contributes to engine's root cell with FIX-2452, and to `surface.collisions`, the one strict collisions cell, with FIX-2458, FIX-2452 and FIX-2459. The last contributor to land flips each, naming all |
| **Signal** | Every engine and client root name has an outside consumer (ER-1): an import in adopter code (`apps/` but not `apps/devtool`, `examples/`, `labs/`) or a README or docs-site entry. A sibling package's import or `goals/` doesn't count, so a name only adapters or our packages import is on `engine/host` or `engine/internal`. Zero engine root names declared in another package. Zero names exported from different declaring files by two entries in scope. On a PR the collision assertion admits no collision the merge base lacks; the cell expects zero. The seven marker and proof names, and the smoke file, exported from no entry |
| **Input** | Every published package's root, plus every public entry of `contracts`, `core`, `engine`, `client`, `react` and `testing`; not `/internal` or repo-test entries. Prototype: [`poc/root-census/`](poc/root-census/README.md) |
| **Anti-game** | Adapter imports never count toward the root, so leaning on first-party adapters can't keep a name there. A README line added for a name no adopter meets is a scope change the reviewer rejects. `CollectionItemHandle`'s client README line is not one: React's collection hooks return it, so apps meet it in signatures the census can't follow across a package edge. A renamed marker has no outside consumer, so ER-1 fails it. Collisions compare declaring files, so a type alias is caught; `/internal` is excluded, so moving a colliding name there must be justified by D1's reader rule |
| **Control that must fail** | `main` at `d6a38c09`: 22 collisions in scope, twelve of them this issue's; 215 engine root names with no outside consumer; client's root fails on 3. `--plant` puts one name on two roots: the count must rise to 23 |

## What changes

![Before: one engine root of 383 names from five export-star lines. After: the root for app authors, engine/host for adapter authors, engine/internal for our packages, and 215 names no longer exported](figures/what-changes.svg)

Read the bands by who imports: an app, an adapter, or our packages. The red strip is what nobody outside engine uses.

**An adapter, as its author writes it:**

```diff
- import { createInboundTransportHost, type DispatchHandle, type StreamEvent,
-   unstable_listExposedResources, createFlowState } from "@flow-state-dev/engine";
+ import { createFlowState } from "@flow-state-dev/engine";
+ import { createInboundTransportHost, type InboundDispatchHandle,
+   type StreamBridgeEvent } from "@flow-state-dev/engine/host";
+ import { listExposedResources } from "@flow-state-dev/engine/internal"; // our packages only
```

`engine/host`'s reader set also holds FIX-2452's twenty store names (the two registry factories
and 18 per-store constructors): this PR creates the subpath, and FIX-2452's PR moves them onto it.
The PR that creates `engine/internal` ships the completions fix if one exists; if none does, the
epic's closure spot-check stands as a recorded finding.

**Client's root** fails on three names: `clientPackageMarker` is deleted, `ExecuteActionRequestBody`
has no reader and is unexported, and `CollectionItemHandle` stays, documented in client's README.

**Renamed and re-homed** ([D2](DECISIONS.md#d2)), reaching 0.4.0 adopters per ER-3 and Q1's answer:

| Name today | After |
|---|---|
| engine `DispatchHandle` | `InboundDispatchHandle`, on `engine/host` |
| engine `FlowDispatchHandle` | `RunnerHandle`, on `engine/host`, beside `FlowRunner` |
| engine `isRetryableError` | `isRetryableUnder`, if it stays exported; no reader imports it today |
| engine `StreamEvent` (the bridge frame) | `StreamBridgeEvent`, on `engine/host` |
| core `SessionView` | `PeerSessionView`; React's keeps the name |
| core/models `RetryPolicy` | `ModelRetryPolicy`; the block's keeps the name |
| `ExpectedVersion`, `FlowCardinality`, `ChildSessionStatus`, `ChildSessionSummary`, `FlowApiRouter` | One declaration each, re-exported. The child-session pair has no engine reader, so engine stops exporting it and client's copy moves to contracts. Vercel re-exports engine's `FlowApiRouter` from `engine/host` |
| react `RosterWorker` | Unexported: no reader. Workforce's keeps the name |
| `executeBlock` on `core/blocks/sequencer` | Gone there: the subpath carries the builder |

**Docs:** every page and README that imports a moved name, which `consumers.mjs` lists (about 32
pages and the adapters' READMEs). Specifically: edit engine's row (the root, `engine/host`,
`engine/internal`) and client's row (the root, `client/internal`) on *what each package root is
for*, the page FIX-2448 creates with every root's row; split `packages/engine/README.md`'s
*Public API* into the root and `engine/host`; add `CollectionItemHandle` to client's README; update
the import lines in `server/host-adapters.md`, `advanced/inbound-transports.md`,
`persistence/overview.md` and `api/server.md`, `server/webhooks.md`, `server/authentication.md`,
`advanced/durable-execution.md`. No new page.

## What stays as it is

- Engine's other subpaths, and every name's behaviour: this changes no runtime code.
- Core's root is FIX-2448's; this edits core only for the collisions above.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| What already decides a root's surface: `exports` maps, barrels, the `unstable_` prefix. No `mechanisms.yaml` row (searched *export*, *surface*, *root*) | **Replaces** `export *` and the prefix with three entries |
| FIX-2448's export check, its census module (FIX-2162's caller census, promoted) and its per-entry index of `packageExports` | **Extends** the check with one collision assertion (ER-1, ER-4); **reads** the module and index |
| Leg b's installed-name collision check (FIX-2564) | **Replaces**: leg b drops its copy, since source shows every collision |
| `client/./internal`, published and read by our packages | **Reused**: `engine/internal` is that kind ([epic D2](../../epics/FIX-2447/DECISIONS.md#d2)) |
| [FIX-2162](../FIX-2162/SPEC.md#whats-already-here-and-the-debt): `createInProcessFetch` on engine's root | **Kept** |
| [FIX-2428](../FIX-2428/SPEC.md)'s push delivery, [FIX-1551](../FIX-1551/SPEC.md)'s in-process pin | **Kept**; both move to `engine/host` |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `engine/host` | The root; `engine/testing` | The root is the app author's; a public entry beside `engine/testing` |
| `engine/internal` | The `unstable_` prefix; `engine/host` | A prefix still autocompletes; `host` puts our seams under semver ([D1](DECISIONS.md#d1)) |
| A collision assertion | FIX-2448's export check and per-entry index; leg b's copy | One assertion in that check, over the index it already reads; leg b's copy goes |

| The debt | |
|---|---|
| **Removes** | Five `export *` lines; 215 root exports with no outside consumer; 26 re-exported core and contracts names, `unstable_isCollectionConfig` included; the `unstable_` prefix; twelve collisions; four package markers and react's import proof; client's unread request body and its copy of the child-session wire types; leg b's collision copy |
| **Adds** | Two engine entries to keep; one assertion; six renames. Under Q1's alias answer, deprecated aliases until the removal minor |
| **Leaves** | The other side of ten collisions (FIX-2458, FIX-2452, FIX-2459); five subpath collisions outside the six packages (patterns, workforce), held by ER-1's ratchet; core's root (FIX-2448); store factory names (FIX-2452) |

**Net: down.** 383 names on one root become three entries by reader; twelve collisions become none.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met):** engine's and client's roots for apps,
`engine/host` for adapters, one meaning per name across every published root, no scaffolding. If
wrong: we curate one root and adopters still meet two `DispatchHandle`s.

**[The debt](#whats-already-here-and-the-debt):** net down, two entries and six renames added.
If wrong: adapter authors pay a breaking move for a split they didn't need.

1. [D1](DECISIONS.md#d1) · Three engine entries, by who imports: root, `engine/host`,
   `engine/internal`. If wrong: our seams carry a semver promise, or adapter authors lose one.
2. [D2](DECISIONS.md#d2) · One strict collision assertion over every published root and the
   foundation's public subpaths; the side off the app author's path renames. If wrong: renames
   adopters didn't need.

**Open: none.** Q1 is the epic's; this spec reads either answer.

Improvement · engine, client, core, contracts, react, testing, vercel, and the first-party adapters' imports · M · epic [FIX-2447](../../epics/FIX-2447/SPEC.md)
