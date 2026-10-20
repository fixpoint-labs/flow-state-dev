# Workforce Coordination: How It Should Work

## Why this doc

Workers reach each other and their users in many ways today, for three jobs: hand out work,
talk, and stop for a person. This doc gives each job one mechanism, as if it always existed. The
last section lists where today's code differs.

## Base terms

**A user is a person.** Everything below acts as one user, inside one org.

**A worker belongs to one user and acts as them.** It runs on the flow it names. A user's
**roster** is all the workers that belong to them.

**A session is where a worker works.** Only its user can open it.

**A conversation is the session where a user talks to one worker.** One per worker per user. A
coordinator also has one per project it coordinates.

**A request is one run of a worker in a session.** The server sets its **sender**: a user, another
worker's session, or the board. It produces a **result**. A session runs one request at a time.
A request **waits** when it can't go on until a task or a call ends. A request is **suspended** when
it stops for a person: nothing runs, it is stored, and it carries on from the same step when it **resumes**.

## The cast

| Name | Kind | Belongs to |
| -- | -- | -- |
| Alice, Bob | Users in the same org | |
| launch | Coordinator, routing by judgment. Delegates: writer, researcher, coder | Alice |
| writer | Worker on the agent flow. Delegate: researcher | Alice |
| researcher | Worker on the agent flow. No delegates | Alice |
| coder | Worker on a coding flow that drives a harness | Alice |
| Bob's researcher | Worker on the agent flow | Bob |

## The parts, in the order you meet them

1. **Task.** A piece of work on one of a session's two boards: its plan or its delegation board.
2. **Message.** Conversation with any worker on your roster.
3. **Inbox item.** The one way work stops for a person.
4. **Routing.** How a coordinator hands a user's message to its delegates.
5. **Chain of command.** How work a worker shouldn't file itself, new or needed, reaches someone who
   can.

| Part (all owned by the user, private to them) | Stored | How many |
| -- | -- | -- |
| Task | A row on one of the filing session's two boards, in the user's task ledger | One per piece of work |
| Message | The user's message log, and both sessions | One per send or call |
| Inbox item | The suspended request's record, listed in the user's Inbox | One per open stop |
| Routing state, delegates | The session's state | One per session |

## Tasks

**A task is a piece of work on a board, a session's list of tasks.** Its **filer**, the session that
filed it, plans it, sees how it ends, and can steer or cancel it. Its **assignee** does the work and
is accountable for it.

**Each session has two boards,** both stored and both shown in task views. One setting, `wait`,
tells them apart. To **drain** a board is to start its ready rows until none is left.

| | Plan | Delegation board |
| -- | -- | -- |
| Holds | Work the worker does itself | Tasks for delegates |
| `wait` | `true` (default): the drain waits on every row | `false`: the drain never waits |
| Drained by | The request working it, `respond` or `work` | `dispatch`, a short pass that starts what's ready and exits |
| A row runs | Inline, or in a **sub-agent** (a child session) | In another session |

**writer's plan** is outline, draft, fact-check, tighten. Its request writes the outline and draft
inline, dispatches the fact-check to a sub-agent, waits for it, then tightens. Running rows one at a
time or several at once is the pattern's choice.

**writer's delegation board** holds one task: researcher, find adoption numbers. Filing it runs
`dispatch`, which starts it in researcher's session and exits, so no request waits on it.
`dispatch` runs again on a filing, an update that starts or assigns a task, a person's answer, a
retry, an ending that makes a row startable, and any **touch** of the board (a read or write).

Where a row runs is its assignee's choice; whether the drain waits is the board's. A board never
mixes the two: a delegation board with an inline assignee is refused when it's built. Rows reach
another session through a **dispatcher** block. Its own `wait` is off by default; on, it waits for
the result, with a deadline. On a board, a dispatcher whose `wait` differs from the board's is
refused too.

```mermaid
flowchart LR
  req(["writer's request"]) -->|"drains, waits"| plan
  subgraph plan ["writer's plan, wait: true"]
    o["outline"] --> d["draft"] --> f["fact-check"] --> t["tighten"]
  end
  f -.->|"waited on"| sub(["sub-agent"])
  ev(["filing, ending, touch"]) --> disp(["dispatch"])
  disp -->|"starts, exits"| deleg
  subgraph deleg ["writer's delegation board, wait: false"]
    r["researcher: find adoption numbers"]
  end
  r -.->|"not waited on"| res(["researcher's session"])
```

*The plan waits on every row, even one handed to a sub-agent; the delegation board hands rows off
and is re-run by events.* Dashed arrows leave writer's session.

**Four settings, fixed at filing,** decide how a delegated task runs. A plan row uses only start and
attempts; its result goes to the drain.

| Setting | Choices | Default |
| -- | -- | -- |
| Start | Now · after named tasks (its dependencies) · held until `updateTask` starts it | Now |
| Session | New · the assignee's ongoing session for the filer's conversation · an earlier task's session (a **follow-up**) | New |
| Result goes to | **The filer:** its waiting request if one waits on the task, otherwise its next request · the filer's conversation, under the assignee's name (used by routing) | The filer |
| Attempts | Failed runs before it fails | 2 |

A session holds at most one open task from the delegation board above it; another routed or
continued into it stays pending. Its own plan rows never count.

**Plan it, or delegate it?** Plan work that needs what the session knows, or whose result you need
before going on; a step that needs a clean start goes to a sub-agent. Delegate work that can stand
alone, with its own attempts and cancel. A follow-up suits work that needs an earlier task's memory,
like writer asking researcher to shorten the stats. A worker is on its own roster, so it may
delegate to itself when it needn't wait.

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> running: slot free, start condition met
  running --> waiting_on_a_person: waitForUser
  waiting_on_a_person --> running: answered or deadline
  running --> pending: error, attempts left
  running --> done: result, nothing it filed open
  running --> failed: last attempt errors
  pending --> cancelled
  running --> cancelled
  waiting_on_a_person --> cancelled
```

*Each ending has one path, and a person's answer never costs an attempt.*

- **Done:** a request for it finishes with a result, and nothing it filed is still open.
- **Cancelled:** by the user, the filer, or the end of the task that filed it. Its open tasks go
  too, as they do when it retries or fails for good.
- **A dependency that fails or is cancelled** cancels the tasks that were to start after it.
- **Splitting:** a task stays running while tasks it filed are open. At most 5 deep, 100 under
  one top task.
- **Waiting:** a request may wait on a task it filed, even inside a task something waits on, up to
  5 waits deep. Every wait, on a task, a call or a sub-agent, has a **deadline**: reaching it resumes
  the request, which waits again or carries on. One that doesn't decide carries on without the
  result. The work goes on either way.

**The claim gate closes a dispatched task.** The request working a task holds its **claim**: only it
may record how the task ends. Every dispatched task enters through the **claim gate**, a step the
board puts around every task entry. Before the entry runs, the gate checks the claim is still
current, so a task cancelled in between never starts. When the entry ends, the gate settles the
row: completed is done, failed retries or fails, suspended is waiting on a person. The entry does
no bookkeeping. An inline plan row is settled by its drain.

**The filer steers with `updateTask({ id, message })`,** by the task's status. The user can also
type in the task's session. Any other worker's message there is just a message.

| Status | The message |
| -- | -- |
| Running | Steers: the current request stops and the worker continues with it, using no attempt |
| Waiting on a person | Answers it, within the Inbox rules |
| Done, failed, cancelled | Continues: a follow-up in the same session, with fresh attempts |

**Every ending reaches the filer once, through `onTaskSettled`,** a public board hook in
orchestration, as the result setting says. `dispatch` and every touch resend any ending still owed.

## Messages

**A message is conversation with any worker on your roster.** Delegates don't matter. A call may
get help that fits in the recipient's one request; anything bigger is a task.

`sendMessage({ to, text, wait?, inReplyTo? })` **sends**, returning nothing, or **calls**
(`wait: true`): the sender's request waits for the recipient's result, until a deadline like any
wait's.

**The recipient's entry is `receive`.** It always starts a new request, with input
`{ id, from: { session, worker }, text, waiting, inReplyTo?, budget }`. The server sets `from`,
`waiting` and `budget`.

**The receiver decides.** If `waiting`, its result goes back to the caller; if not, nothing does.
To answer a send, it sends with `inReplyTo`, which lands in the session that sent the original, or
the sender's conversation if that session's task has ended.

**Where it lands:** the recipient's conversation with this user, except that a message to the
worker that filed your task lands in the session that filed it.

**Limits:**

- A busy recipient queues the message. But a call into a session whose current request is itself
  waiting is refused at once, so two waits never block each other.
- A repeated call id gets the stored result.
- The server sets each request's budget: 6 messages per message a user types, 3 per request.
  Requests descending from a user's message share it. One with none behind it, such as the board
  starting a held task, gets a fresh one.

## Inbox items

**Work stops for a person one way:** `waitForUser({ kind, prompt, deadline? })`, where `kind` is
approval, question or review. It suspends the request. It works with or without a task, and needs
a host with durable execution. A suspension is not a wait, so a task something waits on may still
stop for a person.

**If the request works a task,** the claim gate marks it waiting on a person. It keeps its claim
while suspended, and its row records which suspension holds it. The resume carries on the same attempt,
so a person's answer uses no attempt.

**A suspension resumes once, one of three ways:**

| Outcome | When | The block |
| -- | -- | -- |
| Answered | The user answers in the Inbox or the task's session, or the filer answers a question. The first answer closes the item | Carries on with the answer |
| Deadline | Its deadline passes unanswered | Decides: go ahead without the person, escalate and suspend again with a new deadline (a check-in), or end |
| Cancelled | Its task is cancelled. The Inbox item goes away at once | Winds down without the answer. Nothing it returns is recorded on the cancelled task |

A block that doesn't handle a deadline gets the default: an approval counts as rejected, and a
question or review ends the request with an error, which uses an attempt.

- Only the user answers approvals and reviews. The filer may answer a question with `updateTask`,
  unless the task is a routed task.
- A resumed request takes its turn in the session, like any other request.
- **Stopping a suspended request** ends it, as a stop ends any request, and closes its Inbox item.
  If it worked a task, the task is cancelled.
- **A coding run can't pause midway,** because the coding agent runs as its own process. Its
  question ends the run, the coding flow's request suspends, and the answer starts the next run in
  the same coding session.

## Routing

**Routing decides who takes a user's message to a coordinator.** It files **routed tasks** on the
coordinator's delegation board:
session = the delegate's ongoing session for this conversation, result = the conversation under the
delegate's name, attempts = 1. The delegate remembers earlier routed tasks there.

| Policy | Who picks | Cost |
| -- | -- | -- |
| Judgment | The coordinator's own request files tasks, or answers | One request |
| Best fit | The fit check. A weak pick goes to the **fallback**, a delegate the coordinator names | One model call |
| Round robin | The next delegate | None |
| Everyone | Every delegate | None |

**The fit check is one model call.** It picks a delegate for best fit, and vets the **lead**
someone already chose for a **workstream**, a piece of a project. With **rounds** (up to 3), the
coordinator also sees each answer, so it can send it back out. A coordinator answers messages with
its own request, whatever its routing.

## Chain of command

**Your delegates are your authority.** You file tasks only with them. Each session's list starts
from its worker's defaults, and `all` means the whole roster. Only the user changes delegates,
except a coordinator whose instructions say so and whose delegate tool is turned on (off by
default).

**A worker files tasks only for work its own task needs.** Anything else goes up as a message to
its filer, who decides, for one of two reasons.

**New work that isn't part of your task** is the common one. The worker messages its filer,
describing the work, and carries on. The filer files a **sibling**: a new task on its delegation board, beside the
worker's task, usually in a new session. Its flow may tell a request for work from other messages, for
example with an **evaluator** (a block that judges input), and file it held, for the user to
approve. If the work isn't the filer's to plan either, it messages its own
filer.

```mermaid
sequenceDiagram
  participant coder
  participant launch
  participant researcher
  Note over coder: working on the adoption script
  coder-->>launch: message: the CSV export double-counts refunds
  coder->>launch: result: the script
  launch->>researcher: sibling task, new session: find where refunds double-count
```

*The worker reports new work and keeps going; its filer turns it into a sibling task.* coder's
task never waits on it. Dashed arrows are messages.

**Work you need but can't assign** is the other. A worker that needs work none of its delegates
can do messages its filer, describing the need. That filer files the task if it can, or messages
its own filer.

**A result always goes to whoever filed the task,** who passes it on, usually in a follow-up. The
original task may finish first; the work resumes through the follow-up, at the cost of extra hops.

```mermaid
sequenceDiagram
  participant researcher
  participant writer
  participant launch
  participant coder
  researcher-->>writer: message: I need an adoption script
  writer-->>launch: message: researcher needs a script
  launch->>coder: task
  coder->>launch: result: the script
  launch->>writer: follow-up, with the script
  writer->>researcher: follow-up in researcher's session, with the script
```

*The need goes up as messages, the work comes down as tasks, and every result returns to its
filer.* Dashed arrows are messages.

## How it flows

1. Alice tells launch "Draft the launch post": a `respond` request in launch's conversation.
2. It files a routed task for writer on launch's delegation board, and ends. `dispatch` starts the
   task in writer's session.
3. writer's `work` request, through the claim gate, calls coder: "Does the CSV have a month column?"
   coder answers yes.
4. It files a task for researcher on writer's delegation board, then ends. `dispatch` starts it.
   writer's task keeps running.
5. researcher's request asks "Which region?" with `waitForUser`, and suspends. Alice answers in her
   Inbox, and the same request carries on.
6. researcher finishes; the claim gate marks its task done, and `onTaskSettled` starts writer's next
   request.
7. That request drains writer's plan, waiting on the fact-check's sub-agent. It finishes with the
   draft and nothing open, so the claim gate marks writer's task done. The draft lands in Alice's
   conversation with launch, under writer's name.
8. Alice types "Make it half as long" in writer's finished task, and a follow-up runs.

```mermaid
sequenceDiagram
  participant Alice
  participant launch
  participant writer
  participant researcher
  participant coder
  Alice->>launch: draft the launch post
  launch->>writer: routed task
  writer-->>coder: call: does the CSV have a month column?
  coder-->>writer: result: yes
  writer->>researcher: task
  researcher->>Alice: Inbox: which region?
  Alice->>researcher: North America
  researcher->>writer: result
  Note over writer: drains its plan, waiting on a sub-agent
  writer->>Alice: draft, under writer's name
  Alice->>writer: make it half as long (follow-up)
```

*Three delegated tasks, one plan, one call and one Inbox item carry the whole job.*

## Entry points and tools

| Entry | Access | Starts a request for |
| -- | -- | -- |
| `respond` | Public | A user's message. It drains the worker's plan |
| `receive` | Internal | Another worker's message |
| `work` | Behind the claim gate | A task. It drains the worker's plan |
| `onTaskSettled` | Internal | A filed task ending |
| `dispatch` | Internal | Starting the delegation board's ready rows, then exiting |

Role-specific entries stay: `onWorkstreamOpened`, `changeWorkstreamDelegate`, `routeOn`,
`roundDeadline`. The model's seven tools: `addTask`, `updateTask` (with `message` to steer, answer
or continue), `cancelTask`, `listTasks`, `readTask`, `sendMessage`, `waitForUser`. Every worker gets `listDelegates`. Only a configured coordinator gets
`addDelegate`, `removeDelegate`, `setFallback`.

## What changes

| | |
| -- | -- |
| Lost | Settling any task by hand. The blocked status. Stopping for a person on a host without durable execution |
| Narrowed | Tasks only to delegates (or `delegates: all`). Workers changing their own delegates. A split's `{ answer, pieces }` result |
| Changed | A wait's deadline doesn't cancel the task. A person's answer resumes the suspended request instead of starting a new one. Deadlines are the flow's to handle. No automatic reply to messages. Every coordinator can be messaged. Boards differ by `wait`. A worker's plan is a board. A dispatcher can wait |
| Kept | Pluggable claim orders. A delegate's memory across routed tasks. Routing, rounds and records. A coding run resuming its coding session |

## Naming

| Retire | Say | Why |
| -- | -- | -- |
| Chief of staff | Shift Coordinator | The docs and UI already say it |
| Dispatcher (claim order, host) | Claim order, runner | One word for four things. The dispatcher block, dispatching a task and `dispatch` keep it |

## The rules

A behavior none of these rules explains is a bug in the model.

1. Every request acts as one user, with a server-set sender.
2. A request holds a task's claim only if the board started it for that task. The claim gate settles
   every dispatched task.
3. Work is a task, on the filer's plan or with a delegate, only for work its own task needs.
   Anything else is a message to the filer above. Neither leaves the user's roster: Alice's workers
   never reach Bob's researcher.
4. A task has one filer, who plans and coordinates it, one accountable assignee, and four
   settings.
5. A session holds at most one open task from the delegation board above it. Plan rows don't count.
6. A task is done when a request for it finishes with nothing it filed open. Cancelling, retrying
   or failing it cancels its open tasks; failing or cancelling it cancels its dependents.
7. Every ending is delivered once, through `onTaskSettled`, to the task's filer, as its result
   setting says. `dispatch` and every touch of the board resend one still owed.
8. A request may wait on a task it filed, even when something waits on its own task, up to 5 waits
   deep, each with its deadline. `waitForUser` suspends the request instead, which is not a wait.
9. A call returns the recipient's result. Nothing is relayed or answered automatically.
10. A call into a waiting session is refused, and so is a message past the budget.
11. Every stop for a person is one Inbox item: a suspended request. Only the user answers
    approvals and reviews.
12. A suspension resumes once, answered, deadline or cancelled, unless its request is stopped. A suspended task keeps its claim,
    and the resumed request takes its turn in the session.
13. Only the user changes delegates, except a coordinator configured to change its own.
14. A board's drain waits on every row (a plan) or on none (a delegation board). Where a row runs is
    its assignee's choice.

## Vocabulary

One term, one thing. Retired: turn, line, post, park, reply, relay, reopen, blocked, chief of
staff, dispatcher for the claim order or the host, and the rest of the table below.

| Term | Means |
| -- | -- |
| Request, wait | One run of a worker in a session; a request that can't go on until a task or a call ends |
| Suspended, resume, deadline | A request stopped for a person and stored; carrying on from the same step; when a suspension or wait resumes unanswered |
| Roster | All the workers that belong to one user |
| Delegate, coordinator | A worker a session may file tasks with; a worker that routes a user's messages |
| Evaluator | A block that judges input; here, telling a request for work from other messages |
| Task, filer, assignee | A piece of work on a board; the session that filed it; who does it |
| Board, drain, touch | A session's list of tasks; starting its ready rows until none is left; any read or write of it |
| Plan, plan row, sub-agent | A board of a worker's own work, waited on; a task on it; a child session running one |
| Delegation board, `dispatch` | A board of tasks for delegates, never waited on; the pass that drains it |
| Dispatch, dispatcher | Start work in another session; the block that does it |
| Claim, claim gate | The right to record a task's ending; the step around each task entry that checks it and settles the row |
| Follow-up | A task in an earlier task's session |
| Sibling | A task a filer files beside one of its own, from new work that task's worker reported |
| Send, call | A message that returns nothing; one whose sender waits for the result |
| Inbox item | One stop for a person, as a suspended request: approval, question or review |
| Routed task, fit check | A task routing filed; the model call that picks a delegate or vets a lead |
| Fallback, rounds | The delegate that takes a weak best-fit pick; sending routed answers back out |
| Workstream, lead | A piece of a project; the worker that runs it |
| Claim order, runner | Which ready task starts next; where the host runs work |

### Retired terms the refactor removes

Files mentioning each term on 2026-10-17, the last three rows 2026-10-19 (`git grep -l`): package source / docs (docs site,
`docs/architecture`, READMEs) / the rest (tests, apps, goals, labs). Reopen, answer a task and chief
of staff have many spellings, so they count case-insensitive substrings (`-i`). Other rows count
the listed identifiers as whole words (`-w`).

| Retired | Say | In code | Files |
| -- | -- | -- | -- |
| Post | Routed task | `onDelegatedPost`, `isPostRow`, `onPostSettled`, `postCancelled`; `postId`, `RoundPost` | 7 / 1 / 17; 6 / 2 / 21, 2 / 0 / 1 |
| Message entry; tool | `receive`; `sendMessage` | `onWorkerMessage`; `messageWorker` | 5 / 1 / 2; 7 / 4 / 5 |
| Park on a question; review park; a coding run's question inbox | Inbox item | `parkOnQuestion`, `parkedOnQuestion`; `awaitReview`, `unparkAndDrain`, `onReview`; `answerQuestion` | 8 / 4 / 15; 19 / 6 / 42; 2 / 3 / 5 |
| Message door | Steer | `parkedForTurn`, `messageDoor`, `harnessMessageDoor` | 9 / 2 / 5 |
| Reopen | Follow-up | `reopen*` | 26 / 12 / 56 |
| Answer a task | Answer the Inbox item | `answerTask*` | 3 / 6 / 23 |
| Relay; reply | None; `inReplyTo` | `workforceRelayTo`; `replyTo` | 1 / 0 / 0; 5 / 2 / 6 |
| Blocked | Cancel, or a dependency | `blockTask` | 2 / 2 / 12 |
| Removed task tools | `addTask`, `updateTask` | `dispatchTask`; `assignTask`; `failTask` | 14 / 9 / 62; 3 / 4 / 23; 2 / 2 / 13 |
| Split settle; split cancel; piece retry | A running task; cancel; attempts | `settleSplitTask`; `cancelSplitPieces`; `retryOf` | 1 / 0 / 0; 1 / 0 / 0; 6 / 0 / 5 |
| Own-state board | None, pruned | `delegationBoard` | 1 / 0 / 0 |
| Chief of staff | Shift Coordinator | `chief-of-staff`, `chiefOfStaff*`, prose | 23 / 8 / 101 |
| Dispatcher | Claim order; runner | `TaskDispatcher`; `FlowDispatcher` | 13 / 1 / 6; 11 / 2 / 10 |
| Self-assigned row | Plan row | `completeTask` | 2 / 3 / 14 |
| The `run` action | Respond | `"run"`, every flow's (an upper bound) | 26 / 21 / 364 |
| Run the task board | Dispatch | `runTaskBoard`; `RUN_BOARD_ENTRY` | 1 / 0 / 9; 6 / 0 / 0 |

## Decisions

Everything in the model above is decided by the owner, including:

- [x] **Drop `completeTask` (8 → 7 tools).** The drain or the claim gate settles every row.
- [x] **A deadline on every waited dispatch,** shaped like other waits'. It replaces the per-block
  timeout.
- [x] **Nested waits (rule 8),** bounded by the depth cap (5) and each wait's deadline, so a plan
  with a sub-agent can run inside a task its filer waits on.

Open:

- [ ] **Refusing a call into a waiting session (rule 10).** Once a resume takes its turn in line
  (FIX-2062), a waiting session no longer blocks a call, so the refusal may be unnecessary.
  Recommend revisiting once FIX-2062 lands.
- [ ] **Patterns' own task lists.** Recommend they become plans, drained in the request as they run
  now, and pruning phase 0's dead code.
- [ ] **Renames.** Recommend Shift Coordinator in code, "claim order" and "runner". The
  old worker id just stops working; nothing outside the repo uses it.
- [ ] **A separate entry for proposing work.** Punted. Found work rides on `sendMessage`, and the
  receiver classifies it. If that proves unreliable, add an optional hint the receiver may ignore,
  never authority.
- [ ] **Whether a worker filer hears of its task's questions.** It may answer them with
  `updateTask`. Recommend yes: the question starts its next request, as an ending does.

## Where today's code differs

Paths are relative to `packages/`. Each phase is one epic. Phase 0 blocks nothing; 2 needs 1; 3
needs 1 and 2; 4 runs beside 2 and 3; 5 goes last. Phase 2 also needs two fixes that apply to every
suspension, not only these: a resume taking its turn in the session (FIX-2062), and durable
execution by default on file-backed hosts (FIX-2063). Replay of a request suspended across a
deploy is a known risk, deferred.

| Phase | Target | Today |
| -- | -- | -- |
| 0 · Land | A request reads its own claim only | Fixed on the FIX-1047 branch, not on main (`orchestration/src/task-board/flow-policy-wiring.ts`) |
| 0 · Prune | Nothing the repo doesn't use, with its README and docs entries | Unused in the repo: `dispatchAndExecuteBlock` (`orchestration/src/tasks/helpers/dispatch-and-execute.ts`), the classifier and event claim orders, and fifo, a copy of the default (`orchestration/src/tasks/dispatchers/`). The own-state board has no production user (`orchestration/src/skills/task-tools-capability.ts:122`). Drain Pool is docs only (`apps/docs/docs/patterns/overview.md:69`) |
| 1 · One task | Routed tasks; attempts a setting | Posts have their own row kind and entries (`workforce/src/coordinator/delegated-post.ts`). Rounds, their deadlines, `routeOn` and settlement key on `postId` (`workforce/src/coordinator/coordinator-rounds.ts`, `coordinator-state.ts`, `coordinator-flow.ts`), so they move with it. Attempts are 2 for tasks (`workforce/src/conversation-board/board.ts:118`), 1 for posts |
| 1 · One task | `onTaskSettled` in orchestration, every ending delivered | Workforce owns it (`workforce/src/conversation-board/task-settled.ts`). A cancel owes a notice only when a request waits on the task (`orchestration/src/tasks/notice/task-notice.ts:100-102`) |
| 1 · One task | A plan and a delegation board, told apart by `wait` | No plan: one board per session, with no inline workers, dispatching every row (`workforce/src/conversation-board/board.ts:415-425`). The agent worker's `run` is skill matching then one generator, wrapped by `work` (`workforce/src/agent-worker-flow.ts:1190-1206`, `:1296-1360`). Patterns drain boards inline (`patterns/src/plan-and-execute/index.ts:716-724`, `parallelTasks/index.ts:127-135`, `supervisor/index.ts:370-378`). The assignee kind, not a setting, decides whether a drain waits (`orchestration/src/task-board/quiescence.ts`, header) |
| 1 · One task | A plan waits on a sub-agent; the dispatcher has `wait` | A drain never waits on a dispatched row (`orchestration/src/task-board/blocks/dispatch-row.ts`, header); a dispatcher never waits for a result (`core/src/blocks/dispatcher.ts:170`) |
| 1 · One task | An ending that makes a row startable runs `dispatch` | Only a retry runs the board; other endings wake the filer's turn or land as a line (`orchestration/src/tasks/notice/task-notice.ts:196-198`). A dependent starts on the next touch (`board.ts:578-589`) |
| 1 · One task | `respond`; `dispatch` | `run` (`agent-worker-flow.ts:1322`); `runTaskBoard` (`workforce/src/conversation-board/board-entries.ts:8`), the drain then `afterRun`'s resends (`board.ts:614-643`) |
| 1 · One task | A task's request may wait on a task it filed, up to 5 waits deep | Every task request is refused a wait (`orchestration/src/tasks/helpers/wait-for-response.ts:222-230`) |
| 1 · One task | A wait's deadline leaves the task running | It cancels the row (`orchestration/src/tasks/helpers/wait-for-response.ts`) |
| 1 · One task | Splits use delegates and stay running | Pieces go to any roster worker (`board.ts:280-296`). The parent parks until `settleSplitTask` (`workforce/src/conversation-board/split.ts`) |
| 1 · One task | Delegates are authority; `all` | Any worker with delegates can change them (`workforce/src/delegates/worker-delegates.ts`). No `all` |
| 1 · One task | One open task per session; another stays pending | A follow-up into a busy session is refused, not queued (`session_has_unfinished_task`, `orchestration/src/skills/task-tools-capability.ts:656-662`) |
| 1 · One task | Start: now, after named tasks, or held until `updateTask` | No held start. A filed task can be moved to `blocked` (`orchestration/src/tasks/schema/task-status.ts:15`), and `unblock` has no caller |
| 1 · One task | Cancelling, retrying or failing a task cancels its open tasks | Only cancelling a split task cascades to its pieces (`workforce/src/conversation-board/split.ts:341-361`) |
| 1 · One task | A failed or cancelled dependency cancels its dependents | A dependent waits for a `completed` dependency (`orchestration/src/tasks/collection/internal.ts:742-750`), and one that will never complete leaves it pending for good (`orchestration/src/task-board/blocks/board-meta.ts:245-274`) |
| 1 · One task | Seven tools; one fit call | Twelve task tools (`orchestration/src/skills/task-tools-capability.ts`) plus `messageWorker`. `unblock` has no caller (`orchestration/src/tasks/collection/state-backed.ts:695`). Two fit calls: best fit picks (`workforce/src/best-fit.ts`), lead fit only vets (`workforce/src/projects/lead-fit.ts`) |
| 2 · One Inbox | Every stop for a person is a suspension, with one answer path | Suspensions sit beside three row parks: the question park, the review park and a coding run's question inbox. The Inbox shows only `human_approval` and `human_input` suspensions (`shift-manager/src/lib/reads.ts:327`). Answers go through a resume, `answerTask` or `unparkAndDrain` (`orchestration/src/task-board/park-exit.ts`). `answerQuestion()` has no screen (`harness-manager/src/inbox.ts:257`) |
| 2 · One Inbox | The claim gate marks a suspended task waiting on a person; it keeps its claim | On a suspend the gate only stops renewing the claim (`orchestration/src/task-board/task-entry.ts:533-537`), so the row lapses and another worker runs it again. Boards are told to park the task instead (`orchestration/src/task-board/index.ts:1101-1129`) |
| 2 · One Inbox | A deadline resumes the block with `deadline`, and the flow decides | Every suspension has an `expiresAt` (`core/src/types/suspension.ts:83`), but only an approval acts on it, always as an expired rejection (`engine/src/durability/stop-suspended.ts`). A wait on a task times out separately, after 30 seconds to an hour (`orchestration/src/tasks/helpers/wait-for-response.ts:212-221`) |
| 2 · One Inbox | Cancelling a task resolves its suspension with `cancelled` | Stopping a suspended request resolves a wait on a task so the parked call can carry on (`stop-suspended.ts`); nothing on the board resolves a person's suspension |
| 2 · One Inbox | Stopping a suspended request closes its Inbox item and cancels its task | A stop of a person's suspension ends the turn `aborted` (`engine/src/durability/stop-suspended.ts`, header); the board isn't told |
| 2 · One Inbox | The claim survives a resume | Untested. The claim is set by the worker's first step (`orchestration/src/task-board/flow-policy-wiring.ts`, on the FIX-1047 branch) |
| 2 · One Inbox | A coding run's question suspends the coding flow's request; the answer starts the next run in the same coding session | The row parks, and the answer starts a new attempt that resumes the coding session (`harness-manager/src/door.ts:15-20`, `ask.ts:24-29`) |
| 3 · Into a task | `updateTask` with a message, one rule by status | Reopen (`workforce/src/conversation-board/reopen.ts`), a coding run's door (`harness-manager/src/door.ts`), `answerTask` |
| 4 · Messages | A call awaits the result, until its deadline | Dispatch waits only for acceptance (`engine/src/context/dispatch-operation.ts`). `messageWorker` has no `wait` (`workforce/src/messages/message-tool.ts`). The one bounded wait, on a task, takes a timeout of 30 seconds to an hour (`orchestration/src/tasks/helpers/wait-for-response.ts:212-221`) |
| 4 · Messages | `receive`, no relay; anyone on the roster; the landing rules | `onWorkerMessage` relays the final text (`workforce/src/messages/worker-message-entry.ts`). `takes_tasks_only` and `no_turn` refusals (`workforce/src/messages/send-message.ts:107`). Every message lands in the recipient's conversation (`send-message.ts:228`) |
| 4 · Messages | A server-set budget per request; call ids; a call into a waiting session refused | The count lives in a guarded user-scope exchange row (`workforce/src/messages/hop.ts`), carried to tasks by filing (`board.ts:396`). Messages can't wait. No call ids |
| 5 · Words | One term, one thing | The retired-terms table |
