# FIX-2459 · Orchestration and patterns surface: one home per name, an internal subpath, one claim order

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **autocompletes `@flow-state-dev/orchestration`** | 346 names: 222 also on `./tasks`, about 60 read only by our own packages (`filerResolver`, `payBoardDebts`) | Skills and Node-only seams. Task names on `./tasks` only; our plumbing behind `./internal` |
| **copies a docs import into a browser component** | A root import works in Node and can break their bundle: the root reaches `node:fs` | The name is only on `./tasks`, guarded browser-safe |
| **picks a claim order** | Three to choose from. The docs say two of them "behave identically" | Two that differ: `fifo`, the default, and `priority`. `"topological"` fails loudly and names `fifo` |
| **makes a task collection** | Four constructors, option rules varying by path | `defineTaskCollection` declares, `getOrCreateTaskCollection` opens; the backings are internal |
| **reads the orchestration or patterns README** | "Depends only on core" (client too). Patterns copies the `taskBoard` docs and mixes `./round-robin` with `./eventActors` | True dependencies; a link to the task-board docs; kebab-case subpaths; `patterns/benchmark` |

## The goal, and how we'll know it's met

**An app author who imports orchestration or patterns finds each name at one path, sees nothing
only our own packages use, and chooses between claim orders that actually differ.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's *Surface* and *One path* rows, for the two packages a Layer-2 adopter meets first ([FIX-2447](../../epics/FIX-2447/SPEC.md#the-goal-and-how-well-know-its-met)) |
| **Smaller, and rejected** | "Workforce's helpers move to `./internal`." Leaves 222 names on two paths and the copied root import that breaks a browser bundle |
| **Bigger, and not this issue's** | One method table under both backings (FIX-2462); one flow part instead of `*_ENTRY` bundles (FIX-2463) |
| **Not done if** | A name is exported from both the root and `./tasks` · a public export's only outside reader is another `@flow-state-dev/*` package · `fifoClaimOrder` and `topologicalClaimOrder` are both exported · workforce's installed tarball can't import `orchestration/internal` · an app, example or goal imports an `/internal` path · a README states a dependency the `package.json` contradicts |

```mermaid
flowchart LR
  W["workspace · export check · orchestration and patterns roots"] --> R["one-home test · root and ./tasks share no name"]
  K["packed tarballs · workforce installed"] --> L["leg b · imports orchestration/internal"]
  R --> M["manifest · Surface row · orchestration and patterns"]
  L --> M
  M -->|"no orphan · no shared name · internal resolves"| P["PASS · expect pass"]
  C["control · main at ebec5326"] -.-> R
  M -.->|"under the control"| F["FAIL · 222 shared names"]
```

The check reads the exports maps and the installed tarball, not the READMEs.

| How we verify | |
|---|---|
| **Goal check** | Flips the closure manifest's *Surface* assertions for orchestration and patterns to `expect: pass` (FIX-2564 names the ids). The implementer runs them on the PR head; the closure FIX-2562 reruns them on `main` |
| **Signal** | FIX-2448's export check passes for both packages with no allow-list entry; its census finds no app importing `/internal`. A one-home test beside `tasks-subpath-browser-safe.spec.ts` finds zero names on both root and `./tasks`, and that guard still passes. Leg b: workforce's installed tarball imports `orchestration/internal` |
| **Input** | Today's packages. A new export added to `./tasks` and re-exported from the root must turn the one-home test red |
| **Anti-game** | The census reads importers, never a list the diff writes; hiding a name an app imports fails it |
| **Control that must fail** | `main` at `ebec5326`: the one-home test fails on 222 shared names, and the export check fails on the first-party-only names on the root |

## What changes

![Orchestration's entries before and after. Before: the root carries all 222 task names plus skills plus our own packages' plumbing, and ./tasks carries the same 222. After: the root carries skills and Node-only seams, ./tasks carries the task substrate once, ./task-board and ./inbox stay, and behind a fence ./internal holds what only our packages read and ./inbox/check stays hidden for repo tests](figures/entries.svg)

Each name sits in one box. Below the fence (the epic's D2) is ours, published but outside semver.

**What an app author types:**

```diff
- import { defineTaskCollection, createSkillsLibrary } from "@flow-state-dev/orchestration";
+ import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
+ import { createSkillsLibrary } from "@flow-state-dev/orchestration";

- taskBoard({ collection, claimOrder: "topological" })
+ taskBoard({ collection })                      // fifo is the default; "topological" refuses, naming "fifo"

- import { eventActors } from "@flow-state-dev/patterns/eventActors";
+ import { eventActors } from "@flow-state-dev/patterns/event-actors";
- import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns";
+ import { defaultBenchmarkRegistry } from "@flow-state-dev/patterns/benchmark";
```

How each moved name reaches an adopter is ER-3, per Q1's answer; this spec doesn't pick it.

**Docs:** update both READMEs (dependencies, imports, claim orders, the filer-pass section out;
patterns links to the task-board docs), `orchestration/task-substrate.md`, `task-board.md`, the
pages and guides importing task names from the root, and `testing/benchmarks`. Add both rows to
FIX-2448's *what each package root is for* page. `mechanisms.yaml` drops `topological`. No new page.

## What stays as it is

- `./task-board`, `./inbox` (a feature entry, not a second browser barrel) and `./inbox/check`.
- `priorityClaimOrder`, the `ClaimOrder` interface, and what a claim does.
- The `*_ENTRY` constants and bundle factories: FIX-2463's, built on `./internal`.
- Patterns' behaviour and its other subpaths.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| Root `export * from "./tasks"` | **Removes.** Each task name keeps its `./tasks` home |
| `tasks-subpath-browser-safe.spec.ts`, guarding `./tasks` and `./inbox` | **Builds on.** The issue's import-graph test already exists; the one-home test sits beside it |
| `client/./internal`, published and read by our packages | **Reused** as `orchestration/internal`'s shape (epic [D2](../../epics/FIX-2447/DECISIONS.md#d2)) |
| `./inbox/check`, hidden by `publishConfig` | **Left alone.** D2's second kind |
| FIX-2448's export check and import census | **Builds on.** It decides each name's home; no second walker |
| Choosing which ready task to claim: the `task` mechanism's three claim orders | **Replaces** `topological`, which has `fifo`'s body. Searched `claimOrder`, `ClaimOrder`, `claim(` across `packages/`: no fourth way |
| Making a task collection: `defineTaskCollection`, `getOrCreateTaskCollection` and two backing constructors | **Narrows to two public.** Declaring and opening are different jobs; the backings (one harness-manager test reads them) go behind `./internal` |
| FIX-443 §4 (Linear): claim orders as named primitives | **Amended.** `topological` added nothing the substrate's admission rule (FIX-1005) didn't already do |
| FIX-909 (Linear): patterns imports task names from `./tasks` | **Kept**, and now the only way |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `@flow-state-dev/orchestration/internal` | `client/./internal`; `./inbox/check` | Same kind as the client's. `./inbox/check`'s kind would drop it from workforce's tarball |
| `@flow-state-dev/patterns/benchmark` | The patterns root; the epic's `testing/benchmark` | A named public subpath, documented by `testing/benchmarks`. It types against core's benchmark types wherever FIX-2460 puts them |
| A one-home test | The browser-safe guard; FIX-2448's export check | Beside the guard. The export check finds orphans, not one name on two entries |

| The debt | |
|---|---|
| **Removes** | 222 duplicate paths; about 60 first-party-only names from public view; unread, undocumented exports; `topologicalClaimOrder`; two public collection constructors; patterns' copy of the `taskBoard` docs; two false dependency claims |
| **Adds** | One `./internal` entry and one `patterns/benchmark` entry to keep. A `"topological"` refusal until its removal version (epic D3). With Q1's alias option, deprecated aliases for a minor |
| **Leaves** | The 38 collection methods written twice, and `delivery.passEntry`, a public option only workforce sets (both FIX-2462). The `*_ENTRY` bundles (FIX-2463) |

**Net: down.** Two packages' roots shrink to what an app author uses, and one duplicate
mechanism goes.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one path per name, no
first-party plumbing in view, claim orders that differ. If wrong: autocomplete still shows our
process, or we hold this for FIX-2462's rewrite.

**[The debt](#whats-already-here-and-the-debt), net down:** two entries added, 222 duplicate
paths and a duplicate claim order removed. If wrong: adopters pay a breaking move for names they
never used.

1. **[D1](DECISIONS.md#d1) · Each name has one home: task names on `./tasks` only, the root for
   skills and Node-only seams.** If wrong: Node apps write two import lines for nothing.
2. **[D2](DECISIONS.md#d2) · `./internal` holds what only our packages read, README entry or
   not.** If wrong: an adopter's own delegating board loses a semver-covered path.
3. **[D3](DECISIONS.md#d3) · One claim order, `fifo`; `"topological"` refuses.** If wrong: 15
   repo sites and some adopters change a string for no behaviour change.

**Open: none.** D2 is the one to weigh. Q1 (the epic's) decides how moved names reach adopters.

Improvement · `orchestration` + `patterns`, imports in `workforce` and `harness-manager` · medium · epic FIX-2447
