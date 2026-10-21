# FIX-2081 · Decisions

[Spec](SPEC.md) · **Decisions**

The owner decided the tools, the field rule and delegates as authority in the concept
([rules 3, 13, 20](../../../docs/internal/design/workforce-coordination-concept.md#the-rules)).
These two carry it out where the concept and the epic's order meet the code.

## The tree

```mermaid
flowchart TD
  I["FIX-2081"] --> D1["D1 · dispatchTask stays until its wait and its post form are replaced"]
  D1 -.->|"rejected"| X1["remove it here · routing and waiting break until FIX-2082 and FIX-2083"]
  I --> D2["D2 · delegates all follows the roster as it changes"]
  D2 -.->|"rejected"| X2["a copy of the roster taken at the first read"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · `dispatchTask` stays until its wait and its post form are replaced

| | |
|---|---|
| **Instead of** | Removing it here, as the epic's [migration lines](../../epics/FIX-2056/migration.md) assign it |
| **Because** | It does two jobs nothing else does yet: its `wait` is how a request waits on a task (`getTask`'s wait is FIX-2082's), and `post: true` is how a judgment coordinator hands a message on (routed tasks are FIX-2083's). This issue blocks both. Removed here, any release in between ships coordinators that can't route and workers that can't wait; the epic counts a regressed coordinator goal as *not done* |
| **Locks in** | FIX-2082 removes the wait form, FIX-2083 the post form, and the later one the tool, its action and its migration line (amended in this PR). Meanwhile `dispatchTask({ goal })` duplicates `createTask`, `{ taskId }` releases a held task, and `{ taskId, assignee }` obeys the field table. The closure still allows no fifth tool but `answerTask` |

![D1: when dispatchTask goes. Keep it until its wait and post form are replaced, chosen, beside removing it here. Decides it: a release between this issue and FIX-2082 and FIX-2083. Kept, coordinators still route and workers still wait; removed, both break. The price: a second way to file and start a task for one to two issues. A tie: the closure still allows no fifth tool. Locks in: the later of FIX-2082 and FIX-2083 removes it. Flips if both land in the same release as this one](figures/d1-dispatch-task-stays.svg)

It comes down to a release in between: removed here, coordinators can't route and workers can't wait.

**What would change my mind:** FIX-2082 and FIX-2083 landing in the same release as this issue.
Then the tool goes here, and each of them builds on its absence.

<a name="d2"></a>
## D2 · `delegates: all` follows the roster as it changes

| | |
|---|---|
| **Instead of** | Copying the roster into the session's list at its first read, as a listed `delegates:` is copied |
| **Because** | `all` means *the whole roster* ([concept](../../../docs/internal/design/workforce-coordination-concept.md#chain-of-command)). A copy goes stale at the first hire: the new worker is unreachable by a worker told to reach everyone, and a fired one stays listed. Read per call, it is the roster hiring already keeps, each worker passing the delegate check as now |
| **Locks in** | An `all` worker reaches every worker its user hires, at once, itself included (as a plan row). Removing one turns the list into the roster as it stands minus that worker, no longer following. The 25-delegate cap bounds a written list, not `all` |

![D2: what delegates all reads. The roster as it changes, chosen, beside a copy taken at the first read. Decides it: a worker hired after the conversation began. Live, it is reachable at once; a copy misses it. The price: a new hire gets work from an all worker without the user pointing at it. A tie: Bob's workers are never reachable either way. Locks in: removing one turns all into a written list. Flips if users want all to mean everyone hired so far](figures/d2-all-follows-roster.svg)

It comes down to a worker hired mid-conversation: a copy of the roster never reaches it.

**What would change my mind:** users reading `all` as *everyone I had when I set it*. Then `all`
is copied at first read, like a listed `delegates:`.

## Decided, not asked

- **One point decides who a task can reach:** the board's roster check, per call. Every assignee
  writer passes it, tool or action: `createTask`, `updateTask({ assignee })`, `dispatchTask`, a
  task session's pieces, the hand-over's re-check. Only its source changes: the delegates, or the
  roster under `all`. Posts keep their own check until FIX-2083. A plan row (the worker itself,
  FIX-2076) needs no delegate.
- **One point decides each field's rule:** one table in `orchestration`, read by the `updateTask`
  block the tool and the action share, and one guarded write that checks the status inside the
  write, as `setAssignee` declines today. A task that starts in between is refused, not edited.
- **The field table is the concept's,** unchanged. `message` is FIX-2086's row. A cancel sent with
  anything else is refused. A refusal names field, state and next move: steer (FIX-2086), cancel
  and refile, or a follow-up.
- **A started task can't be reassigned,** closing FIX-1659 with neither of its options. The
  concept made the call (story T-24).
- **Inputs are flat and use `id`,** as the concept writes them; `labels` replaces the list, and
  `addLabel`/`removeLabel` go. Callers of `updateTask_tasks` rewrite at upgrade (epic
  [(e)](../../epics/FIX-2056/DECISIONS.md#e)).
- **`createTask` takes the same fields and FIX-2080's four settings,** under FIX-2080's names.
  Start and attempts follow the table; session and result never change (ER-4). It starts as its
  start setting says, so nothing filed waits for a dispatch.
- **A row `addTask` recorded reads as held.** If FIX-2080 stores held some other way, it is read
  through its map (ER-6), an entry this issue turns on. Raised to the epic as a fifth map shape.
- **Reads reach down the filer's own tree:** its boards, and `listTasks({ filedBy })` for the
  tasks its task filed (FIX-2077). Any of the user's tasks by id is FIX-2070's.
- **`managesOwnDelegates`,** a coordinator setting, default `false`, gates `addDelegate`,
  `removeDelegate` and `setFallback`; every worker with a board gets `listDelegates`. Shift
  Manager's Shift Coordinator sets it: it hires and adds its own delegates.
- **A screen acts as the user:** the tools' own blocks, claimless, in a session the engine refuses
  to another user. Identity is the host's principal (BP-031).
- **No POC and no checker.** Every premise is read from code and cited; nothing rests on a count.

## Considered and dropped

| Option | Why it lost |
|---|---|
| Strip `dispatchTask` to its wait and post forms now | Two shapes of one tool in two releases, for a tool leaving within the epic |
| Move its wait onto `getTask` here | FIX-2082's mechanism: a wait is marked when the row is filed, so waiting on an earlier task is new work |
| Keep `patch: { … }` and `taskId` | A second spelling beside `getTask({ id })` |
| Revoke the running worker's claim on a reassign (FIX-1659 A) | Two accountable workers across the swap |
| Keep delegate tools on every coordinator | Rule 13: a worker widens its own reach (C-02) |

## Settled

- **Every tool and action reads one roster, per call.** Read from `board.ts` (`reach` at `:280-296`,
  `roster` at `:299-302`, the actions at `:735`) and the hand-over's re-check (`:347-362`). The
  premise that one source change covers every writer held.

## How it got here

- **Draft** — framed as the epic's ER-5: four task tools, one table of field rules behind one
  guarded write, and the delegate list as the board's one roster. `dispatchTask` stays until
  FIX-2082 and FIX-2083 replace its two jobs.

Open: none.
