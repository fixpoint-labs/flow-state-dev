# FIX-2083 · Decisions

[Spec](SPEC.md) · **Decisions**

The concept fixed what a routed task is (*Routing*, rules 5, 6, 7 and 9) and the epic gave the
settings to FIX-2080 and the ending path to FIX-2078. These three calls carry the rest.

## The tree

```mermaid
flowchart TD
  I["FIX-2083"] --> D1["D1 · judgment files with createTask and the routing settings · the user's words ride as written"]
  D1 -.->|"rejected"| X1["a post flag on createTask · a second shape of one tool"]
  D1 -.->|"rejected"| X1b["the model's goal only · a paraphrase drops a detail"]
  I --> D2["D2 · a round's deadline is a wake on the coordinator's session"]
  D2 -.->|"rejected"| X2["a timer in each delegate's run · lost on a restart"]
  I --> D3["D3 · one fit check · a lead is refused only on a clear none fits"]
  D3 -.->|"rejected"| X3["keep two calls · two judgments of fit"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A judgment coordinator files with `createTask` and the routing settings; the delegate reads the user's words as written

| | |
|---|---|
| **Instead of** | A `post: true` flag moved onto `createTask`, which refuses a goal; or the model's goal alone, as for any task |
| **Because** | [FIX-1872 D2](../FIX-1872/DECISIONS.md#d2) holds: a delegate answers what the person wrote, and the coordinator goal grades a held-out word arriving intact. A flag keeps a second shape of one tool, which FIX-2081 just retired. So the model files an ordinary task with the routing settings and its own goal, and on a turn routing a message the server attaches that message, as written, with who wrote it and the recent lines, to every task the turn files with its result to the conversation |
| **Locks in** | `target` on `createTask`, the public field naming a workstream record: a filing setting, set only at filing and refused on `updateTask`, and refused from a filer whose delegates have no targets. The workstream session it resolves to is server-written, stored top level beside `session` (BP-031), never an input. The attached message is server-written and never an input field. The routing settings are the model's per task (the concept's *chooses per task*): a routed task is attempts 1 ([epic](../../epics/FIX-2056/DECISIONS.md)) by FIX-2080's rule for a conversation-result task: unset reads 1, so a judgment model that leaves `maxAttempts` out gets 1, never the board's default, and any other value is refused at filing, naming the rule. The policies file 1 |

![D1: how a judgment coordinator hands a message on. createTask with the routing settings and the message attached, chosen, beside a post flag on createTask. Decides it: what the delegate answers; both keep the user's words. The price: a field and a server-attached message on createTask. Locks in target on createTask; flips if the product wants coordinators to brief in their own words](figures/d1-createtask-as-written.svg)

It comes down to the tool surface: both keep Alice's words, but a flag is a second shape of `createTask`.

**What would change my mind:** the product wanting a coordinator to brief its delegates in its own
words. Then nothing is attached, and the goal is the brief.

<a name="d2"></a>
## D2 · A round's deadline is a wake on the coordinator's session

| | |
|---|---|
| **Instead of** | Today's timer, which each delegate's run keeps beside its turn and which wakes the coordinator at the deadline |
| **Because** | The timer lives in the delegate's process, so a restart loses it and the round waits for some other wake. FIX-2078's wake is the engine's one due-time source ([its D1](../FIX-2078/DECISIONS.md#d1)), fired until a pass clears it, after a crash too. The deadline belongs to the coordinator's round, not to a delegate's run, which a routed task's `work` entry no longer special-cases |
| **Locks in** | A round's deadline is due time on a wake on the coordinator's session whose entry is `roundDeadline`, cleared when every round is closed. On a host where FIX-2078's start check finds no wake support, the round deadline keeps an in-process timer, as today, so rounds still close there, though not across a restart. This issue therefore lands after FIX-2078, as the epic already orders. `roundDeadline` stays an internal entry |

![D2: who closes a round at its deadline. A wake on the coordinator's session, chosen, beside a timer in each delegate's run. Decides it: a host restart before the deadline; the wake closes the round on time, the timer is lost. The price: one more due-time kind on the wake. Locks in that this lands after FIX-2078](figures/d2-round-wake.svg)

It comes down to a restart: the wake closes the round on time; the timer is gone with the process.

**What would change my mind:** FIX-2078 landing without a wake the sweeper keeps. Then the timer
stays until it does.

<a name="d3"></a>
## D3 · One fit check; it vets a lead by refusing only a clear "none fits"

| | |
|---|---|
| **Instead of** | Two calls: best fit's evaluator, which picks with a confidence, and FIX-1920's lead-fit generator, which answers *does the work say its sort* and *does the lead fit* |
| **Because** | Both judge one thing, whether a worker's description fits the work. One check, asked the candidates and the work, answers a pick and a confidence. Best fit reads the pick through its ladder unchanged. Opening a workstream asks it about the chosen lead, with two more choices beside the pick: *none fits* and *the work doesn't say its sort*. It refuses only *none fits*, so it stays a backstop for clear misfits, never a router, and a bare-name lead still passes. A failed call lets the open through, as today |
| **Locks in** | Lead-fit's two-part answer is one choice of three; `lead-doesnt-fit` now means the check answered *none fits*. `leadFit: { model }` keeps naming the model, and its record keeps its shape |

![D3: how fit is judged. One check for best fit and the lead vet, chosen, beside keeping two calls. Decides it: two judgments of fit that can disagree on the same worker. The price: lead-fit's two-part answer becomes one choice, so a borderline lead may change verdict. Locks in lead-doesnt-fit meaning none fits; flips if a lead vet needs a judgment best fit can't give](figures/d3-one-fit-check.svg)

It comes down to agreement: two calls can call one worker a fit for routing and a misfit for leading.

**What would change my mind:** a lead vet that needs something best fit can't answer, such as
whether the lead can manage the workers under it. Then the vet keeps its own call.

## Decided, not asked

- **A routed task is only its settings.** Session *ongoing*, result *conversation*, and, from a
  policy, attempts 1, on the coordinator's delegation board, worked on `work`. No kind marker,
  no entry of its own, no special case on cancel, assign or lease. The conversation's recent
  lines ride the task's server-written brief and are shown to the delegate's model as one
  user-role message on that turn, never system text, never stored (today's guarantee).
- **The ongoing session of a workstream record** is the workstream's session, resolved at filing as
  today. A record whose target names none files nothing and is recorded.
- **Rule 5 holds.** One open routed task per delegate session; a second waits. Best fit's hold
  ([FIX-1833 D2](../FIX-1833/DECISIONS.md#d2)) still picks the delegate; the message now queues,
  pending in the user's list and cancellable there. The cost, from rules 5, 6 and 9 together: a
  delegate waiting on work it filed holds later messages to it until that work ends. A waiting
  task whose round has closed is still worked; its answer lands once, late, as today.
- **A routed turn is a task turn.** The `taskTurn: false` stopgap goes; the delegate may file work,
  and its task stays open until that work ends (rule 6, FIX-2077). Until FIX-2082 lifts the
  task-turn wait refusal, a routed delegate files work and ends its turn, and rule 6 keeps its task
  open; from FIX-2082 on it may also wait on that work (rule 9). The coordinator never waits on a
  routed task (FIX-2082's refusal).
- **Routing never picks the coordinator itself.** Its candidates exclude the coordinator, whatever
  its delegate list says, so no routed task lands on its own plan ledger. Best fit's self-pick
  stays what it is today: the coordinator answers, and nothing is filed.
- **Endings.** One entry, `onTaskSettled`, through FIX-2078's path. A conversation-result ending
  lands as a line under the delegate's name and feeds the rounds; nothing wakes a judgment turn
  for it. A failure's error report rides it ([(f)](../../epics/FIX-2056/DECISIONS.md#f)). A
  delegate's failed after-answer memory save is logged and does not fail its routed task, so the
  user still gets the answer: the owner's decision of 2026-10-21
  ([audit thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3598#issuecomment-6320943151)).
  The rule and its carve-out for conversation-result tasks are FIX-2088's D1
  ([#3602](https://github.com/fixpoint-labs/flow-state-dev/pull/3602)); this issue builds nothing for it.
- **Rounds, deadlines and the routing record key on task ids.** A round holds the ids it filed.
  A routed task's id stays derived from the message, the round and the delegate record, so the
  same pick twice files one task. Stored routing records and round state naming a post id are
  dual-read (BP-030).
- **A delegate is a worker whose flow takes conversation tasks.** `defineCoordinatorFlow` stops
  requiring the post entry; FIX-2084 checks roles at hire.
- **The convergence point** for *a task whose result goes to the conversation*: FIX-2080's filing
  check, refusing it from anything but a conversation. Its two writers are routing's filing step
  and `createTask` on a judgment turn.
- **Retired rows.** This PR turns FIX-2080's *post to a routed task* entry on as it stops writing
  posts, and builds no read of its own (ER-6).
- **`dispatchTask`.** This issue removes its post form; if FIX-2082 has landed, the tool and its
  action too (FIX-2081 D1).
- **Changeset lines**, removed outright under [(e)](../../epics/FIX-2056/DECISIONS.md#e), each a
  row in the epic's [`migration.md`](../../epics/FIX-2056/migration.md):
  `DELEGATED_POST_ENTRY`, `delegatedPostEntry`, `delegatedPostHistory`, `delegatedPostOnFinished`,
  `delegatedPostSchema` and `DelegatedPost` (a delegate declares `work` only);
  `taskLedgers({ taskTurn })` (nothing); `defineCoordinatorFlow`'s `delegateFlows`,
  `defineSessionBoard`'s `postFlows` and `posts`, and `posts`/`both` in `listDelegates`' takes
  (a delegate is a worker whose flow takes tasks; FIX-2084's role check is the one answer). The
  implementation's sweep checks they are gone. `dispatchTask({ post, target })` has no row of its
  own: it is FIX-2081's `dispatchTask` row, whose routed-task line reads `createTask` with
  `target` and the routing settings.
- **The collection's dispatch verb.** If this lands after FIX-2082, it removes
  `TaskCollectionRef.dispatch`, `TaskDispatchOptions`, `Task.dispatchCall` and the
  `already-dispatched` decline with the tool, under the same row. If FIX-2082 lands later, it
  does.
- **No POC and no checker.** The premises are read from code at `96404d25`, and no claim here
  rests on a count.

## Considered and dropped

| Option | Why it lost |
|---|---|
| Keep the post entry, drop only the kind marker | The entry is what holds the timer, the cancel action and the stopgap; the row would only look like a task |
| A `routed: true` preset on `createTask` | A name for three settings; one rule per field (FIX-2081) and the concept's per-task choice say set them |
| Address a workstream by an `assignee` like `eng.em (pricing-page)` | A string format a model must spell exactly; `target` is today's field, moved |
| Let a routed task run beside another in the delegate's session | Rule 5 is the owner's, and two open tasks in one session break FIX-2077's done |
| Refuse a goal on a routing turn's `createTask` | A field rule that changes with the turn; the attached message already keeps the words |

## Notes from review

Recorded for the implementer, not baked into the design. Round 1, on `48372389`.

- **Tag the goal legs by slice** (Cursor, SPEC goal): *core* (no post writes; legs a, c, e; the
  sweep) · *D2* (leg b) · *D3* (leg d's fit part), so a split implementation can land without
  re-opening the whole goal.
- **Name the three settings where the routing figure first says "three settings"** (Cursor):
  `session: ongoing`, `resultTo: conversation`, `maxAttempts: 1`.
- **Assemble the brief once per routing turn** (Cursor, D1): message and recent lines built once
  and attached to each task the turn files, especially *everyone* filing N; one internal filing
  helper, the successor to `filePost` / `deliverTo`, serving both writers.
- **No second entry or settlement path** (Cursor): `defineCoordinatorFlow` and the board's
  `among: [work, onDelegatedPost]` go to `work` only, and `task-settled.ts`'s post branch is
  deleted rather than adapter-mapped (ER-6).
- **Sweep the helpers too** (second look): the goal check's sweep also finds no `isPostRow`,
  `onPostSettled` or `postCancelled` in `packages/` or `apps/`, leaving `workerTaskEntry` and
  `conversation-board/task-entry.ts` as the only entry and ending pair (`task-settled.ts`,
  `notice-delivery.ts`, `board.ts`).
- **Merge order** (second look, cross-spec audit): this lands after FIX-2077, FIX-2078, FIX-2080
  and FIX-2081 merge (the blocked-by relations); D2 rests on FIX-2078's sweeper-kept wake, and a
  routed task stays open while its filed work runs only under FIX-2077's rule 6. No edge from
  FIX-2082: the interim under *A routed turn is a task turn* covers either order.
- **D3 can be its own PR** (Cursor, second look): it shares no code path with the post removal.
  It stays in this issue because the epic puts *one fit check* here
  ([SPEC](../../epics/FIX-2056/SPEC.md), set and debt); the implementer may land it separately.

## How it got here

- **Draft** — framed as the epic's R-01 to R-05: a post becomes a task with FIX-2080's settings
  on `work`, its ending on FIX-2078's path, its round deadline on FIX-2078's wake, and the two
  fit calls folded into one.
- **Owner decision (2026-10-21)** — on the cross-spec audit's F1
  ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/3598#issuecomment-6320943151)):
  for a conversation-result task, a failed after-answer memory save is logged, not a failed
  task; every other task keeps FIX-2088 D1. Recorded under *Endings*, citing FIX-2088.

**Open: none.**
