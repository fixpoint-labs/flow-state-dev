# FIX-2422 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: a line sent from a task, and its reply, are found by the task's
view after a reload, by a stamp rather than by app memory. Two calls are left: where the stamp
is written, and how far a caller-named id is trusted.

<a name="d1"></a>
## D1 · The request carries the stamp, named by an action option the engine reads

| | An action option, `taskOf` (chosen) | Each door marks its own scope, in Workforce | App memory per task (`sessionStorage`) |
|---|---|---|---|
| The user's line is stamped | yes | **no:** the engine writes the echo before any block runs | no |
| A turn that fails, or steers, before emitting is still found | yes, the echo is stamped | no | in that tab only |
| Survives a reload, another tab, another app | yes | yes, for what the turn emitted | no |
| Touches L1 | one optional field in `ActionCore`, a few lines in `runAction` and the context | none | none |
| Every app gets it | yes | yes | no, each keeps a copy |

- **Because:** the line is the half the person misses most, and only the engine writes it. A
  scope mark in Workforce stamps the reply and leaves the line to be paired up by request in
  each app, which is the app-side bookkeeping this issue removes. A line that steers an open
  task emits nothing else in its request, so pairing would lose it outright.
- **Against ER-1 of FIX-2369** ("no worker, task, board, hold or harness noun enters `core`,
  `engine`…"). The noun is already there: `OutputItem.taskId` and `ctx._markTaskScope` are L1
  since FIX-658, and nothing in L1 reads the stamp. `taskOf` is a second way to set the same
  field, at the request instead of a scope. It names no worker, board or hold, and L1 still
  decides nothing by it.
- **Locks in:** the id comes from the action's input, so a flow opts in per action. A scope a
  task-board worker marks inside the request still wins, so a task's own work keeps its own id.
- **What would change my mind:** a reading of ER-1 that forbids any new task-shaped field in
  core, even one that only labels. Then the door marks its scope in Workforce and Shift Manager
  keeps pairing the line by request, with the steer case left open.

<a name="d2"></a>
## D2 · A caller-named task id labels items; it never routes or admits

| | Trust it as a label (chosen) | Check it against the session before stamping | Derive it on the server only |
|---|---|---|---|
| Works in a worker session that holds several tasks | yes | yes, at the cost of a ledger read per turn | **no:** only the caller knows which task's screen the line came from |
| A wrong id can misfile a line | only under a task this session ran, and only in the sender's own view | no | no |
| Cost | none | a read, and the echo is already written before a block can refuse | — |

- **Because:** BP-031 covers auth and routing, and the stamp is neither. A steer still picks the
  session's open task from server state (FIX-2086), whatever the line names. Readers already
  gate a stamp on the task's `task-change` items in the same session (`itemsForTask`), so an id
  for a task this session never ran attaches to nothing.
- **Locks in:** no refusal for an unknown id. If a later reader starts deciding by `taskId`,
  that reader checks it, not the door.

## Decided, not asked

- **E1 · Which doors:** every built-in door (the `agent` flow, the coordinator flow, the error
  reporter). A custom worker flow opts in with `doorTaskId` in its input and
  `taskOf: doorTaskOf`. The hire's door contract is unchanged, so no existing flow is refused.
- **E2 · The inventory says whether a door takes a task** (`doorTakesTask`, from `taskOf` being
  declared on `respond`). A strict door refuses a key it doesn't declare, so an app must know
  before it sends one. Old rows read `false` (BP-030).
- **E3 · Trace items stay unstamped** (`block_trace`, `router_decision`, `state_change`), as they
  are under `_markTaskScope`. Readers attribute content items, not traces.
- **E4 · No `sessionStorage` interim.** The issue's "until then" is replaced by the fix itself,
  which lands in the same epic wave as Shift Manager's adoption.
- **E5 · Two PRs, per FIX-2369's build order.** PR 1 is the package slice (core, engine,
  workforce, docs), from `main`, in wave 1, touching no app file. PR 2 is Shift Manager's
  adoption, the root of the wave-2 `task.tsx` stack (2422 → 2374 → 2408 → 2373 → 2409); it
  deletes `sent` and `noteSent` in the same change (ER-3).
- **E6 · The name `taskOf`**, beside `userMessage`: both read the action's input and say what the
  request's items are. The implementer may rename it if review finds a clearer one.

## How it got here

- Drafted 2026-10-31 with the package slice prototyped beside it
  (`/mnt/project-files/FIX-2422/prototype.patch`): the `agent` door's turn came back with the
  line and the reply stamped, and with `taskOf` removed the test failed on the missing stamps.
