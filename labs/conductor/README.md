# conductor

A row on a board becomes a supervised coding run.

The map is [`docs/atlas/conductor.html`](../../docs/atlas/conductor.html) — what exists,
what is still dashed, and the env a first run needs (`CONDUCTOR_REPO` is a different
checkout, not this dispatcher). Opening the board and talking do not need an
`origin` remote or `gh`. Starting a coding run does — `seed`, `wake`, and a talk
turn that files or retries refuse before they claim if the completion check
cannot name a repository. Run `pnpm conductor` from this directory. From the
repo root, `fsdev conductor` will not find this flow.

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

One phase (`implement`), one issue at a time, three outcomes.

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

Four zero-model verbs, plus one talk turn:

| Action | What it does |
|---|---|
| `seed` | Files one issue-phase as a durable row and drains the board. Returns without waiting for the run. |
| `wake` | Drains again — claims whatever is ready, including a re-pended retry. |
| `status` | Reads the board row beside the run's own record, and the questions the run is waiting on. |
| `answer` | Answers one of those questions and starts the run again holding it. |
| `steer` | The coordinator. The operator talks; this turn may call the verbs above as tools. It does not implement. |

`status` reads the **board row** for completion, always. The board ledger cannot be made
client-readable (`defineTaskCollection()` exposes no `client` option, so its collection-state route
answers 403), and nothing else can stand in: a settlement declined on a lost claim is dropped
rather than thrown, so both the run record and the request read as success while the row is still
open.

### The three outcomes

**Done** needs a successful run **and** the job actually finished — for `implement`, a pull request
existing for the branch. Either one alone completes a row that should not be: a run can open the
pull request and *then* exhaust its turn budget.

**Waiting on a person** needs a run that did not fail **and** a question it wrote down. Both
halves, for the same reason: a run that asked and then ran out of budget is not waiting on
anybody, and holding the board for it would stall the job silently.

**When both hold, the question wins.** A run can succeed, write a question, and satisfy the
done-condition in the same attempt; it waits on a person rather than completing. The two are
scoped differently — the question belongs to this attempt, while the done-condition reads the
branch, which every attempt on the task shares. A pull request some earlier attempt left says
nothing about whether *this* attempt's question has been answered, so completing on it would
discard a question nobody had seen. The cost is one extra round trip when a run asked something
and then went on to finish anyway.

Anything else is a **failed attempt**. The row goes back to `pending` with the reason attached as
feedback, or to `errored` once the retry budget is spent. A retry re-runs the agent from the
beginning, in the checkout the last one left behind, and is told why the last one stopped.

### Asking, and being answered

A run that hits a real ambiguity has two bad options: guess, or stop with nothing useful to show.
It gets a third one here. The prompt tells it to write the question — and only the question — to a
file in its own checkout. The manager reads that file, files the question as a durable row, puts
the job on hold and returns. Nothing is held open while you think about it, and the run costs
nothing.

You answer the row by name. Daily use is `fsdev conductor` — same host as `fsdev run`. Type to talk, or use a slash verb. While composing, ↑/↓ recall a prior line, ←/→ move in it, and Ctrl-J starts a new line:

```bash
pnpm conductor status FIX-1219
# → questions: [{ question: "FIX-1219/implement/1/a3f19c…", text: "Which path did you mean?" }]

pnpm conductor answer FIX-1219/implement/1/a3f19c… "Correct the path only. Leave the symlink alone."
```

The JSON door is still there if a script already speaks it:

```bash
pnpm fsdev run conductor status -i '{"issue":"FIX-1219"}'
pnpm fsdev run conductor answer -i '{
  "question": "FIX-1219/implement/1/a3f19c…",
  "answer": "Correct the path only. Leave the symlink alone."
}'
```

`answer` does the whole round trip: it records the answer, takes the job off hold, and starts it
again. The next attempt is told what you said, alongside every earlier answer, oldest first. There
is nothing else to run afterwards.

A refusal comes back as a refusal, never as silence — `result: "declined"` with a reason and both
rows' statuses. Answering a question the job is not actually waiting on does nothing, and says so.

**Three live limits, worth knowing before they surprise you.**

- **An answer spends one of the run's retries.** Ask three questions of a job budgeted for three
  and it has none left for a real failure. Budget for questions *plus* failures.
- **The answered run restarts rather than resumes.** It begins a fresh coding session in the same
  checkout, holding your answer and whatever the last attempt left on disk — it does not pick up
  the earlier conversation.
- **A second answer arriving while the first is still being applied is dropped, not refused.** The
  run comes back holding the first one. Answer once, and read `status` before answering again.

`fsdev conductor` is the operator surface: a live board in a TTY, or the same verbs
headless for a script. There is no way to redirect a run mid-flight or send it on a side
errand. You can stop a live run (`abort` / `x` in the board), and you can answer
what it asked. A full-board `status` prints each running row's current action
(the same ASK column the TUI uses) — a tool, or `think ·` while the child is
reasoning. `--json` adds `now`, `files`, `hunk`, and `todo` on those same rows.
`e` expands the last Read peek or command tail. A named `status ISSUE` or `watch ISSUE`
prints that attempt's last tool, files, hunk, and current todo on stdout. A
running row also prints how long since it last wrote (`8s`, `3m`).

Nothing bounds how long a question may stay open. A job waiting on a person is deliberately
outside the lease's governance, so a question nobody answers holds its row indefinitely.

### Reading it back

```bash
pnpm conductor                  # live board; slash commands, poll, answer in place
pnpm conductor seed FIX-1219
pnpm conductor wake
pnpm conductor status FIX-1219
pnpm conductor watch FIX-1219   # poll status until waiting or terminal
pnpm conductor abort FIX-1219   # stop the running request on that row
```

Or the JSON door:

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
<root>/<tenant>/<user>/<board-collection-id>/<issue>--<phase>
conductor/<tenant>/<user>/<board-collection-id>/<issue>--<phase>
```

`<tenant>` and `<user>` are **encoded**, not validated: `t0` when the request is
untenanted, `t1h<hex>` when it is not, and `h<hex>` for the user. Those ids belong to
whoever issued them — `auth0|abc` and `alice@example.com` are ordinary values — so a
grammar there would reject a valid caller on every attempt and burn the row's retry
budget on a mismatch no retry can fix. Encoding cannot reject anyone, and it cannot
map two callers onto one directory.

`<board-collection-id>`, `<issue>` and `<phase>` are identifiers *we* issue, so those
are validated instead: letters and digits separated by single `-` or `_`. Two things
the grammar buys, and both were bugs first. It forbids `--`, which is what makes `--`
a frame no component can forge — otherwise issue `a--b` + phase `c` and issue `a` +
phase `b--c` derive one directory and one branch. And it forbids dots, because this
string is a git ref as well as a path: `git check-ref-format` rejects a name ending in
`.` or `.lock`, so a dot-bearing phase would be accepted here and then fail at every
checkout creation.

The rule behind both halves, stated once in `src/workspace.ts`: **a derived identity
must be injective over its components, and safe for every consumer of the string.**

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

- **One phase per conductor, and a second phase needs its own `epic`.** Spec and review phases are
  not built. The phase surface is three values passed to the manager (a prompt builder, a
  done-condition, a readable set), so a second phase needs no change to the manager — but a record
  type or a registry deliberately does not exist yet.

  Until one does, **the board identity is `(tenant, epic)` and the phase is deliberately not part
  of it.** So two conductors built for two phases of the *same* epic share one board and one task
  collection: either one's `wake` claims the other's rows, the manager's phase guard refuses them,
  and the refusal costs a valid task an attempt — `attempts` is incremented inside the claim write,
  so it is spent before any guard can run. Give the second phase its own `epic` value. The seed
  error says so, and a test pins both halves.

  **And give it its own host.** A second conductor registers cleanly — the two carry distinct
  flow ids — but the engine resolves a flow by kind alone, so the second instance is never the
  one a request reaches. Dispatching by instance id is framework work; until it exists, one
  conductor per host.
- **No "made progress but is not finished" outcome.** It would have to settle the row either done
  (dishonest) or waiting on a person (which now means something specific: a question with an
  answer coming). A run that stalled without asking anything is a failed attempt.
- **No resume.** Conductor starts runs; it does not continue one across a wait — an answered run
  begins a fresh coding session in the same checkout. That is FIX-1179 / FIX-1246's, and the
  association a resume reads from is a typed field on the task — the session id on the run record
  is a copy conductor keeps so it can say which session a run was.
- **One issue at a time is a property of how you seed, not something the board enforces.** The
  board's `concurrency` is set to 1, which bounds how many rows one drain hands off — but a
  detached dispatch hands off and returns, releasing the slot long before the run finishes. Two
  seeded issues produce two live runs whatever that setting is; measured, and pinned by a test.
- **No web UI.** The terminal surface is `fsdev conductor` (from this directory: `pnpm conductor`).

## Deployment

**One host, with workspace storage that outlives the process.** A retry inherits the last attempt's
work because that work is on disk. On a queued multi-host deployment a recovery can land on a
different worker, where the recorded checkout names nothing and the retry restarts with none of the
work the retry budget is priced on. Making checkouts portable is not built and is deliberately out
of scope.

**Use the shutdown budget `conductorFlow` derives for you.** It returns `drainBudgetMs`; pass
that as `detachedDrainTimeoutMs` on `createFlowState`. Sizing it by hand goes wrong in both
directions: the framework default is tuned to a serverless SIGTERM window, far shorter than a
coding run, and the obvious correction — the run's own deadline — is *also* too small. A worker
waits for the checkout lock, provisions, runs the agent, and then probes for the pull request, and
the engine carves its cancellation reserve out of this budget rather than adding to it. Set it to
the agent deadline and a valid run near that deadline is cancelled before it can produce a
verdict. On a queue-consuming host (`colocated` or `worker-only`)
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
