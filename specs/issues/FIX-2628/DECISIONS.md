# FIX-2628 · Decisions

[Spec](SPEC.md) · **Decisions**

One decision is the sign-off, and one question is open. Kits, their shape, which kits, views,
`runBy` and the adapter freeze are the epic's ([FIX-2618 O1, ER-1 to ER-8](../../epics/FIX-2618/DECISIONS.md#who-owns-what));
that the lab's "projects" are really repositories is the owner's (2026-11-11). This spec builds
both as decided.

## The tree

```mermaid
flowchart TD
  I["FIX-2628"] --> D1["D1 · a session works in a registered repository<br/>the lab stops using workforce projects"]
  D1 -.->|"rejected"| X1["a workforce project renamed repository<br/>the lab uses one field of it"]
  I --> Q1["Q1 · open · who moves the storage"]
  Q1 -->|"recommended"| R1["FIX-2628, at the adapter's delete"]
  Q1 -.->|"not recommended"| R2["FIX-2594 now, FIX-2592 amended"]
```

Solid edges are what you're signing or what I recommend. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A session works in a repository the workspace host registered; the lab stops using workforce projects

| | |
|---|---|
| **Instead of** | Keep a workforce project per repository as the storage, and say *repository* only on screen: [FIX-2592 ER-5](../../epics/FIX-2592/DECISIONS.md#who-owns-what) and FIX-2594's "the workforce Project row stays the storage" |
| **Because** | The owner's naming call, and the code agrees with it. The lab uses one field of a project, its repository: all 9 project identifiers it imports serve "find the repository a run works in" ([POC](poc/lab-inventory/README.md)); no lab screen shows members, project files, MCP servers, workstreams or checks (FIX-2592 keeps them out). [O1](../../epics/FIX-2618/DECISIONS.md#o1): projects is not a workforce default, and harness-manager takes a workspace source a later projects kit could fill. [FIX-2593](../../epics/FIX-2592/DECISIONS.md#who-owns-what) ER-1: the host keeps the one list, and a project only points |
| **Locks in** | Anyone who can use the lab can start a session on any registered repository: admission is the operator's act at the host ([FIX-2592 ER-4](../../epics/FIX-2592/DECISIONS.md#who-owns-what)), not a project's membership. The app supplies the run source, through the harness kit's `workspace`. The lab runs no project checks. `reads-project-files` leg 2 becomes "a session with no repository is refused", not "a non-member is refused". *Repository* is the lab's word in code too, so FIX-2592 ER-5's carve-out ends |

![D1: a registered repository, chosen, beside a workforce project renamed. Decides it: the lab uses one thing from a project, its repository. Price: per-project membership goes](figures/d1-repository.svg)

It comes down to what the lab uses: one field of a project, so the rest is weight it never shows.

**What would change my mind:** one lab served to several people who must not share
repositories. Then membership is needed, and it belongs in a projects kit (O1's later
candidate), not back in workforce's defaults.

<a name="q1"></a>
## Q1 · Open · Which issue moves the lab's storage off workforce projects?

**In plain terms.** FIX-2594, in a sibling epic, puts *repository* on the lab's screens and
builds Settings. It is approved, waits only on FIX-2593, and will ship well before this issue,
which waits on all of stage 2. As approved, FIX-2594 still saves each repository a person adds
as a workforce project. Either FIX-2594 is changed to save no project, or it ships as approved
and this issue moves the storage when it deletes the adapter.

**The options.** *FIX-2628, later (recommended):* FIX-2594 ships unchanged. Each repository added
before this issue lands also leaves a workforce project row; this issue reads those once, so a
session keeps its repository, and the read goes with the adapter. *FIX-2594, now:* FIX-2592's
spec is amended and re-approved, FIX-2594 also changes the run source in `host.mts`, and no
project row is ever made.

**The trade-off.** Later costs a few orphan rows in each operator's local lab database and one
read we delete. Now costs a sibling epic's approval round and a larger FIX-2594, for a screen
that looks the same.

**My recommendation:** FIX-2628, later. The person sees the same thing at the same time, and
the move lands with the code it deletes.

**What would change my mind:** FIX-2594 not started when FIX-2627 merges. Then no rows exist
yet, and the move is this issue's with nothing to read.

**If wrong:** some orphan project rows in local lab databases. Cheap, and reversible.

![Q1: FIX-2628 at the adapter's delete, recommended, beside FIX-2594 now with FIX-2592 amended. Decides it: a sibling epic's approval. Price: a project row per repository added before FIX-2628](figures/open-storage-move.svg)

It comes down to the sibling's approval: the screens are the same, so reopening it buys nothing visible.

## Decided, not asked

- **The session's repository is written by the server when the session opens** ([amended
  2026-11-15](#how-it-got-here): a workforce session field, carried down each hand-over), and
  is read-only after. *Superseded in part, [2026-11-15](#how-it-got-here):* it need not be in the
  host's list; an unlisted one must pass the host's `checkRepository`. A task session finds it through its
  filer (`filingSessionId`, set by the board's hand-over). Never from a task's input, the
  request body or a header (BP-031). The **convergence point** is the app's run source: every
  coding run and every source read asks it, and it refuses a repository the host no longer
  lists, with the host's reason. The field's carrier is FIX-2627's `sessionFields` option on
  workforce.
- ~~**Old sessions keep their repository**~~ *Superseded [2026-11-15](#how-it-got-here): no read-once, under the standing no-legacy decision.* A session opened on a project before this lands is
  read once: its project's repository, if the host lists it (BP-030). Otherwise it shows no
  repository and asks. The read goes when the adapter's last caller does.
- **Pins and dismissals move into the app kit, as they are.** FIX-2624 made them user
  resources (`labPins`, `labDismissals` in `user-marks.mts`) that the screen reads and writes with
  no session, and deleted the old pins and dismissals flows. Today the projects flow declares
  them, so the declarations move to the app kit when that flow goes. Nothing reads the old
  user-state marks: FIX-2624 copies none over, by owner direction
  ([FIX-2624](../FIX-2624/DECISIONS.md#how-it-got-here), amended 2026-11-11).
- **No "no repository" refusal at filing.** Today the board refuses a coding task in a session
  with no project before it files it. Every session now opens on a repository (FIX-2592 ER-6),
  so the run source's refusal at run start is the one check, and the row shows it.
- **The tests leave the fake.** `test/fake-lab.ts` and the `LabAdapter` seam go
  ([FIX-2152 D4](../../epics/FIX-2152/DECISIONS.md#d4), superseded here as the epic says). Screen
  tests run on the in-process host, as `test/contract/contract.test.ts` does today.
- **Where the lab's files go.** The app kit is one folder of the lab, a sibling of `workforce/`
  ([O1](../../epics/FIX-2618/DECISIONS.md#o1) § Folders). Its flows count as FIX-2152 ER-1's
  small flows; the inventory script classifies by that path.
- **The 42 kit-only lines.** Confirmed, not re-argued ([Settled](#settled)). They arrive as
  the coding board view's harness field; the lab writes none of them.
- **Measure, then report.** The implementation PR's description carries the inventory's
  before and after (adapter, host, flows, kit), replacing the epic's estimates.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Rename only: workforce projects behind the word *repository* | D1 |
| A repositories kit now | O1 lists it as a later candidate; one app needs it today |
| The app's projects flow in `flows:`, as the epic's host example has it | The app kit already holds the app's flows; the flow becomes repositories |
| Keep `projectSourceCapability` under its name | It names a project to the model and installs project resources. The lab takes FIX-2627's `sourceReadCapability`, its tool body with no project |
| Keep the fake lab beside the in-process host | Two ways to test one screen; the contract test already runs the real host |

## Open

- **Q1**, above.

## Settled

- **The kit-only premise holds on today's `main`** (2026-11-11, `aea65f7ba`;
  [`poc/lab-inventory/`](poc/lab-inventory/README.md), `node specs/issues/FIX-2628/poc/lab-inventory/check.mjs`).
  The adapter is byte-equal to `f0b34c529`, FIX-2626's table still totals 42 kit-only lines, and
  neither harness-manager nor workforce depends on the other. The premise held; nothing moved.
- **What "off workforce's project concept" covers** (same run). 9 imported identifiers, 54 token
  uses in lab code, one flow file. `POC_EXPECT=gone` fails on `main` and is the implementation's
  bar. The controls go red: an unknown import, a namespace import, a dynamic import, a stray file
  in `workforce/flows/` and a stale row each stop the check.

## Analysis

2026-11-11 · watermark 2026-11-11 (FIX-2626's) · **Right approach.** Run by the author, not a
fresh agent: this dispatch has no sub-agent tool. One finding folded: the storage move became Q1.

1. **Reuse.** The app kit and source are **composed** of `defineKit` and `RunSource`; the hooks
   are wrappers; the inventory **reuses** the POC. Nothing genuinely new in a package.
2. **Prior art.** The epic's (Backstage, Django apps). Conductor, which FIX-2592 cites, lists
   repositories as the app's own list, with no project above them: the shape D1 takes.
3. **Other shapes.** Rename only (D1's *Instead of*); a repositories kit now (dropped).
4. **New factors.** FIX-2626's alignment (#5078, draft) puts `projects.mts` in `flows:` and names
   FIX-2628 for the later move; this spec agrees on the order. The owner's naming call, 2026-11-11.
5. **Necessity.** The epic's leg a has no other owner.
6. **Ergonomics.** A lab author writes a run source; the epic's examples hid that.
7. **Concerns.** FIX-2627's five seams are the risk. If FIX-2627 bakes a workforce project into
   the coding worker flow, D1 needs a package change it doesn't own. Folded: the storage timing
   is a sibling's scope, so it went to the owner as Q1.

## How it got here

- **Draft** — leg a of the epic, on FIX-2626's `defineKit` and FIX-2627's kits, with the owner's
  naming call made a decision: the lab's working place is the workspace host's repository, not a
  workforce project (D1). FIX-2626's 42 kit-only lines are confirmed on today's `main`.
- **Amended 2026-11-11, from FIX-2624's implementation (#5111)** — pins and dismissals are user
  resources declared on the projects flow, with no legacy copy, so `user-marks.mts` moves into
  the app kit rather than going, and nothing here removes a fallback.
- **Amended 2026-11-15, from the implementation (owner decision, Fork A)** — the repository
  binding is a workforce session field (`sessionFields`), not a lab-owned record. Workforce writes
  it once, when a user's conversation opens (`setSessionFields`, server-side; a create that seeds
  it is refused), and each hand-over carries it down beside `filingProjectId`, so a task's
  session holds its filer's repository and the run source reads the run's own session, not its
  filer's. To carry it, `sessionFields` moved from the agent and coordinator flows to the worker
  installation ([FIX-2627, amended the same day](../FIX-2627/DECISIONS.md#how-it-got-here)). Q1
  is settled by the order the work took: the lab's sessions bind to a repository here, while the
  picker still lists workforce projects until FIX-2594's dialog lands; the open writes the picked
  project's repository on the session, and the run never reads the project. The lab runs no
  project checks; its checks are the host's (`CLAUDE_CODE_STYLE_CHECKS`, as Teammates' are), and
  `projectSourceCapability` stays until its words leave with the adapter.
  The read-once of a session opened on a project before this landed is not built: such a session
  has no repository, and its runs are refused `no-repository` (raised with the owner under BP-030).
- **Amended 2026-11-15, owner decisions after the first two implementation PRs:**
  - **Fork B: the adapter waits for FIX-2725.** Measured on the lab after the repository move,
    about 1,100 of `src/adapter.ts`'s 1,622 lines feed the three views FIX-2725 defers (worker
    sessions ~220, session turns ~500, the coding board ~350, their row types ~150), not the ~140
    the fork was asked on. Deleting now would move most of the file and keep `test/fake-lab.ts`,
    so it would miss this spec's own "no adapter, no fake" bar. The deletion, the move onto the
    app kit's hooks and the inventory test land after FIX-2725 ships its views; FIX-2628 is
    blocked by FIX-2725 until then.
  - **Unregistered repositories stay open.** A session may bind a `file://` repository the host
    doesn't list, as the picker allows today: the run source clones it, after the host's
    `checkRepository` (the check a project's create asks) finds it usable, and refuses it
    `repository-unusable` otherwise. A listed repository runs in a worktree without the check.
    This replaces the line above that a session opens "from a repository in the host's list"
    and that the run source refuses one "the host no longer lists": only an unusable repository
    is refused.
  - **No read-once for old sessions**, under the standing no-legacy decision. The "Old sessions
    keep their repository" line above is superseded: a session opened on a project before this
    landed has no repository, and its runs are refused `no-repository`.
