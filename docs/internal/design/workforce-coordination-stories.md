# Workforce Coordination: User Stories

Each change the coordination model makes, written as a user story. This file sits between the
model in [workforce-coordination-concept.md](workforce-coordination-concept.md) and the backlog in
[workforce-coordination-gaps.md](workforce-coordination-gaps.md), so each story can become an
issue. Each table follows one part of the concept doc. The coverage check at the end ties every
gap row and retired term to a story.

**Who the stories are for**

- **User:** a person using Shift Manager or an app, such as Alice.
- **Flow author:** an engineer building a worker flow.
- **Worker:** an agent acting in the system, such as launch, writer, researcher or coder.

**How to read the columns.** *Acceptance* lists checks a test could make. *Replaces* names the old
story from the coordination inventory in quotes, a Shift Manager journey by its ID (J1 to J14), or
the mechanisms removed or reduced. *Phase* is the gaps file's phase.

## Tasks and boards

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| T-01 | As a worker, I want to work a task through a plan board (`mode: "plan"`, the default), whose drain waits on every row, so that each step can use the one before it. | writer's outline, draft, fact-check and tighten rows run inside one request. · The tighten row sees the fact-check's result. · A plan row never counts as the session's open task. | Self-assigned row (`completeTask`). One board per session that dispatches every row. "taskBoard inline drain" and "Inline composition" as separate forms | 1 |
| T-02 | As a worker, I want to dispatch a plan row to another session and wait for it, so that a big step gets its own session and I still get its result. | The fact-check row is dispatched to another session. · The claim gate around that session's task entry settles the row. · writer's drain waits until it has, then carries on with the result. | A drain that never waits on a dispatched row. A dispatcher block that never waits for a result | 1 |
| T-03 | As a flow author, I want patterns to stay plan boards, so that picking a pattern doesn't mean learning another board. | A pattern runs a fact-check and a link check at once, and the drain ends when both end. · planAndExecute, parallelTasks and supervisor keep their boards, which are plan boards, and return the same outputs. | Patterns' own task lists as a separate idea: "goalSeekLoop", "parallelTasks", "supervisor", "planAndExecute". The patterns themselves don't change | 1 |
| T-04 | As a manager worker, I want to file a task for a delegate and end my request, so that I hold nothing open while someone else works. | `addTask` puts researcher's task on writer's delegation board. · `dispatch` starts it in researcher's session and exits. · writer's request ends, and the task's ending later starts writer's next request. | "Start a task and hear when it ends" (`dispatchTask {goal}`). "Start a task written down earlier" (`addTask`, then `dispatchTask {taskId}`). Removed task tool `dispatchTask` | 1 |
| T-05 | As a worker, I want to wait on a task I filed, even while I work a task myself, so that I can use its result in the same request. | writer's plan row waits on researcher's task and resumes with its result. · A request working a task is allowed to wait. · Waits nest 5 deep; a sixth is refused. | "Start a task and wait for it in the same turn" (refused on task turns). Turn | 1 |
| T-06 | As a worker, I want a wait's deadline to resume me while the task keeps running, so that I can wait again or carry on without losing the work. | At the deadline, writer resumes with no result. · researcher's task is still running. · A second wait returns its result. | A wait's deadline cancelling the row. The fixed 30-second-to-one-hour wait timeout | 1 |
| T-07 | As a manager worker, I want every ending of a task I filed to reach me exactly once, so that nothing I filed goes quiet. | A done, a failed and a cancelled task each reach writer once. · A waiting request gets the ending; otherwise one `onTaskSettled` request starts. · A flow without Workforce gets `onTaskSettled` too. | "Hear how a task ended" (line only, line plus woken turn, silent run-board). A cancel reaching the filer only when a request waits. Line. Workforce owning `onTaskSettled` | 1 |
| T-08 | As a manager worker, I want a task to start now, after named tasks, or held until I release it, so that work runs in the order it needs. | "Chart it" starts only after "pull the CSV" ends. · A held task starts on `updateTask({ status: "pending" })`, and not before. · `updateTask({ status: "held" })` holds a pending task. · A task held on questions doesn't start on release until its last answer. · Any other `status` is refused. · A plan row that finishes a step can release a held delegated task. | "Block a task" (`blockTask`, the blocked status, `unblock` with no caller). "Write a task down without starting it" (`undispatched`, readied only by `dispatchTask {taskId}`) | 1 |
| T-09 | As a manager worker, I want a dependency on another board refused at filing, so that no task waits forever on a task it can't see. | `addTask` naming a task on another board is refused. · Crossing boards works through a wait or a held task. | A dependency id from another board that never resolves, leaving the row pending for good | 1 |
| T-10 | As a manager worker, I want a failed or cancelled task to cancel its dependents, so that nothing waits on work that will never finish. | "Pull the CSV" fails, and "chart it" is cancelled. · writer hears both endings once. | A dependent waiting for a `completed` dependency and staying pending for good | 1 |
| T-11 | As a manager worker, I want my task to stay running while the tasks it filed are open, so that I can break work up without settling it by hand. | writer files three tasks and ends its request; its task shows running with no request on it. · It is done when a request for it ends with none open. · The tasks it files go to delegates only. | "Split a task into pieces": split settle (`settleSplitTask`), a split's `{ answer, pieces }` result, the parent parking. Pieces reaching any roster worker | 1 |
| T-12 | As a filer, I want cancelling, retrying or failing a task to cancel the tasks it filed, so that no orphan keeps running. | Cancelling writer's task cancels researcher's open task. · A retry and a final failure do the same. | "Ending a split task cancels its pieces": split cancel (`cancelSplitPieces`), the only cascade today | 1 |
| T-13 | As a manager worker, I want a second task for a busy session to wait its turn, so that I don't have to retry it. | A follow-up into researcher's busy session stays pending, then starts when the open task ends. · Plan rows don't count as open. | The `session_has_unfinished_task` refusal | 1 |
| T-14 | As a manager worker, I want to choose where a task runs (a new session, the assignee's ongoing one, or an earlier task's), so that the assignee remembers what it needs. | A follow-up runs in the earlier task's session. · Filed while that task is open, it starts when that task ends. · An ongoing-session task runs in the delegate's session for this conversation. | "Follow-up task in the same session" (`followUpOf`, root must have finished). Five session kinds per worker ("Where talk lands") | 1 |
| T-15 | As a manager worker, I want to set a task's attempts at filing, so that flaky work gets more tries and costly work fewer. | With attempts 3, the task fails after its third failed run. · The default is 2, and a routed task gets 1. | "Automatic second attempt" (fixed at 2, posts 1). "File a failed task again". "Retry a failed piece": piece retry (`retryOf`) | 1 |
| T-16 | As a manager worker, I want a task's ending recorded only by the request working it, so that no one settles work by hand. | No tool completes or fails a task. · A filer that no longer wants a task cancels it. | "Filer completes or fails a task itself": removed task tool `failTask`, and `completeTask` | 1 |
| T-17 | As a filer, I want to edit a task until it starts, so that I can fix its brief or order without cancelling it. | On a pending or held task, `updateTask` changes `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata` and `maxAttempts`. · A `deps` entry on another board, or one that makes a cycle, is refused. · Any field edit on a running, waiting or finished task is refused. · The session and result settings, `wait`, `followUpOf`, attempts used, the run link and the sealed payload are never editable. | Today's `updateTask` patch (`priority`, `metadata`, `assignee`, a label, in any state). "Change a task's details" | 1 |
| T-18 | As a worker, I want to read only the claim for the task my request works, so that I never record another task's ending. | Two requests working tasks side by side each read their own claim. · A request working no task reads none. | A claim read from a slot shared across requests | 0 |
| T-19 | As a flow author, I want a board's `mode` to decide whether its drain waits, and a board built wrong refused when built, so that I find out before a task gets stuck. | A board's `mode` defaults to `"plan"`. · A `mode: "delegation"` board with an inline assignee is refused. · A `mode: "plan"` board with a dispatcher that doesn't wait is refused. | The assignee kind deciding whether a drain waits. "Board assignee that dispatches" as its own form | 1 |
| T-20 | As a filer, I want one way to send a message into a task once it starts, so that steering, answering and continuing work the same. | `updateTask({ id, message })` on a running task steers it; no attempt is used. · On a task waiting on a person, it answers. · On a finished task, a follow-up runs in the same session with fresh attempts. · A message on a task that hasn't started is refused; edit it instead. · The model has no separate steer tool. | Reopen (`reopen*`, "Reopen a finished task by messaging its session"). Message door (`messageDoor`, `parkedForTurn`). Answer a task (`answerTask*`). J10 | 3 |
| T-21 | As a user, I want a steer to a running coding run to stop the run and continue the same coding session with my message, so that I can redirect it without losing its context. | The current coding run stops. · The next run starts in the same coding session, carrying the message. · No attempt is used. | "A person talks to a running coding run" (`harnessMessageDoor`, the row parked for a turn) | 3 |
| T-22 | As a flow author, I want a worker block only to return or throw, and whoever ran it to settle its row, so that no worker settles its own work. | An inline row whose worker returns is done, and one whose worker throws is retried or failed, both settled by the plan board's drain. · A dispatched row is settled by the claim gate around the child's task entry. · On a plan board the drain waits until the gate settles the row, then carries on. · A worker block has no way to settle a row. | Nothing removed: the drain's recorders (`orchestration/src/task-board/index.ts`, header) and the claim gate (`orchestration/src/task-board/blocks/dispatch-row.ts`, header) already settle this way; the story pins it as a rule | 1 |
| T-23 | As a flow author, I want a goal-seek loop over a delegation board refused when built, so that its judge never rules on work still in flight. | `goalSeekLoop` over a `mode: "delegation"` board is refused when built. · Over a plan board, the judge sees every row ended. · A `continue` never spends an iteration on rows running elsewhere. | `goalSeekLoop` not checking its board's assignees, so over a board that dispatches without waiting each `continue` exits at once, up to `maxIterations` | 1 |
| T-24 | As a manager worker, I want to reassign a task only before it starts, so that a running task keeps one accountable worker. | `updateTask({ assignee })` moves a pending or held task to another of writer's delegates. · An assignee who isn't one of writer's delegates is refused. · On a running task it is refused; writer cancels it and files it again. | "Give a task to another delegate": removed task tool `assignTask` (any unfinished task, running included, on a board that doesn't dispatch), `dispatchTask {taskId, assignee}` | 1 |

## Messages

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| M-01 | As a worker, I want to message any worker on my roster, delegate or not, so that I can talk without owing work. | researcher's message reaches coder, who isn't its delegate. · A worker that only takes tasks still receives it. · A message to Bob's researcher is refused. | "Message another worker" (`messageWorker`, the message tool). The `takes_tasks_only` and `no_turn` refusals | 4 |
| M-02 | As a worker, I want to call a worker and wait for its result until a deadline, so that I can use the answer in the same request. | writer calls coder and gets "yes" as the call's result. · Past the deadline, writer resumes without it. · Waiting again or repeating the call returns the late result kept under its call id. | J12. Dispatch that waits only for acceptance. Messages that can't wait | 4 |
| M-03 | As a worker, I want only a call to bring a result back, so that nothing I say is passed on for me. | A send's recipient's final text goes nowhere unless it sends one. | "Auto-relay a woken turn's final text": relay (`workforceRelayTo`) | 4 |
| M-04 | As a worker, I want my answer to a message to land in the session that sent it, so that it arrives with the work it's about. | An answer with `inReplyTo` lands in the sending session. · If that session's task has ended, it lands in the sender's conversation. | "Reply to a message": reply (`replyTo`, `answerTo`) | 4 |
| M-05 | As a worker, I want a message to the worker that filed my task to land in the session that filed it, so that my filer sees it beside the work. | researcher's message to writer lands in writer's task session. · Any other message lands in the recipient's conversation with this user. | Every message landing in the recipient's conversation | 4 |
| M-06 | As a flow author, I want every message to arrive at one entry, `receive`, with the sender, whether it waits, and the budget set by the server, so that a message can't lie about who sent it. | Each message starts a new `receive` request. · A sender written into the message body is ignored. | Message entry (`onWorkerMessage`) | 4 |
| M-07 | As a worker, I want a message to a busy worker queued and a call into a waiting session refused, so that two waits never block each other. | A message to a busy coder runs after its current request. · A call into a session that is waiting is refused with a reason. | New | 4 |
| M-08 | As a user, I want message budgets set by the server, so that workers can't message each other in a loop. | A request's fourth message is refused. · The seventh across one typed message's requests is refused. · A held task the board starts gets a fresh budget. | The hop count in a user-scope exchange row, carried by filing ("hop 6, 3 per turn") | 4 |

## Stopping for a person

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| I-01 | As a user, I want every stop for a person in my Inbox, so that I never hunt for a question in a chat. | An approval, a question, a review, a task held on questions and a coding run's question each show as one Inbox item. · Each can be answered from the Inbox. | "Shift Manager Inbox" (only `human_approval` and `human_input`). J9. J11. Park as a word for a stop | 2 |
| I-02 | As a manager worker, I want to file a task held on questions known up front, so that the user answers before the work starts. | launch files coder's task held on "Which CSV export?", and it shows in Alice's Inbox at once. · Each answer joins the brief, and the last one starts the task. · Its dependents wait too, and cancelling it closes the item. | New. The nearest thing is an `undispatched` row | 2 |
| I-03 | As a worker, I want to stop midway with `waitForUser` and carry on from the same step, so that an answer doesn't restart my work. | researcher asks "Which region?" and suspends. · Alice's answer resumes the same request and the same attempt. | "Task stops on a question; filer answers": park on a question (`parkOnQuestion`, `parkedOnQuestion`), answer a task (`answerTask`), `input.answer`. "Free-form input" | 2 |
| I-04 | As a user, I want reviews to stop the same way as approvals, and only me to answer either, so that sign-off stays mine. | writer's review request shows as an Inbox item. · A filer answering an approval or review is refused. · A filer may answer a question, unless the task is routed. | "Review park" (`awaitReview`, `unparkAndDrain`, `onReview`, `input.feedback`). The EM ask door. J4. J8 | 2 |
| I-05 | As a manager worker, I want a task waiting on a person to keep its claim, so that no other worker runs it again. | The row shows "waiting on a person". · No second run starts, however long the wait. · The resumed request still holds the claim. | The claim gate stopping renewal on a suspend, so the row lapses. Boards told to park the task | 2 |
| I-06 | As a flow author, I want a stop's deadline to resume my block with `deadline`, so that my flow decides what happens. | The block resumes with a `deadline` outcome and can go ahead, end, or check in again. · Unhandled, an approval counts as rejected, and a question or review errors and uses an attempt. | Only approvals acting on `expiresAt`, always as an expired rejection | 2 |
| I-07 | As a user, I want cancelling a task to close its Inbox item, so that I'm not asked about dead work. | The suspension resumes as `cancelled`. · The Inbox item goes away. · Nothing the block returns is recorded. | Nothing on the board resolving a person's stop | 2 |
| I-08 | As a user, I want stopping a suspended request to close its item and cancel its task, so that the board matches what I see. | The item closes. · The task it works is cancelled, and its filer hears once. | A stop that ends the turn `aborted` and never tells the board | 2 |
| I-09 | As a user, I want a coding run's question in my Inbox, and my answer to start the next run in the same coding session, so that I can unblock coding work like any other. | The question ends the run and the coding flow's request suspends. · Alice's answer resumes that request on the same attempt. · The next run continues the same coding session. | "A coding run asks a question": a coding run's question inbox (`answerQuestion`, with no screen), the claim-board question park, the fixed-board inbox row | 2 |
| I-10 | As a user, I want a stop to survive a restart and resume in its turn in the session, so that my answer is never lost or run alongside other work. | A request suspended before a restart carries on after Alice answers. · The resume runs after any request already running in that session. · A host without durable execution refuses a stop instead of losing it. | Stopping for a person on a host without durable execution | 2 |
| I-11 | As a manager worker, I want to hear when a task I filed stops on a question, so that I can answer it if I'm allowed. | researcher's question starts writer's next request. · writer's answer resumes researcher's request. | The "waits on you" line in the filer's chat, relayed through `answerTask` (J11) | 2 (open decision) |

## Routing

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| R-01 | As a user, I want a coordinator's routed work to be an ordinary task, so that I can see, steer and cancel it like any other. | Alice's message to launch files a routed task on launch's delegation board. · Its session is writer's ongoing one, its result goes to the conversation, and it gets 1 attempt. · It shows in Alice's tasks and can be cancelled. | "Hand a post to a delegate". Post (`onDelegatedPost`, `isPostRow`, `onPostSettled`, `postCancelled`, `dispatchTask {post:true}`). J2 | 1 |
| R-02 | As a user, I want a routed task's result in my conversation with the coordinator, under the delegate's name, so that I read every answer in one place. | writer's draft lands in Alice's conversation with launch, under writer's name. · Work writer files for others comes back to writer first. | "Route a message by the coordinator's judgment" (the delegate's line). J1 | 1 |
| R-03 | As a user, I want rounds to send each routed answer back out, so that delegates can build on each other. | With everyone and 2 rounds, launch files three routed tasks, then sends each answer back out. · A round's deadline resolves by task id. | "Delegates answer each other in rounds", keyed on post ids (`postId`, `RoundPost`) | 1 |
| R-04 | As a user, I want one fit check that picks a delegate for best fit and vets a workstream lead, so that both judge fit the same way. | Best fit picks researcher, and a weak pick goes to the fallback. · Opening a workstream with writer as lead runs the same check. | "Route a message by best fit" and the lead-fit check, two model calls for one job | 1 |
| R-05 | As a user, I want asks in a workstream routed to the lead's ongoing session, so that the lead keeps the workstream's context. | Alice's ask in the pricing-page workstream becomes a routed task in writer's ongoing session. | "Project coordinator hands an ask to a workstream" (`post:true` plus `target`). J6. J7 | 1 |
| R-06 | As a worker, I want to message any coordinator, whatever its routing, so that I can reach it directly. | A message to a round-robin or everyone coordinator starts its own `receive` request and isn't routed. | "Route round-robin" and "Hand each message to everyone" ("can't receive messages") | 4 |

## Chain of command

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| C-01 | As a user, I want a worker to file tasks only with its delegates, or anyone with `all`, so that I decide who gives work to whom. | writer filing a task for coder, not its delegate, is refused. · With `delegates: all`, any roster worker can take it, the worker itself included. · Bob's researcher is never reachable. | Tasks reaching any roster worker. "Default to the only delegate" (two code paths) | 1 |
| C-02 | As a user, I want to be the only one who changes a worker's delegates, unless I set a coordinator to change its own, so that a worker can't widen its own reach. | writer calling `addDelegate` is refused. · launch, configured to change its own, succeeds. | "Manage a conversation's delegates" (any worker with `delegates:`). J5 | 1 |
| C-03 | As a worker, I want to ask the filer above for work I can't file, by message, so that someone with the authority files it. | researcher messages writer, and writer messages launch. · launch files coder's task. · The script comes back down as follow-ups, to writer and then to researcher. | "Message another worker, when it asks for work" | 1, 4 |
| C-04 | As a manager worker, I want work my assignee reports finding to become a sibling task I file, so that its task stays the job it was given. | researcher describes found work in a message and carries on. · writer files a sibling beside researcher's task. | Splits filing work outside the task from inside it | 1 |
| C-05 | As a user, I want found work my worker spots to wait for my approval, so that nothing new starts without me. | writer's evaluator flags a request for work and files it held. · Alice releases it or cancels it. | New | 1 |

## The worker contract

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| W-01 | As a flow author, I want to declare my worker's roles and have the hire check each role's entries, so that a broken worker is refused at hire, not mid-task. | A contributor without `work` is refused. · An entry that refuses its input is refused. · `receive` joins the check in phase 4. | A contract that checks only configuration, one door and attribution. "Make a custom flow a delegate" (takes posts, tasks, both or nothing; skip refusals) | 1 |
| W-02 | As a flow author, I want each role's entries, tools and session state from one factory, so that I spread one thing per role into my flow. | A flow built from the manager factory passes the hire as a manager. · No entry has to be wired by hand. | Kit (filing kit, session kit). Entries arriving through separate opt-in pieces | 1 |
| W-03 | As a worker, I want seven tools for tasks, messages and stops, so that I always know which one to reach for. | The model sees `addTask`, `updateTask`, `cancelTask`, `listTasks`, `readTask`, `sendMessage` and `waitForUser`, plus `listDelegates`. · Only a configured coordinator also sees `addDelegate`, `removeDelegate` and `setFallback`. | Twelve task tools. Removed task tools (`dispatchTask`, `assignTask`, `failTask`). `messageWorker`. `unblock` | 1 |
| W-04 | As a flow author, I want entries named for what starts them, so that a flow reads plainly. | A flow takes a user's message on `respond` and a board pass on `dispatch`. · No flow has a `run` action. | The `run` action. Run the task board (`runTaskBoard`, `RUN_BOARD_ENTRY`) | 1 |

## Reliability

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| F-01 | As a user, I want everything a board owes paid even after a crash, so that no work waits on someone touching the board. | The server restarts just after researcher finishes, and writer still hears, soon after the due time. · The sweeper wakes at the earliest due time, not on a 10-minute interval. | Debts paid only by the board's next touch. "Hear how a task ended" (dedupe and resend). `afterRun`'s resends | 1 |
| F-02 | As a manager worker, I want a row to start as soon as anything makes it startable, so that work never sits ready and idle. | A dependent starts within seconds of its dependency ending, with no read of the board. · The same holds after a filing, a start, an answer or a retry. | Only a retry running the board. A dependent starting on the next touch. The silent run-board notice | 1 |
| F-03 | As a flow author, I want a second `dispatch` in a session rejected while one runs, so that two passes never start the same row twice. | A second `dispatch` during a pass is rejected. · A row made startable during the pass still starts, because the pass checks for startable rows last. · If the pass dies first, the sweeper starts the row when due. | Run the task board (`runTaskBoard`) and its overlapping resends | 1 |
| F-04 | As a manager worker, I want a task's failure delivered to me like any other ending, so that I decide what to do about it. | A final failure reaches writer once, with the error. · No separate error-report record is written. | "Failed tasks go to the Error Reporter" (the `reportOwed` marker, its outbox and 5-minute resend). The error-report debt | 1 |
| F-05 | As a user, I want the Error Reporter to be an ordinary worker a filer messages, so that issues are filed only when someone chooses to report. | writer messages the Error Reporter about a failure, and it drafts an issue. · Alice reviews the draft from her Inbox. · A failure alone never reaches the Error Reporter. | "Error Reporter files issues" by an automatic route. J13 | 1 |

## Scheduling

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| S-01 | As a user, I want recurring work to arrive as an ordinary task, so that it retries, reports and cancels like any other. | Each Monday, a schedule files "refresh the adoption numbers" on launch's board. · Its ending reaches launch once. · Alice can cancel it like any task. | "Schedules (cron)" starting a request outside the task model | 1 |
| S-02 | As a user, I want my scheduled-work list to show my schedules, so that I can see what will run and when. | The list reads Alice's schedule collection and shows each schedule's next run, worked out from its cron and time zone. · A schedule she adds or removes shows up there. | New | 1 |
| S-03 | As a flow author, I want a scheduled action to fire at most once per scheduled time, so that a restart or a second host never files the same work twice. | Two hosts and a restart produce one firing per scheduled time. | New. Two cron paths with no shared guarantee | 1 |

## Screens

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| U-01 | As a user, I want to cancel a task, release a held task, and answer held questions from a screen, so that I run my board without asking a worker. | A screen calls the public task actions with Alice's authority, and each has the tool's effect. · A call as another user is refused. · Identity comes from the server, never from the request body. | "An app drives the board through actions" (11 `<tool>_tasks` actions, no claim, the `no_delegation_board` answer). "Board capability and actions". Interrupt (J10) | 1 |
| U-02 | As a user, I want typing in a task's session to do what `updateTask` does, so that the composer has one meaning. | Alice's text steers writer's running task, answers it if it's waiting, or runs a follow-up if it has finished. | "A person chats with a worker" (a composer that reopens, steers or answers depending on the session) | 3 |

## Words and pruning

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| V-01 | As a flow author, I want nothing in the packages the repo doesn't use, so that I never build on a dead path. | The listed code is gone, along with its README and docs entries. · The repo's tests pass. | "Hand-rolled claim loops" (`dispatchAndExecuteBlock`, `taskLoopBack`). The classifier, event and fifo claim orders. Own-state board (`delegationBoard`). "Drain Pool" | 0 |
| V-02 | As a flow author, I want one name for one thing across code, docs and UI, so that I can trust a word to mean what it says. | `git grep` finds no retired identifier from the gaps file's table. · Dispatcher names only the block. | Turn, line, park, post, reply, relay, reopen, blocked, pieces. Dispatcher for four things (`TaskDispatcher` becomes claim order, `FlowDispatcher` becomes runner). Kit | 5 |
| V-03 | As a user, I want the Shift Coordinator called that everywhere, so that the UI, routes and code agree. | No route, worker id or code name says chief of staff. · The old worker id stops working. | Chief of staff (`chief-of-staff`, `chiefOfStaff*`, `/cos`) | 5 (open decision) |

## Coverage check

**Gap rows without a story:** none. **Retired terms without a Replaces cell:** none. All five new
decisions have stories: recurring work (S-01 to S-03), error reports (F-04, F-05), steering a coding
run (T-21), board controls on screens (U-01) and duplicate `dispatch` (F-03). So do the board
decisions: `mode` (T-01, T-19), patterns as plan boards (T-03), who settles a row (T-22) and the
goal-seek loop's plan board (T-23). So does `updateTask` by phase: edit before it starts (T-17),
hold or release (T-08), steer or answer once started (T-20), and reassign before start only (T-24).

<details>
<summary><b>Gap row to story map</b>: each row of "where today's code differs", with its stories</summary>

| Phase | Target | Stories |
| -- | -- | -- |
| 0 | A request reads its own claim only | T-18 |
| 0 | Nothing the repo doesn't use | V-01 |
| 1 | Routed tasks; attempts a setting | R-01, R-03, T-15 |
| 1 | `onTaskSettled` in orchestration, every ending delivered | T-07 |
| 1 | Every debt has a due time; the sweeper pays it | F-01 |
| 1 | A plan board and a delegation board, told apart by `mode` | T-01, T-03, T-19 |
| 1 | A plan board waits on a dispatched row; the dispatcher has `wait` | T-02, T-22 |
| 1 | A goal-seek loop needs a plan board | T-23 |
| 1 | An ending that makes a row startable runs `dispatch` | F-02 |
| 1 | `respond`; `dispatch` | W-04 |
| 1 | A task's request may wait, 5 deep | T-05 |
| 1 | A wait's deadline leaves the task running | T-06 |
| 1 | Splits use delegates and stay running | T-11, C-04 |
| 1 | Delegates are authority; `all` | C-01, C-02 |
| 1 | One open task per session | T-13 |
| 1 | Start: now, after, or held | T-08 |
| 1 | `updateTask` by phase; reassigning a running task is cancel and refile | T-08, T-17, T-24 |
| 1 | A dependency stays within one board | T-09 |
| 1 | Cancelling, retrying or failing cancels open tasks | T-12 |
| 1 | A failed or cancelled dependency cancels dependents | T-10 |
| 1 | Seven tools; one fit call | W-03, R-04 |
| 1 | Roles declared; the hire checks entries | W-01, W-02 |
| 2 | Every stop is one Inbox item, one answer path | I-01, I-03, I-04 |
| 2 | Held on questions | I-02 |
| 2 | A suspended task keeps its claim | I-05 |
| 2 | A deadline resumes the block with `deadline` | I-06 |
| 2 | Cancelling a task resolves its suspension | I-07 |
| 2 | Stopping a suspended request closes its item and cancels its task | I-08 |
| 2 | The claim survives a resume | I-05 |
| 2 | A coding run's question suspends; the answer starts the next run | I-09 |
| 3 | Once started, `updateTask` only delivers a message | T-20, U-02 |
| 4 | A call awaits its result; a late result is kept under its call id | M-02 |
| 4 | `receive`, no relay; anyone on the roster; landing rules | M-01, M-03, M-04, M-05, M-06, R-06 |
| 4 | A server-set budget; call ids; a call into a waiting session refused | M-07, M-08 |
| 5 | One term, one thing | V-02, V-03 |

</details>

<details>
<summary><b>Retired term to story map</b>: each row of the retired-terms table, with the stories that name it</summary>

| Retired | Stories |
| -- | -- |
| Post | R-01, R-03, W-01 |
| Message entry; tool | M-06; M-01, W-03 |
| Park on a question; review park; a coding run's question inbox | I-03; I-04; I-09 |
| Message door | T-20, T-21 |
| Reopen | T-20 |
| Answer a task | T-20, I-03 |
| Relay; reply | M-03; M-04 |
| Blocked | T-08 |
| Removed task tools | T-04, T-16, T-24, W-03 |
| Split settle; split cancel; piece retry | T-11; T-12; T-15 |
| Own-state board | V-01 |
| Chief of staff | V-03 |
| Dispatcher (claim order; runner) | V-01, V-02 |
| Self-assigned row | T-01, T-16 |
| Kit | W-02, V-02 |
| The `run` action | W-04 |
| Run the task board | W-04, F-03 |

</details>
