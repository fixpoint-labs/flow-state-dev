# FIX-2627 · Decisions

[Spec](SPEC.md) · **Decisions**

Two decisions are the sign-off. Which kits, their shape, the harness value, folders side by side
and "projects is not a default" are the owner's ([FIX-2618 O1](../../epics/FIX-2618/DECISIONS.md#o1));
this spec builds them as decided.

## The tree

```mermaid
flowchart TD
  I["FIX-2627"] --> D1["D1 · the coding worker flow is library<br/>the harness kit contributes it, policy as config"]
  D1 -.->|"rejected"| X1["a starter file each app owns<br/>one copy per app, and no folder to put it in"]
  I --> D2["D2 · goal checks install workforce as an app does<br/>in this issue"]
  D2 -.->|"rejected"| X2["goals call the old functions from workforce/internal<br/>they pass while the kit install breaks"]
```

Solid edges are what is signed. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The one coding worker flow is library: the harness kit contributes it, with its policy as config

| | |
|---|---|
| **Instead of** | A starter file the app owns and edits, `workforce/flows/workers/coder.mts`: [FIX-2583](https://linear.app/fixpoint-labs/issue/FIX-2583)'s "coding flow template (editable defaults)", and the shape Shift Manager's own coding flow already has |
| **Because** | One copy instead of one per app, which is the duplication this issue removes (three today). And there is nowhere to put a starter file: the harness kit has no folder, and a kit that requires another never puts files in that kit's folder ([O1](../../epics/FIX-2618/DECISIONS.md#o1) § Folders). FIX-2583's aim still holds: the pull-request rules leave harness-manager's mechanism and become this flow's options, which an app sets or turns off |
| **Locks in** | Review, pull-request wait and project checks are the harness kit's config. An app that wants a rule the config doesn't offer writes its own worker flow from harness-manager's exported blocks and switches the kit's `coder` off, as Shift Manager does. FIX-2583 lands its policy as options on this flow, not as a template |

It comes down to copies: a starter file is one per app, and drifts by design.

**What would change my mind:** apps routinely editing pull-request rules, so most hosts end up
with their own flow anyway. Then the flow becomes a starter file in the app's own folder (FIX-2628's
app kit is the first), and the kit ships only the blocks.

**What being wrong costs:** medium. An app that needs a rule we didn't offer writes about 200
lines from blocks that already exist; adding an option later is additive.

![D1: the coding worker flow is library, contributed by the harness kit with its policy as config, chosen, beside a starter file each app owns. Decides it: copies, one in the framework against one per app. Price: a rule the config lacks means writing a worker flow from the blocks. Locks in review, pull-request wait and checks as config. Flips if most apps edit pull-request rules](figures/d1-library-flow.svg)

<a name="d2"></a>
## D2 · Goal checks install workforce the way an app does, in this issue

| | |
|---|---|
| **Instead of** | Moving the goals' calls to `@flow-state-dev/workforce/internal`, the subpath that already exists for "goals and scripts", and converting them to kits later, as each goal is next touched |
| **Because** | A goal proves what a user gets ([philosophy](../../../docs/philosophy.md) tenet 7). On the internal path, 72 goal folders pass while the kit's install, its claim pass and its slot merge are broken, because none of them runs it. The conversion is mechanical: a goal's tree becomes `workforce({ directory })`, and a custom flow fills `workerFlows` |
| **Locks in** | 90 goal files ([callers](poc/claim-census/README.md)) change in this issue, in their own mechanical PR after the kits land, as FIX-2626 moved `flows` to an array. `hireWorkforce` and `createWorkerInstallation` are exported nowhere, `internal` included |

It comes down to what a passing goal proves: the kit install, or a path no app uses.

**What would change my mind:** you would rather FIX-2627 ship sooner and smaller. Then the goals
take the internal subpath now, and a follow-up issue converts them, filed before this merges.

**What being wrong costs:** low to medium. About a week of mechanical work in this issue; the
other way, a stretch where the goals don't cover the install every app uses.

![D2: goal checks install workforce the way an app does, in this issue, chosen, beside moving their calls to the internal subpath and converting later. Decides it: what a passing goal proves. Price: 90 files in 72 goal folders change here. Locks in the two calls exported nowhere. Flips if the owner wants this issue smaller](figures/d2-goals-as-apps.svg)

## Decided, not asked

- **The claim set** is workforce's published shapes (`test/published-tree-surface.test.ts`) plus
  the generated `workforce.gen.ts`. `flows/` holds only `flows/workers/`; a helper module beside
  it is the app's and moves out. `readWorkforceFolder` and the `fsdev gen` walk run the one claim.
  It is the convergence point for "used or refused": every reader is internal behind it.
- **The order that keeps three apps starting** (the census's 7 files). The PR that turns the
  claim pass on moves every file the census lists, in the same PR, and the census reads 0 on its
  head. It waits on FIX-2624's first PR, which deletes the lab's pins and dismissals flows.
  In that PR: claude-code-style's `projects.mts` moves to `labs/claude-code-style/flows/`, listed
  in `flows:`; `harness-thread.mts` is deleted and its workers name `coder`; anything of
  `pins`, `dismissals` or `user-marks` still there (FIX-2624 keeps a one-read fallback) moves
  with `projects.mts`. kitchen-sink's `workforce/hire.ts` goes with its move to `kits`. Shift
  Manager's fixture `flows/piece.mts` moves to the fixture's own folder.
- **claude-code-style's host moves onto `kits` here,** since its calls go internal and the claim
  pass reaches it. FIX-2628 owns its adapter and its app kit, and may move `projects.mts` into it.
- **Workforce's slots:** `workerFlows`, keyed, filled by builders that receive the installation
  (today's `workerFlow(…)`), so no flow closes over a variable filled later; `uses`, a list of
  capabilities added to the agent and coordinator flows workforce builds. The agent and
  coordinator flows' options are config. The `harness:` setting rides the coding flow's own
  settings, and usage readers ride the harness value, so neither needs a workforce slot.
- **A contribution sees its own kit's merged slots.** The coding flow needs every harness, so
  slots merge dependents first and `contributes` receives `{ config, slots }`. FIX-2626 sketches
  `contributes: ({ config })`; this is a requirement on it, raised in the cross-spec review.
- **The harness kit** is `harnesses` (the name `harnessManager` is the block's), from
  `@flow-state-dev/harness-manager/kit`, `requires: [workforce]`. Only that subpath imports
  workforce; there is no cycle (workforce never imports harness-manager).
- **The harness value** is the owner's `{ id, agent, readiness, pass, usage, models }` plus an
  optional `label` (a readiness row shows "Claude Code", as `HarnessReadinessSlot.label` does),
  defaulting to `id`. `codex` and `cursor` export one each; `claude-code` exports `claudeCode()`,
  a kit that installs its collections and fills the slot. A duplicate id is refused; the app can
  switch one off.
- **Readiness** is one view in harness-manager, read from the slot, installed by the kit. If
  FIX-2624's last PR wrote it first, this issue feeds it from the slot instead of a host map.
- **The coding board view** answers a task's harness from its worker's `harness:` setting until
  its run reports one: FIX-2626 D1's 42 kit-only lines. A package that depends on both serves the
  join, so no client runtime and no slot are needed. The task row gains no field (FIX-2152 ER-9).
- **The views each kit installs:** workforce, the roster (FIX-2623's), worker sessions and turns;
  harness-manager, readiness, the coding board and a run's work (FIX-2623 moves `changes`). These
  are the rows claude-code-style reads ([FIX-2628](https://linear.app/fixpoint-labs/issue/FIX-2628)'s
  list); FIX-2628 names their columns. No projects view (owner, O1).
- **The coding worker flow needs no workforce project.** It runs where the harness kit's
  `workspace` says, over whatever `source` the app gives it. `needsProject`, project checks and
  the project workspace capability are options, off unless set; claude-code-style sets none once
  FIX-2628 moves it to repositories.
- **Surfaces.** `./loader` exports `readWorkforceFolder` and its types only; the walk primitives
  come from FIX-2626's engine subpath; `RESOURCES_SLOT`, `CODE_SLOTS` and the rest become
  `*_FOLDER`, internal. Views on `./browser`; React hooks and components on `./react`, React an
  optional peer. `@flow-state-dev/react/workforce` goes with no alias (BP-034).
- **Starter files:** `init` scaffolds one team with one worker on the built-in agent flow,
  `TEAM.md` and `WORKER.md`, through FIX-2626's copy-in. No flow file ([D1](#d1)).
- **Projects:** no projects flow and no `checkRepository` in workforce's config (owner, O1).
- **The workers collection:** FIX-2624 declares `runBy: { flow }`; the kit installs it as is.
- **Names.** A new name for the registered code checkout says *repository* (owner, 2026-11-11,
  FIX-2592); `workspace` stays the host type's name. *Harness* gets a glossary entry. New
  public names: `workforce`, `harnesses`, `claudeCode`, `codexHarness`, `cursorHarness`,
  `readWorkforceFolder`, `Harness`; each enters FIX-2447's export ratchet.
- **Changesets:** `minor` for workforce, harness-manager, claude-code, codex, cursor and react.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A starter coding flow per app | [D1](#d1) |
| Goals on `workforce/internal` | [D2](#d2) |
| `coordinatorTools` and `boardFields` slots (the issue's list) | No contributor today; a slot nobody fills freezes an unchecked contract |
| `checkRepository` in workforce's config (the issue) | Projects is not a workforce default (owner, O1) |
| Codex and Cursor as kits | They install nothing; a plain value is what a third party implements (owner, O1) |
| A workforce slot for the task's harness | The coding board view serves it once harness-manager depends on workforce |
| Shift Manager on the shared flow | Its flow splits feature work from answers; that is its policy ([D1](#d1)) |
| Partial readers kept public | A reader of part of the folder can't claim the whole of it |

## Settled

- **7 files would stop their app or goal starting** (2026-11-11, `main` at `2a68dc263`,
  [`poc/claim-census/`](poc/claim-census/README.md), `node specs/issues/FIX-2627/poc/claim-census/census.mjs`).
  46 workforce folders, 235 files, each classified once; every `WORKER.md` sits in a walked
  folder. Unclaimed: kitchen-sink's `workforce/hire.ts`, claude-code-style's five
  `workforce/flows/*.mts`, Shift Manager's fixture `flows/piece.mts`. The control plants four
  strays in a copy of teammates' tree and fails unless each is reported, and nothing else.
- **122 files outside workforce call what goes** (same commit, `callers.mjs`): 90 in goals
  (72 goal folders), 21 in apps, labs and Shift Manager, 8 in other packages, 3 in scripts and
  docs. The control plants one caller per entry and fails unless each is counted once.

## Analysis

2026-11-11 · watermark 2026-11-11 · **Right approach.** Run by the author, not a fresh agent:
this dispatch has no sub-agent tool, as FIX-2626's wasn't.

1. **Reuse** — the kits **compose** `createWorkerInstallation`, `hireWorkforce`, `workerFlow(…)`
   and harness-manager's blocks; the coding flow **merges** two; the harness value **replaces**
   three shapes. Genuinely new: the coding board view.
2. **Prior art** — Backstage's extension points and Eclipse's schema per point, as in FIX-2626.
   Links from memory; no web search.
3. **Other shapes** — the starter-file flow ([D1](#d1)). A projects kit, deferred by the owner.
4. **New factors** — FIX-2583 (the template wording, D1); FIX-2628 drafting now (the seam on the
   host); FIX-2626 merged with `contributes({ config })` only (a requirement, above).
5. **Necessity** — the epic's goal needs both kits; `hireWorkforce` going internal is its line.
6. **Ergonomics** — one config object per kit. The app fill's spelling is FIX-2626's.
7. **Concerns** — D2's size; a harness value fixed by three harnesses.

## How it got here

- **Draft** — the epic's two kits on FIX-2626's `defineKit`, under the owner's harness shape. The
  census and the callers count ran first and set the order of the claim pass and D2's size.

**Open: none.**
