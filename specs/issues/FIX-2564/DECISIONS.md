# FIX-2564 · Decisions

[Spec](SPEC.md) · **Decisions**

What was chosen, what lost, and what each locks in for the children who flip cells. Three
decisions are the sign-off.

## The tree

```mermaid
flowchart TD
  I["FIX-2564"] --> D1["D1 · expectations on assertions · rows derived"]
  D1 -.->|"rejected · a row has up to eight owners"| X1["one expectation per row"]
  I --> D2["D2 · ratchet rows read the strict run · legs hold the rest"]
  D2 -.->|"rejected · a second definition of one rule"| X2["re-check every row on tarballs"]
  I --> D3["D3 · its own workflow · main pushes and dispatch"]
  D3 -.->|"rejected · an expected fail would block PRs"| X3["a step in the gating packed-install job"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Each assertion carries its own expectation, and a row's outcome is derived from its assertions

| | |
|---|---|
| **Instead of** | One `expect` per row, as the brief words it ("each child flips its rows") |
| **Because** | *Surface* alone spans eight children across the package roots, and *One path* and *Types* two each. With one expectation per row, a row stays failed until its last owner lands, so the others finish with nothing to flip and nothing on `main` shows their work. Per assertion, each child flips the cell it owns the day it lands |
| **Locks in** | The manifest's unit is the assertion id, and each id has exactly one owning child, named in this spec. The lead measure still counts rows: a row passes only when every cell under it does. The epic's wording "flip its rows" reads as "flip its cells" |

![D1: expectations on assertions, chosen, beside one expectation per row. Decides it: a row with many owners. Price: more ids to keep. Flips if every row had one owner](figures/d1-per-assertion.svg)

It comes down to Surface's eight owners: per-row, seven of them can't show their work land.

**What would change my mind:** each row turning out to have a single owner once the specs settle.
Then per-row is the same thing with fewer ids.

<a name="d2"></a>
## D2 · Surface and Leakage read the ratchets' strict runs; the legs hold only what the tree can't show

| | |
|---|---|
| **Instead of** | Re-checking every row on the tarballs: a root-export census and a tracker-id scan of the installed `.d.ts` |
| **Because** | The epic consolidates verification: one place per row, and leg b holds only what the workspace ratchets can't see ([ER-9](../../epics/FIX-2447/DECISIONS.md#who-owns-what)). The export check already defines *outside consumer* over the workspace and its apps; a tarball census would define it a second time and could disagree. So a ratchet cell runs that check with its baseline or allow-list set aside, and passes when it finds nothing for its package |
| **Locks in** | Until FIX-2448's export check and FIX-2453's lint exist, their cells report `pending`, which counts as `fail`. Each owner exposes a strict run that names violations by package, and runs the control when it lands, so the cell is seen to fail before it can pass. Under the control, the ratchet code on `main` reads a checkout of `ebec5326` |

![D2: ratchet rows read the strict run, chosen, beside re-checking every row on tarballs. Decides it: one definition of each rule. Price: two cells pending until their checks land. Flips if the ratchet and the tarball could disagree on what ships](figures/d2-ratchet-rows.svg)

It comes down to one rule, one definition: a tarball census would redefine *outside consumer*.

<a name="d3"></a>
## D3 · Its own workflow, run on every push to `main` and by manual dispatch on any branch

| | |
|---|---|
| **Instead of** | A step in the gating `packed-install` job, whose comment asks for new checks to go in its `CHECKS` list |
| **Because** | Every row starts as an expected fail, and the epic keeps the legs off child PRs. A step in that job would run on every PR, and a red mismatch would block it. A separate workflow runs the same script after merge, and a child dispatches it on its own branch to show its cell pass before it flips the line. The script stays the one place; only the job is separate, which is what that comment protects |
| **Locks in** | A second install of every tarball on each `main` push, a few minutes of CI. A child's goal verdict links a dispatched run. The workflow and the manifest are scaffolding: the closure folds the passing legs into `CHECKS`, where they gate every PR, and deletes both |

![D3: its own workflow, chosen, beside a step in the gating packed-install job. Decides it: whether an expected fail can block a PR. Price: a second install per main push. Flips if the rows were all expected to pass](figures/d3-own-workflow.svg)

It comes down to the gate: inside the PR job, an expected fail blocks unrelated PRs.

## Decided, not asked

- **The judge is the convergence point.** Every assertion reports `pass`, `fail`, `pending` (its
  check doesn't exist yet) or `error` (it could not run). The job is red when an outcome differs
  from its expectation in either direction, `pending` counting as `fail`, and on any `error`.
- **Admission.** An assertion joins the manifest only if it fails under the control. A rule 0.4.0
  already met can't show progress. That cut a check on `@deprecated` names: both of 0.4.0's
  (`resumedBy`, `dynamic`) were in 0.3.0. *Shims* rests on the three shapes 0.4.0 dual-reads
  (`queued`, `suspendedWait`, `questions`), which no published version wrote.
- **Under the control, every row fails.** Probed on the published tarballs: core 0.4.0 carries 272
  tracker ids in its `.d.ts` and orchestration 0.5.0 ships `retired-shapes`. FIX-2457's premise is
  unproven; if `types.typed-handler` compiles under the control, it is not admitted and FIX-2457
  learns its premise was wrong.
- **The flags.** `run.mjs --goal` and `run.mjs --control=adopter-goal`. Plain `--control` stays the
  0.1.1 control. The epic's `run.mjs --control` means the second.
- **The control set** is every published package at the version npm served on the day of
  `ebec5326` (core, engine, client, react and fsdev 0.4.0; orchestration 0.5.0), pinned by integrity
  in the manifest, as `CONTROL` pins 0.1.1.
- **Leg a's selection rule is the leg's, never the doc's.** Every titled block is written as its
  file, every shell block runs in order, the install lines map each `@flow-state-dev/*` name to its
  tarball, and `pnpm dev` is skipped. The only thing the leg adds is model access: a placeholder key
  and a local stub endpoint, set through the environment. No marker in the doc steers the leg.
- **A moved import path is the one assertion edit a child may make.** If a child moves a name a
  fixture imports, its PR updates that path in the same diff and says so (BP-034). What a fixture
  asserts never changes outside this issue.
- **Ids carry no tracker ids** (BP-006); ownership lives in this spec's table.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Fold the legs into `goals/` with a `GOAL_CONTROL` | Goals run by hand on the workspace. The lead measure needs CI, on tarballs |
| Run the goal mode on child PRs, non-required | The epic keeps it off child PRs; dispatch covers a child that wants proof first |

## Analysis

Skipped in spec-set member mode: `epic-agent` runs `analysis` and `reuse-review` over the whole set.

## How it got here

- **Draft (Nov 5).** Spec-set member of epic FIX-2447. Moved the expectation to the assertion,
  read the ratchet rows from their strict runs, and gave the goal mode its own workflow.

**Open: none.**
