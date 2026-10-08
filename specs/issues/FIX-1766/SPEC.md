# FIX-1766 · A coding run's uncommitted work survives the loss of its machine

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **has a coding run on a repository project when its machine dies** | Loses every uncommitted edit and every commit the run made, and the next attempt starts from the base | The next attempt, on any machine, starts where the last finished turn left off: same commits, same edited, new and deleted files |
| **runs a Lab on more than one machine** | A retry on another machine finds nothing; the README says to keep one machine | Turns holding on for the host, once. Any machine with the store, the held-work store and the remote picks up a lost run |
| **runs on a disk that is kept: their own machine, or a sandbox that preserves its state** | Nothing is held, and nothing needs to be | The same. Holding is off unless the operator turns it on: nothing stored, no extra work at a turn's end |
| **owns a private project** | Its files sit in their own user scope ([FIX-1793 BR-33](../FIX-1793/BUSINESS-RULES.md#coding-runs)), and nothing else of the run is kept | The run's held work sits in the same place. Nobody else in the org can read it. Until FIX-1793 merges, nothing is held for it, even with holding on |
| **finds the held work does not match the run's record, or the run lands on a host with holding off** | n/a | Gets a question in their inbox naming what disagreed. The row waits for them; nothing is overwritten |
| **owns the customer's git host** | Nothing is written there by FSD | Still nothing. Held work stays in the held-work store until slice 4 pushes it |

## The goal, and how we'll know it's met

**On a host whose operator turned holding on, when the machine a coding run works on is lost,
the run's next attempt continues on another machine from its last finished turn, with the same
commits and the same uncommitted files, without the repository being copied or anything written
to the git host; a machine that dies while holding costs that turn and no more; and held work
that does not match the run's record, or that a host with holding off cannot use, waits for the
run's owner. With holding off, nothing is stored and a run with no held work behaves as today.**

| Is it the right goal? | |
|---|---|
| **The real need** | "A person whose coding run was interrupted gets the work back where it stopped, on any host, instead of a lost day." "At most one turn of work is lost to a crash." ([FIX-1766](https://linear.app/fixpoint-labs/issue/FIX-1766)) |
| **Smaller, and rejected** | "A lost run restarts from its base." Met by today's code with a cleared directory, and loses the day. Or "work survives a restart on the same machine." Met today by the disk, and keeps a Lab on one machine |
| **Bigger, and not this issue's** | The vendor's own conversation surviving the machine: a coding agent's session lives on the machine it ran on, so the next attempt there starts a fresh conversation, told what was restored · a sandbox snapshot for fast resume ([FIX-1767](https://linear.app/fixpoint-labs/issue/FIX-1767)) · pushing and dropping the held work ([FIX-1768](https://linear.app/fixpoint-labs/issue/FIX-1768)) |
| **Not done if** | The second machine shares a disk with the first · the check restores only new files, not edits, deletions or commits · a crash mid-hold sends the run to its owner instead of to the last good turn · a mismatch is restored anyway · a host with holding off restarts held work from the base · a private project's held work sits under the org · holding off stores anything |

```mermaid
flowchart LR
  A["DevTeam Lab · scripted harness · file remote · machines A and B · one store"] --> La["leg a · turn 1 commits, edits, adds, deletes · A dies in turn 2"]
  A --> Ld["leg d · A dies mid-hold at the end of turn 2"]
  A --> Lb["leg b · the held pack is changed"]
  A --> Lc["leg c · the same run in a private project"]
  A --> Le["leg e · holding off"]
  A --> Lf["leg f · B has holding off · A held turn 1"]
  La & Ld & Lb & Lc & Le & Lf --> P["PASS · goal met"]
  F["under its control · must FAIL"]
  La -.->|"no-checkpoint"| F
  Ld -.->|"record-first or delete-first"| F
  Lb -.->|"no-verify"| F
  Le -.->|"hold-always"| F
```

The check reads machine B's checkout, the remote's refs, the held-work store's keys by prefix,
the run record and the row's status. Each control switches off exactly what its leg depends on.

| How we verify | |
|---|---|
| **Goal check** | `goals/devforce-lab/it-keeps-a-runs-work-when-its-machine-is-lost/` · model `n/a` (scripted harness: the property is where files come from) · run by the implementer at completion · verdict in the last implementation PR |
| **Signal** | **a**: B's checkout HEAD is turn 1's commit; turn 1's edited, new, deleted, executable and symlinked files are as turn 1 left them, unstaged; turn 2's edit is absent; the remote's refs are byte-identical to before; the store holds one pack for the run and the record names its snapshot; `place.state` is `ready` and names B. **b**: the row is `parked`, `place.state` is `lost`, a question for its owner names `pack`, no harness ran, the stored pack is unchanged. **c**: the run's pack sits under the owner's user prefix and nothing under the org's. **d**: B has turn 1's work, as in a, with no question asked; turn 2's pack is still in the store, unread. **e**: the held-work store is empty, the record has no `place` or `held`, and B starts from the base, as on `main`. **f**: the row is `parked`, a question for its owner names `disabled`, no harness ran, nothing was cloned on B, and the stored pack is unchanged |
| **Input** | A `file://` bare repository the check makes with one marker commit; A and B are separate host roots, A's deleted before B starts; the held-work store is a folder outside both. A binary file, a nested path, a rename, an exec bit and a symlink must pass too. Leg d's crash: the Lab host kills A after turn 2's pack is written. Leg f's B is given no held-work store |
| **Anti-game** | No pack seeded by the check, except leg b's one change to the pack turn 1 wrote. No assertion on a host method's return. A and B never share a root |
| **Control that must fail** | `no-checkpoint`: leg a FAILS on *B has turn 1's work*. `no-verify`: leg b FAILS on *parked, nothing restored*. `record-first` (the record switched before the pack is written) and `delete-first` (turn 1's pack deleted before turn 2's is written): leg d FAILS on *B has turn 1's work, no question*. `hold-always` (the default flipped to on: a host given no store holds into the leg's folder anyway): leg e FAILS on *the store is empty*. Each is `GOAL_CONTROL=<name>`. Today's `main` FAILS leg a |

## What changes

![What changes: today a coding run's checkout lives only on machine A, so when A is lost the next attempt on B starts from the base; after, on a host with holding on, the end of each turn writes one git pack of the unpushed commits and a snapshot of the working tree to the held-work store, under the project's scope, and the run record switches to it last; B rebuilds the checkout from the remote's base plus that pack, after checking the rebuilt tree against the recorded snapshot](figures/what-changes.svg)

Left is today: the work exists only on A's disk. Right is after, with holding on: each finished
turn is one snapshot in the held-work store, and B rebuilds from the remote plus that snapshot.

**The Lab's operator, once, in its host**, to turn holding on (nothing else changes for them;
without the new line, nothing changes at all):

```diff
  workspace: localWorkspaceHost({
    root,
    remotes: { allow: ["github.com"] },
    source: projectWorkspace({ board: work }),   // now also names where the run's work is held
+   heldWork: fileHeldWorkStore({ dir: "/shared/held-work" }),
  }),
- // Limits: one host's storage. A retry on another machine finds nothing.
+ // Any host sharing the store and the held-work store picks up a lost run.
```

## How a lost run comes back

```mermaid
flowchart LR
  T["a turn ends · holding on"] --> H["one pack · snapshot and unpushed commits · new key"]
  H --> R["run record switches to it · last"]
  N["next attempt, any machine"] --> Q["its place is live here?"]
  Q -->|"yes"| U["use it, as today"]
  Q -->|"no"| B["clone the base · unpack · check out the snapshot"]
  B --> V["tree matches the record?"]
  V -->|"yes"| U
  V -->|"no"| K["park for the run's owner"]
```

The workspace layer snapshots and rebuilds; harness-manager calls it at the save points it
already has; Workforce says where the held work lives, by the project's visibility; the operator
decides whether any of it happens.

## What stays as it is

- **FIX-1762's locks.** One optional remote per project, a worktree mapped from it, project
  files beside the checkout, no auto-commit as the user, a live checkout never fetched or reset.
- **No-repository projects.** Their files collection is already their record; nothing added.
- **A local repository** the operator names on the host: no held work; it lives on that disk.
- **Any host without a held-work store**, which is every host by default: no change for a run
  with no held work.
- **Workforce workers, coordinators, mailboxes and boards.** Untouched; the parked question uses
  harness-manager's existing ask.

## Sign off

This set amends the spec Jake merged in [#2878](https://github.com/fixpoint-labs/flow-state-dev/pull/2878)
and [#2881](https://github.com/fixpoint-labs/flow-state-dev/pull/2881); the changes are in
[EVOLUTION.md](EVOLUTION.md#amendment-history).

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** where an operator turns it on,
a lost machine costs at most the turn in flight, on any other machine, with nothing copied but the
run's own changes and nothing pushed; where they don't, nothing changes. If wrong: we ship a hold
that survives a restart but not a lost machine, and a Lab still runs on one.

**This amendment** (Jake, "go", 2026-10-08, on jhoffner's [second look at #2881](https://github.com/fixpoint-labs/flow-state-dev/pull/2881#issuecomment-6068041468)); merging it confirms:

1. **The held-work store gets `delete` and `list`.** `put`, `get`, `delete` and `list`, all
   required. If wrong: FIX-1768 would break every adapter written before it.
2. **[A superseded pack is deleted after the record switches](DECISIONS.md#decided-not-asked)**,
   never before, and never one that parked. If wrong: every turn's pack stays until slice 4, on
   the operator's bill.
3. **[A host with holding off parks a run whose work is held](BUSINESS-RULES.md#holding-off)**
   for its owner, instead of restarting it from the base. If wrong: in a mixed fleet a run
   silently loses its held turns.

**Decided:** [D3](DECISIONS.md#d3), a blob store, at #2881's merge · [the shape](DECISIONS.md#decided-not-asked),
one git snapshot per hold switched to last · [holding off by default](DECISIONS.md#opt-in) ·
[Q1](DECISIONS.md#q1), one turn is one attempt · [D1](DECISIONS.md#d1), the project's scope ·
[D2](DECISIONS.md#d2), a mismatch parks for the run's owner. The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).

Feature · `workspace` + `harness-manager` + `workforce` + DevTeam Lab · large · 4 PRs · epic
[FIX-1763](https://linear.app/fixpoint-labs/issue/FIX-1763), slice 2 of 4 · after
[FIX-1793](../FIX-1793/SPEC.md)'s storage
