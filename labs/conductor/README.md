# conductor

A row on a board becomes a supervised coding run.

Something claims the row, gives the run its own checkout of the repository, stays with it until it
stops, reads what came back, and then closes the row or lets it run again.

Two things make that supervision real:

- **The checkout is the run's own.** Without one, a coding agent edits whatever directory the
  server happens to sit in — which is the conductor's.
- **One place decides the verdict**, before the row is settled. A run that exhausts its turn
  budget or its spend does not fail: it finishes normally and reports the bad news *inside* its
  result. Anything that treats a normal finish as success records a run that produced nothing as
  completed, and never tries it again.

Research software. Unpublished, private to this workspace.

## What it does today

One phase (`implement`), one issue at a time, two outcomes.

```ts
import { conductorFlow } from "@flow-state-dev/conductor";

const { flow } = conductorFlow({
  epic: "harness-manager",
  workspace: {
    root: "/var/conductor/checkouts",
    sourceRepo: "/var/conductor/repo",
    baseRef: "main",
  },
  maxAttempts: 3,
});
```

Three zero-model actions:

| Action | What it does |
|---|---|
| `seed` | Files one issue-phase as a durable row and drains the board. Returns without waiting for the run. |
| `wake` | Drains again — claims whatever is ready, including a re-pended retry. |
| `status` | Reads the board row beside the run's own record. |

`status` reads the **board row** for completion, always. The board ledger cannot be made
client-readable (`defineTaskCollection()` exposes no `client` option, so its collection-state route
answers 403), and nothing else can stand in: a settlement declined on a lost claim is dropped
rather than thrown, so both the run record and the request read as success while the row is still
open.

### The two outcomes

**Done** needs a successful run **and** the job actually finished — for `implement`, a pull request
existing for the branch. Either one alone completes a row that should not be: a run can open the
pull request and *then* exhaust its turn budget.

Anything else is a **failed attempt**. The row goes back to `pending` with the reason attached as
feedback, or to `errored` once the retry budget is spent. A retry re-runs the agent from the
beginning, in the checkout the last one left behind, and is told why the last one stopped.

### Reading it back

```bash
pnpm fsdev run conductor seed   -i '{"issue":"FIX-1219","phase":"implement"}'
pnpm fsdev run conductor wake   -i '{}'
pnpm fsdev run conductor status -i '{"issue":"FIX-1219"}'
```

`status` answers from any session. The board row and the run record are both
scoped to the user, so a `status` call from a coordinator session that never saw
the run still returns the harness session id, the checkout, the branch, the last
outcome and the cost — which is the point of recording them at all.

The session id on a run record is a copy, kept so conductor can say which
session a run was. It is not a resume handle, and nothing here reads it back to
continue anything.

**Retention is a known gap.** Nothing prunes run records, and at user scope they
outlive every session. Fine while a conductor drives one issue at a time; a
long-lived board over many issues needs a retention policy, which is not built.

### Where the checkout lives

Derived, never read back from anywhere:

```
<root>/<tenant>/<user>/<epic>/<issue>--<phase>
conductor/<tenant>/<user>/<epic>/<issue>-<phase>
```

Derived because the board outlives the session that filed a row — a task woken in a new
coordinator session must resolve the same directory, or the retry silently starts from nothing.

**Namespaced because one job's state is isolated per principal and per epic**, and the
collections get that from the framework while the filesystem and git get it from nobody. Two
users, or two epics, driving the same issue-phase on one host would otherwise share a directory
*and a branch*: the second agent opens a tree holding the first's commits and uncommitted work,
and a pull request on the shared branch can satisfy the second's completion check — one run
reporting success on another's work. The run record carries the same discriminators for the same
reason.

Provisioning is idempotent and never resets, forces, or discards uncommitted work. Two things
fail loudly rather than being papered over: a checkout whose branch was deleted underneath, and a
checkout that is on a *different* branch than expected — a run told it is on one branch while its
commits land on another is the kind of agreement where every layer is wrong together.

## What it does not do yet

- **One phase.** Spec and review phases are not built. The phase surface is three values passed to
  the manager (a prompt builder, a done-condition, a readable set), so a second phase needs no
  change to the manager — but a record type or a registry deliberately does not exist yet.
- **No third outcome.** "Made progress but is not finished" would have to settle the row either
  done (dishonest) or waiting (a status nothing here has a use for). A run that asks a person for a
  decision, and the inbox it waits in, are LAB-139's.
- **No resume.** Conductor starts runs; it does not continue one across a wait. That is
  FIX-1179 / FIX-1246's, and the association a resume reads from is a typed field on the task —
  the session id on the run record is a copy conductor keeps so it can say which session a run was.
- **One issue at a time**, by design. The board's concurrency setting governs it; the manager holds
  a worker slot for the run's whole duration.
- **No UI.**

## Deployment

**One host, with workspace storage that outlives the process.** A retry inherits the last attempt's
work because that work is on disk. On a queued multi-host deployment a recovery can land on a
different worker, where the recorded checkout names nothing and the retry restarts with none of the
work the retry budget is priced on. Making checkouts portable is not built and is deliberately out
of scope.

**Raise the shutdown budget past your longest expected run.** For an in-process host that is
`detachedDrainTimeoutMs` on `createFlowState`, whose default is tuned to a serverless SIGTERM
window — far shorter than a coding run. On a queue-consuming host (`colocated` or `worker-only`)
that setting does not apply at all: `dispose()` waits for the worker separately and without it, so
the **platform's** kill timeout is the real ceiling. Miss either and every long run truncates
silently.

## Two attempts alive at once

A lapsed lease does not terminate the attempt that held it, and the board's own write fence covers
task settlement only. Two things follow:

- **A write to the run record is fenced against the live board claim.** An attempt writes only
  while the board's attempt counter still matches the one it was handed and the row is in a status
  an attempt owns. A fence local to the run record does not hold: it must permit same-attempt
  progress, and there is a real window in which a displaced attempt is the only one that has
  touched the row.
- **Two live attempts never share a working tree, and resolving that never costs a retry.**
  Contention **waits**, bounded. Only exceeding the bound fails the attempt, and that is a wedged
  process rather than a race. A refusal would charge the valid attempt for the displaced one's
  lease lag.

**A named limit.** The fence closes the ordinary reclaim case. It does not close ABA: a task
deleted and recreated under the same issue-phase while a displaced worker is still alive resets the
attempt counter. Closing that would need the task board to pass claim identity through to the
worker, which it does not — `TaskWorkerInput` carries neither `createdAt` nor `incarnationId`.
That is framework work and outside this lab.

## Tests

```bash
pnpm --filter @flow-state-dev/conductor test
```

The end-to-end check — a real Linear issue, a real model, a real pull request — lives at
`goals/conductor/implement-phase-opens-a-pr/`.
