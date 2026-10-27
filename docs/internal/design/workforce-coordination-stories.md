# Workforce Coordination: User Stories

A pre-filing aid for FIX-2056's child issues: each change the coordination model makes, written as a
user story, between the model in [workforce-coordination-concept.md](workforce-coordination-concept.md)
and the backlog in [workforce-coordination-gaps.md](workforce-coordination-gaps.md). It is frozen once
those issues exist. Each issue's spec carries the full acceptance criteria and links the concept doc
rather than copying it. Each table follows one part of the concept doc; the coverage check at the end
ties every gap row and retired term to a story.

**Who the stories are for**

- **User:** a person using Shift Manager or an app, such as Alice.
- **Flow author:** an engineer building a worker flow.
- **Worker:** an agent acting in the system, such as launch, writer, researcher or coder.

**How to read the columns.** *Acceptance* lists checks a test could make. *Replaces* names the old
story from the coordination inventory in quotes, a Shift Manager journey by its ID (J1 to J14), or
the mechanisms removed or reduced. *Phase* is the gaps file's phase.

The Replaces column's quoted names and journey IDs refer to the appendix,
[Today's use cases (the inventory)](#todays-use-cases-the-inventory), at the end of this file.

## Tasks and boards

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| T-01 | As a worker, I want to work a task through a plan board (`mode: "plan"`, the default), whose drain waits on every row, so that each step can use the one before it. | writer's outline, draft, fact-check and tighten rows run inside one request. · The tighten row sees the fact-check's result. · A plan row never counts as the session's open task. | Self-assigned row (`completeTask`). One board per session that dispatches every row. "taskBoard inline drain" and "Inline composition" as separate forms | 1 |
| T-02 | As a worker, I want to dispatch a plan row to another session and wait for it, so that a big step gets its own session and I still get its result. | The fact-check row is dispatched to another session. · The claim gate around that session's task entry settles the row. · writer's drain waits until it has, then carries on with the result. | A drain that never waits on a dispatched row. A dispatcher block that never waits for a result | 1 |
| T-03 | As a flow author, I want patterns to stay plan boards, so that picking a pattern doesn't mean learning another board. | A pattern runs a fact-check and a link check at once, and the drain ends when both end. · planAndExecute, parallelTasks and supervisor keep their boards, which are plan boards, and return the same outputs. | Patterns' own task lists as a separate idea: "goalSeekLoop", "parallelTasks", "supervisor", "planAndExecute". The patterns themselves don't change | 1 |
| T-04 | As a manager worker, I want to file a task for a delegate and end my request, so that I hold nothing open while someone else works. | `createTask` puts researcher's task on writer's delegation board. · `dispatch` starts it in researcher's session and exits. · writer's request ends, and the task's ending later starts writer's next request. | "Start a task and hear when it ends" (`dispatchTask {goal}`). "Start a task written down earlier" (`addTask`, then `dispatchTask {taskId}`). Removed task tool `dispatchTask`. `addTask`, renamed `createTask` | 1 |
| T-05 | As a worker, I want to wait on a task I filed, even while I work a task myself, so that I can use its result in the same request. | writer's plan row waits on researcher's task with `getTask({ id, wait: true, deadline? })` and resumes with its result. · A request working a task is allowed to wait. · Waits nest 5 deep, apart from the task tree's 5; a sixth wait is refused. | "Start a task and wait for it in the same turn" (refused on task turns). Today's `dispatchTask({ wait })`. Turn | 1 |
| T-06 | As a worker, I want a wait's deadline to resume me while the task keeps running, so that I can wait again or carry on without losing the work. | At the deadline, writer resumes with no result. · researcher's task is still running. · A second wait returns its result. | A wait's deadline cancelling the row. The fixed 30-second-to-one-hour wait timeout | 1 |
| T-07 | As a manager worker, I want every ending of a task I filed to reach me exactly once, so that nothing I filed goes quiet. | A done, a failed and a cancelled task each reach writer once. · A waiting request gets the ending; otherwise one `onTaskSettled` request starts. · A flow without Workforce gets `onTaskSettled` too. | "Hear how a task ended" (line only, line plus woken turn, silent run-board). A cancel reaching the filer only when a request waits. Line. Workforce owning `onTaskSettled` | 1 |
| T-08 | As a manager worker, I want a task to start now, after named tasks, or held until I release it, so that work runs in the order it needs. | "Chart it" starts only after "pull the CSV" ends. · A held task starts on `updateTask({ status: "pending" })`, and not before. · Once the task starts, a hold or release is refused. | "Block a task" (`blockTask`, the blocked status, `unblock` with no caller). "Write a task down without starting it" (`undispatched`, readied only by `dispatchTask {taskId}`) | 1 |
| T-09 | As a manager worker, I want a dependency on another board refused at filing, so that no task waits forever on a task its board never hears from. | `createTask` naming a task on another board is refused. · Crossing boards works through a wait or a held task. | A dependency id from another board that never resolves, leaving the row pending for good | 1 |
| T-10 | As a manager worker, I want a failed or cancelled task to cancel its dependents, so that nothing waits on work that will never finish. | "Pull the CSV" fails, and "chart it" is cancelled. · writer hears both endings once. | A dependent waiting for a `completed` dependency and staying pending for good | 1 |
| T-11 | As a manager worker, I want my task to stay running while the tasks it filed are open, so that I can break work up without settling it by hand. | writer files three tasks and ends its request; its task shows running with no request on it. · It is done when a request for it ends with none open. · The tasks it files go to delegates only. | "Split a task into pieces": split settle (`settleSplitTask`), a split's `{ answer, pieces }` result, the parent parking. Pieces reaching any roster worker | 1 |
| T-12 | As a filer, I want cancelling, retrying or failing a task to cancel the tasks it filed, so that no orphan keeps running. | Cancelling writer's task cancels researcher's open task. · A retry and a final failure do the same. | "Ending a split task cancels its pieces": split cancel (`cancelSplitPieces`), the only cascade today | 1 |
| T-13 | As a manager worker, I want a second task for a busy session to wait its turn, so that I don't have to retry it. | A follow-up into researcher's busy session stays pending, then starts when the open task ends. · Plan rows don't count as open. | The `session_has_unfinished_task` refusal | 1 |
| T-14 | As a manager worker, I want to choose where a task runs (a new session, the assignee's ongoing one, or an earlier task's), so that the assignee remembers what it needs. | A follow-up runs in the earlier task's session. · Filed while that task is open, it starts when that task ends. · An ongoing-session task runs in the delegate's session for this conversation. | "Follow-up task in the same session" (`followUpOf`, root must have finished). Five session kinds per worker ("Where talk lands") | 1 |
| T-15 | As a manager worker, I want to set a task's attempts at filing, so that flaky work gets more tries and costly work fewer. | With attempts 3, the task fails after its third failed attempt. · Each retry goes back to pending and runs in the task's session. · The default is 2 (one retry), and a routed task gets 1 (no retry). | "Automatic second attempt" (fixed at 2, posts 1). "File a failed task again". "Retry a failed piece": piece retry (`retryOf`) | 1 |
| T-16 | As a manager worker, I want a task's ending recorded only by the request working it, so that no one settles work by hand. | No tool completes or fails a task. · A filer that no longer wants a task cancels it. | "Filer completes or fails a task itself": removed task tool `failTask`, and `completeTask` | 1 |
| T-17 | As a filer, I want to edit a task until it starts, so that I can fix its brief or order without cancelling it. | On a pending or held task, `updateTask` changes `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata` and `maxAttempts`. · Any field edit on a running, waiting or finished task is refused, naming its rule: "goal can't change after a task starts; steer it instead". · A `deps` entry on another board, or one that makes a cycle, is refused. | Today's `updateTask` patch (`priority`, `metadata`, `assignee`, a label, in any state). "Change a task's details" | 1 |
| T-18 | As a worker, I want to read only the claim for the task my request works, so that I never record another task's ending. | Two requests working tasks side by side each read their own claim. · A request working no task reads none. | A claim read from a slot shared across requests | 0 |
| T-19 | As a flow author, I want a board's `mode` to decide whether its drain waits, and a board built wrong refused when built, so that I find out before a task gets stuck. | A board's `mode` defaults to `"plan"`. · A `mode: "delegation"` board with an inline row is refused. · A `mode: "plan"` board with a dispatcher set to `wait: false` is refused, as is a delegation board with one set to `wait: true`. | The assignee kind deciding whether a drain waits. "Board assignee that dispatches" as its own form | 1 |
| T-20 | As a filer, I want one way to send a message into a task until it finishes, so that briefing, steering and answering work the same. | `updateTask({ id, message })` on a pending or held task joins its brief. · A running request takes it at its next step, and a suspended one when it resumes; no attempt is used, and the task isn't cancelled. · On a task held on a question the filer may answer, it is the answer. | Message door (`messageDoor`, `parkedForTurn`). Answer a task (`answerTask*`). J10 | 3 |
| T-21 | As a user, I want a steer to a running coding run to end the run and continue the same coding session with my message, so that I can redirect it without losing its context. | The current coding run ends; the coding flow's request carries on. · The next run starts in the same coding session, carrying the message. · No attempt is used. | "A person talks to a running coding run" (`harnessMessageDoor`, the row parked for a turn) | 3 |
| T-22 | As a flow author, I want a worker block only to return or throw, and whoever ran it to settle its row, so that no worker settles its own work. | An inline row whose worker returns is done, and one whose worker throws is retried or failed, both settled by the plan board's drain. · A dispatched row is settled by the claim gate around the child's task entry, and the drain waits until it is. · A worker block has no way to settle a row. | Nothing removed: the drain's recorders (`orchestration/src/task-board/index.ts`, header) and the claim gate (`orchestration/src/task-board/blocks/dispatch-row.ts`, header) already settle this way; the story pins it as a rule | 1 |
| T-23 | As a flow author, I want a goal-seek loop over a delegation board refused when built, so that its judge never rules on work still in flight. | `goalSeekLoop` over a `mode: "delegation"` board is refused when built. · Over a plan board, the judge sees every row ended. · A `continue` never spends an iteration on rows running elsewhere. | `goalSeekLoop` not checking its board's assignees, so over a board that dispatches without waiting each `continue` exits at once, up to `maxIterations` | 1 |
| T-24 | As a manager worker, I want to reassign a task only before it starts, so that a running task keeps one accountable worker. | `updateTask({ assignee })` moves a pending or held task to another of writer's delegates. · An assignee who isn't one of writer's delegates is refused. · On a running task it is refused; writer cancels it and files it again. | "Give a task to another delegate": removed task tool `assignTask` (any unfinished task, running included, on a board that doesn't dispatch), `dispatchTask {taskId, assignee}` | 1 |
| T-25 | As a filer, I want to cancel a task with `updateTask` until it finishes, so that one tool changes a task. | writer's `updateTask({ id, status: "cancelled" })` stops the request working researcher's task, or resolves its suspension as cancelled, cancels its open tasks and closes its Inbox item. · On a finished task it is refused. · Sent with a `message` or a field edit, the call is refused and nothing changes. | `cancelTask`, a separate tool | 1 |
| T-26 | As a manager worker, I want `updateTask` to refuse a finished task, so that new tracked work on it is a task of its own. | launch's `updateTask({ id, message })` on writer's finished task is refused, naming the rule. · launch then calls `createTask` with the follow-up session setting, and the new task runs in writer's session with fresh attempts. · A `sendMessage` to that task isn't refused: it is conversation in the session (M-10). | Reopen (`reopen*`, "Reopen a finished task by messaging its session") | 3 |
| T-27 | As a filer, I want a message to a task's busy session to be conversation after the task, so that I hear "done" when the work is done, and words that change the work go as a steer. | writer's message to researcher's running task queues. · When researcher's `work` request ends, the task settles with its result; the message then runs as an `onMessageReceived` in that session, not part of the task: no claim, no `reportProgress`, and an error in it leaves the task's ending as it was. · To change the open work, writer steers it with `updateTask({ message })` (T-20). | A queued message holding an open task until it ran | 1 |
| T-28 | As a filer, I want a task whose request waits on a task, a call or a condition to show running, so that "waiting on a person" means a person. | researcher waiting on a call to coder shows running. · researcher waiting on a CI webhook, a condition with a deadline, shows running. · researcher suspended by `waitForUser` shows waiting on a person. | The gate handling every suspension alike, whatever its reason | 1 |
| T-29 | As a filer, I want a steer not to count as an ending, so that redirecting a task never settles it. | writer steers researcher's running task; nothing settles, and no attempt is used. · researcher's request carries on and takes the message at its next step. · The task settles only when that request ends. | New | 3 |
| T-30 | As a filer, I want a task to settle only after its request's background work ends, so that its result is complete when I hear of it. | researcher's worker returns while a side chain is still writing. · The row stays running until the side chain ends, then settles done. · writer hears the ending once, after both. | The gate settling the row when the worker step returns, before the engine drains the request's background work | 1 |
| T-31 | As a filer, I want a task's result to stay as it was delivered, and corrections to arrive as follow-ups, so that what other work consumed never changes underneath it. | Nothing rewrites writer's finished task's output; there is no reopen. · Alice's correction is a follow-up in writer's session, and its output is the new version. · writer's task view shows the latest completed follow-up's output as current, from `followUpOf`, and the original as history. | Reopen overwriting a finished row's output on its next completion | 3 |
| T-32 | As a filer, I want a task whose result goes to a conversation filed only from a conversation, and never waited on, so that its result always has somewhere to land. | From a task's session, `createTask` naming the ongoing-session or conversation-result setting is refused. · A wait on a task whose result goes to the conversation is refused. · From launch's conversation, both settings work, as routing uses them. | New | 1 |

## Messages

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| M-01 | As a worker, I want to message any worker on my roster, delegate or not, so that I can talk without owing work. | researcher's message reaches coder, who isn't its delegate. · A worker that only takes tasks still receives it. · A message to Bob's researcher is refused. | "Message another worker" (`messageWorker`, the message tool). The `takes_tasks_only` and `no_turn` refusals | 4 |
| M-02 | As a worker, I want to call a worker and wait for its result until a deadline, so that I can use the answer in the same request. | writer calls coder and gets "yes" as the call's result. · Past the deadline, writer resumes without it. · Waiting again or repeating the call returns the late result kept under its call id. | J12. Dispatch that waits only for acceptance. Messages that can't wait | 4 |
| M-03 | As a worker, I want only a call to bring a result back, so that nothing I say is passed on for me. | A send's recipient's final text goes nowhere unless it sends one. | "Auto-relay a woken turn's final text": relay (`workforceRelayTo`) | 4 |
| M-04 | As a worker, I want my answer to a message to land in the session that sent it, so that it arrives with the work it's about. | An answer with `inReplyTo`, sent to the original's sender, lands in the session that sent the original. · It lands there even if that session's task has ended. | "Reply to a message": reply (`replyTo`, `answerTo`) | 4 |
| M-05 | As a worker, I want a message to the worker that filed my task to land in the session that filed it, so that my filer sees it beside the work. | researcher's message to writer lands in writer's task session. · Any other message lands in the recipient's conversation with this user. | Every message landing in the recipient's conversation | 4 |
| M-06 | As a flow author, I want every message to arrive at one entry, `onMessageReceived`, with the sender, whether it waits, and the budget set by the server, so that a message can't lie about who sent it. | Each message starts a new `onMessageReceived` request. · A sender written into the message body is ignored. | Message entry (`onWorkerMessage`) | 4 |
| M-07 | As a worker, I want a send or a call to a busy or waiting worker queued, so that I never resend for timing, and a call never waits past its deadline. | A message to a busy coder runs after its current request. · A call into a waiting session queues, and its caller resumes at the call's deadline if it hasn't run. · A session suspended for a person counts as waiting: a send or a call to it queues. | New | 4 |
| M-08 | As a user, I want message budgets set by the server, so that workers can't message each other in a loop. | A request's fourth message is refused. · The seventh across one typed message's requests is refused. · A held task the board starts gets a fresh budget. | The hop count in a user-scope exchange row, carried by filing: "Message another worker"'s limit of 6 hops, 3 per turn | 4 |
| M-09 | As a worker, I want to message the session working a task, or another of my user's conversations, so that my question reaches the context it's about. | writer's `sendMessage({ to: { task: id } })` lands in researcher's task session, for its `onMessageReceived`. · coder can message researcher's task too, though it neither filed it nor shares its board; a task of Bob's is refused. · A person's second conversation with researcher is reached by `sendMessage({ to: { session: id } })`, including from researcher's other conversation, and so is the coordinator's conversation for one of Alice's projects. A `{ session }` naming Bob's session, Alice's own session in another org or another tenant, a session of a fired worker or of one moved to another flow, a task session or a delegate session is refused. · researcher's `sendMessage({ to: "researcher" })` is refused, and so is a `{ session }` naming the session it sends from. | Every message landing in the recipient's conversation. `messageWorker`'s worker-only `to` | 4 |
| M-10 | As a user or a worker, I want to ask a finished task's session a question, so that the answer comes with the work's full context. | writer's `sendMessage({ to: { task: id } })` to researcher's finished task runs `onMessageReceived` in that session, with its full history. · Alice typing in that session is conversation there too, handled by `respond`. · The task stays done: its status, output and attempts don't change. | A message about a finished task landing in the recipient's conversation, away from the session that did the work | 3, 4 |
| M-11 | As a worker, I want to set a call's deadline, so that I wait only as long as the answer is worth. | writer's `sendMessage({ to: "coder", wait: true, deadline })` resumes writer at that deadline without the result. · Without `deadline`, the host's default applies. · The late result is kept under the call id (M-02). | New | 4 |

## Stopping for a person

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| I-01 | As a user, I want every stop for a person in my Inbox, so that I never hunt for a question in a chat. | An approval, a question, a review, a task held on questions and a coding run's question each show as one Inbox item. · Each can be answered from the Inbox. | "Shift Manager Inbox" (only `human_approval` and `human_input`). J9. J11. Park as a word for a stop | 2 |
| I-02 | As a manager worker, I want to file a task held on questions known up front, so that the user answers before the work starts. | launch files coder's task held on "Which CSV export?", and it shows in Alice's Inbox at once. · Each answer joins the brief, and the last one starts the task. · Its dependents wait too, and cancelling it closes the item. | New. The nearest thing is an `undispatched` row | 2 |
| I-03 | As a worker, I want to ask a question midway and carry on from my brief, so that an answer doesn't restart my work. | researcher asks "Which region?"; its task holds on the row and its request ends. · Alice's answer picks the work up from its brief on the same attempt, with no new attempt used. · An approval, a review or input its code reads next suspends with `waitForUser` instead, and resumes the same request. | "Task stops on a question; filer answers": park on a question (`parkOnQuestion`, `parkedOnQuestion`), answer a task (`answerTask`), `input.answer`. "Free-form input" | 2 |
| I-04 | As a user, I want reviews to stop the same way as approvals, and only me to answer either, so that sign-off stays mine. | writer's review request shows as an Inbox item. · A filer answering questions asked at filing, an approval or a review is refused. · A filer may answer a question asked midway, by a steer, unless the task is routed. | "Review park" (`awaitReview`, `unparkAndDrain`, `onReview`, `input.feedback`). The EM ask door. J4. J8 | 2 |
| I-05 | As a manager worker, I want a task waiting on a person to keep its claim, so that no other worker runs it again. | The row shows "waiting on a person". · No second run starts, however long the wait. · The resumed request still holds the claim. | The claim gate stopping renewal on a suspend, so the row lapses. Boards told to park the task | 2 |
| I-06 | As a flow author, I want a suspension's deadline to resume my block with `deadline`, so that my flow decides what happens. | The block resumes with a `deadline` outcome and can go ahead, end, or check in again. · A suspension with no `deadline` gets the host's default. · Unhandled, an approval counts as rejected, and a review or input errors and uses an attempt. | Only approvals acting on `expiresAt`, always as an expired rejection | 2 |
| I-07 | As a user, I want cancelling a task to close its Inbox item, so that I'm not asked about dead work. | The suspension resumes as `cancelled`. · The Inbox item goes away. · Nothing the block returns is recorded. | Nothing on the board resolving a person's stop | 2 |
| I-08 | As a user, I want stopping a suspended request to close its item and cancel its task, so that the board matches what I see. | Only Alice can stop it, from a screen; no worker tool stops a request. · The request ends with no result, and the item closes. · The task it works is cancelled, and its filer hears once. | A stop that ends the turn `aborted` and never tells the board | 2 |
| I-09 | As a user, I want a coding run's question in my Inbox, and my answer to start the next run in the same coding session, so that I can unblock coding work like any other. | The question ends the run and its task holds on the row. · Alice's answer, a steer, carries on the same attempt. · The next run continues the same coding session. | "A coding run asks a question": a coding run's question inbox (`answerQuestion`, with no screen), the claim-board question park, the fixed-board inbox row | 2 |
| I-10 | As a user, I want a suspension to survive a restart and resume in its turn in the session, so that my answer is never lost or run alongside other work. | A request suspended before a restart carries on after Alice answers. · The resume runs after any request already running in that session. · A host without durable execution refuses a suspension instead of losing it. | Suspending for a person on a host without durable execution | 2 |
| I-11 | As a manager worker, I want a question my task stops on sent to me as a message, so that I can answer it if I'm allowed, or leave it to the user. | researcher's midway question reaches writer as a message from researcher's task session, for writer's `onMessageReceived`. · writer's `updateTask({ message })` is the answer and releases researcher's task, which picks up from its brief. · The first answer, writer's or Alice's, closes the Inbox item. | J11's waits-on-you line in the /cos summary, answered in chat and relayed through `answerTask` ("Task stops on a question; filer answers") | 2 |
| I-12 | As a filer or a user, I want a task waiting on a person to show its open question, so that I see what it waits on without opening its session. | `getTask` on researcher's task shows its open question's text, and for a suspension, waiting on a person with its kind and prompt. · `listTasks` shows the same for each such task. · Once answered, the task shows running, with no question. | A suspension record with no task id, and a task row that doesn't link to it | 2 |

## Routing

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| R-01 | As a user, I want a coordinator's routed work to be an ordinary task, so that I can see, steer and cancel it like any other. | Alice's message to launch files a routed task on launch's delegation board. · Its session is writer's ongoing one, its result goes to the conversation, and it gets 1 attempt. · It shows in Alice's tasks and can be cancelled. | "Hand a post to a delegate". Post (`onDelegatedPost`, `isPostRow`, `onPostSettled`, `postCancelled`, `dispatchTask {post:true}`). J2 | 1 |
| R-02 | As a user, I want a routed task's result in my conversation with the coordinator, under the delegate's name, so that I read every answer in one place. | writer's draft lands in Alice's conversation with launch, under writer's name. · Work writer files for others comes back to writer first. | "Route a message by the coordinator's judgment" (the delegate's line). J1 | 1 |
| R-03 | As a user, I want rounds to send each routed answer back out, so that delegates can build on each other. | With everyone and 2 rounds, launch files three routed tasks, then sends each answer back out. · A round's deadline resolves by task id. | "Delegates answer each other in rounds", keyed on post ids (`postId`, `RoundPost`) | 1 |
| R-04 | As a user, I want one fit check that picks a delegate for best fit and vets a workstream lead, so that both judge fit the same way. | Best fit picks researcher, and a weak pick goes to the fallback. · Opening a workstream with writer as lead runs the same check. | "Route a message by best fit" and the lead-fit check, two model calls for one job | 1 |
| R-05 | As a user, I want asks in a workstream routed to the lead's ongoing session, so that the lead keeps the workstream's context. | Alice's ask in the pricing-page workstream becomes a routed task in writer's ongoing session. | "Project coordinator hands an ask to a workstream" (`post:true` plus `target`). J6. J7 | 1 |
| R-06 | As a worker, I want to message any coordinator, whatever its routing, so that I can reach it directly. | A message to a round-robin or everyone coordinator starts its own `onMessageReceived` request and isn't routed. | "Route round-robin" and "Hand each message to everyone", which can't receive messages (their notes) | 4 |

## Chain of command

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| C-01 | As a user, I want a worker to file tasks only with its delegates, or anyone with `all`, so that I decide who gives work to whom. | writer filing a task for coder, not its delegate, is refused. · With `delegates: all`, any roster worker can take it, the worker itself included. · Bob's researcher is never reachable. | Tasks reaching any roster worker. "Default to the only delegate" (two code paths) | 1 |
| C-02 | As a user, I want to be the only one who changes a worker's delegates, unless I set a coordinator to change its own, so that a worker can't widen its own reach. | writer calling `addDelegate` is refused. · launch, configured to change its own, succeeds. | "Manage a conversation's delegates" (any worker with `delegates:`). J5 | 1 |
| C-03 | As a worker, I want to ask the filer above for work I can't file, by message, so that someone with the authority files it. | researcher messages writer, and writer messages launch. · launch files coder's task, and its result comes back to launch. · launch steers writer's task with the script, writer steers researcher's, and researcher carries on. | "Message another worker", used to ask for work | 1, 3, 4 |
| C-04 | As a manager worker, I want work my assignee reports finding to become a sibling task I file, so that its task stays the job it was given. | researcher describes found work in a message and carries on. · writer files a sibling beside researcher's task. | Splits filing work outside the task from inside it | 1 |
| C-05 | As a user, I want found work my worker spots to wait for my approval, so that nothing new starts without me. | writer's evaluator flags a request for work and files it held. · Alice releases it or cancels it. | New | 1 |

## The worker contract

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| W-01 | As a flow author, I want to declare my worker's roles and have the hire check each role's entries, so that a broken worker is refused at hire, not mid-task. | A contributor without `work` is refused. · An entry that refuses its input is refused. · `onMessageReceived` joins the check in phase 4. | A contract that checks only configuration, one door and attribution. "Make a custom flow a delegate" (takes posts, tasks, both or nothing; skip refusals) | 1 |
| W-02 | As a flow author, I want each role's entries, tools and session state from one factory, so that I spread one thing per role into my flow. | A flow built from the manager factory passes the hire as a manager. · No entry has to be wired by hand. | Kit (filing kit, session kit). Entries arriving through separate opt-in pieces | 1 |
| W-03 | As a worker, I want five task tools and seven tools in all, so that I always know which one to reach for. | The model sees `createTask`, `getTask`, `listTasks`, `updateTask`, `reportProgress`, `sendMessage` and `waitForUser`, plus `listDelegates`; `reportProgress` only on a task turn. · `getTask` takes `wait` and `deadline?`. · Only a configured coordinator also sees `addDelegate`, `removeDelegate` and `setFallback`. | Eleven task tools. `addTask` and `readTask`, renamed `createTask` and `getTask`; `cancelTask` and today's `updateTask` patch (T-17, T-25). Removed task tools (`dispatchTask`, `assignTask`, `failTask`). `messageWorker`. `unblock` | 1 |
| W-05 | As a worker on a task, I want to report a status note and checkpoint my output as I go, so that task views show progress and a crash or retry doesn't lose what I've done. | `reportProgress({ statusNote?, output? })`: the note shows in the task view and never changes the task's status. · `output` checkpoints follow rule 22. · Outside a task turn, or after the task finishes, the tool is absent or refused. | `updateTask({ id, output })` checkpoint (FIX-2081 D3, superseded) | 1 |
| W-04 | As a flow author, I want entries named for what starts them, so that a flow reads plainly. | A flow takes a user's message on `respond` and a board pass on `dispatch`. · No flow has a `run` action. | The `run` action. Run the task board (`runTaskBoard`, `RUN_BOARD_ENTRY`) | 1 |

## Reliability

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| F-01 | As a user, I want everything a board owes paid even after a crash, so that no work waits on someone touching the board. | The server restarts just after researcher finishes, and writer still hears, soon after the due time. · The sweeper wakes at the earliest due time, not on a 10-minute interval. | Debts paid only by the board's next touch. "Hear how a task ended" (dedupe and resend). `afterRun`'s resends | 1 |
| F-02 | As a manager worker, I want a row to start as soon as anything makes it startable, so that work never sits ready and idle. | A dependent starts within seconds of its dependency ending, with no read of the board. · The same holds after a filing, a start, an answer or a retry. | Only a retry running the board. A dependent starting on the next touch. The silent run-board notice | 1 |
| F-03 | As a flow author, I want a second `dispatch` in a session rejected while one runs, so that two passes never start the same row twice. | A second `dispatch` during a pass is rejected. · A row made startable during the pass still starts, because the pass checks for startable rows last. · If the pass dies first, the sweeper starts the row when due. | Run the task board (`runTaskBoard`) and its overlapping resends | 1 |
| F-04 | As a manager worker, I want a task's failure delivered to me like any other ending, so that I decide what to do about it. | A final failure reaches writer once, with the error. · No separate error-report record is written. | "Failed tasks go to the Error Reporter" (the `reportOwed` marker, its outbox and 5-minute resend). The error-report debt | 1 |
| F-05 | As a user, I want the Error Reporter to hear each final task failure once, with its ending, and to be a worker a filer can message, so that a failure is reported once, by one route. | writer messages the Error Reporter about a failure, and it drafts an issue. · Alice reviews the draft from her Inbox. · A task's final failure reaches the Error Reporter's intake once, as one occurrence, whether or not anyone messages it. | "Error Reporter files issues" by an automatic route. J13 | 1 |

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
| U-02 | As a user, I want typing in an unfinished task's session to send `updateTask`'s message, so that the composer has one meaning. | Alice's text joins the brief of writer's task before it starts, steers it while it runs, and answers it if it's waiting. · In a finished task's session it is conversation for `respond`, and the task doesn't change (M-10). | "A person chats with a worker" (a composer that reopens, steers or answers depending on the session) | 3 |

## Words and pruning

| ID | Story | Acceptance | Replaces | Phase |
| -- | -- | -- | -- | -- |
| V-01 | As a flow author, I want nothing in the packages the repo doesn't use, so that I never build on a dead path. | The listed code is gone, along with its README and docs entries. · The repo's tests pass. | "Hand-rolled claim loops" (`dispatchAndExecuteBlock`, `taskLoopBack`). The classifier, event and fifo claim orders. Own-state board (`delegationBoard`). "Drain Pool". The docs' three substrate backings, two of which the code refuses | 0 |
| V-02 | As a flow author, I want one name for one thing across code, docs and UI, so that I can trust a word to mean what it says. | `git grep` finds no retired identifier from the gaps file's table. · Dispatcher names only the block. | Turn, line, park, post, reply, relay, reopen, blocked, pieces. Dispatcher for four things (`TaskDispatcher` becomes claim order, `FlowDispatcher` becomes runner). Kit. Ask as a wait (`fsd.ask.*`, `asked`), seat, mailbox and the `-hand-off-` route names, with no old spelling kept for replay | 5 |
| V-03 | As a user, I want the Shift Coordinator called that everywhere, so that the UI, routes and code agree. | No route, worker id or code name says chief of staff. · The old worker id stops working. | Chief of staff (`chief-of-staff`, `chiefOfStaff*`, `/cos`) | 5 |

## Coverage check

**Gap rows without a story:** none. **Retired terms without a Replaces cell:** none. All five new
decisions have stories: recurring work (S-01 to S-03), error reports (F-04, F-05), steering a coding
run (T-21), board controls on screens (U-01) and duplicate `dispatch` (F-03). So do the board
decisions: `mode` (T-01, T-19), patterns as plan boards (T-03), who settles a row (T-22) and the
goal-seek loop's plan board (T-23). So do the filer's four task tools plus `reportProgress` (W-03, W-05) and `updateTask`'s one rule per field: edit before it starts
(T-17), hold or release (T-08), reassign before start only (T-24), cancel (T-25) and a message
(T-20) until it finishes, and nothing on a finished task (T-26). So do when a task is done: a message
queued behind it (T-27), waits that leave it running (T-28), a steer (T-29) and background work (T-30); a
task's session outliving it (M-10, U-02); and a finished task's output never changing (T-31). So do
the cold read's calls: a retry in the task's session (T-15), only the user stopping a request
(I-08), typing in a task's session (U-02, M-10), a call's `deadline` (M-11), a session stopped for a
person counting as waiting (M-07), conversation-result settings (T-32), two limits of 5 (T-05) and
every worker seeing all its user's tasks (M-09). So do the owner's later calls: a call into a
waiting session queuing (M-07), and the filer hearing its task's questions (I-11, I-12). The
punted default worker instructions get no story; they become their own issue.

Coverage was checked row by row on 2026-10-20, and is re-checked when the issues are filed.

## Today's use cases (the inventory)

The coordination inventory page's 77 use cases and 14 Shift Manager journeys, copied from its data (main at `40bcf29`, 2026-10-15). The page gives the use cases no IDs, so they are listed by layer in its order; its flags (unused, docs only and the like) close the notes in brackets. The Replaces column quotes these names.

**Workforce tasks** (23)

| Use case | Started by → mechanism today | Notes |
| -- | -- | -- |
| Start a task and hear when it ends | Worker turn · `dispatchTask {goal}` → Row on the filer's conversation board; board wakes and claims | Same result as `addTask` + `dispatchTask {taskId}`; same tool as the post form |
| Start a task and wait for it in the same turn | Worker turn · `dispatchTask {wait:true}` → Row with a wait gate; turn suspends; ending sets `resumeOwed` | Refused on task turns; split is the stand-in inside a task |
| Write a task down without starting it | Worker turn · `addTask` → Row with `undispatched: true` | Same tool name files a ready row on a drain board |
| Start a task written down earlier | `dispatchTask {taskId}` → Clears `undispatched`, wakes the board | `assignTask` also wakes a waiting row |
| Default to the only delegate | Implicit, no assignee named → Assignee becomes the sole task-taking delegate | Computed in two separate code paths |
| Give a task to another delegate | `assignTask`, `updateTask.assignee`, `dispatchTask {taskId, assignee}` → Sets the assignee; a new worker means a new session | Three tools for one write; frozen while running; posts refuse |
| Change a task's details | `updateTask` → Priority, labels, metadata | No user docs |
| Cancel a task | `cancelTask` / `cancelTask_tasks` → Cancelled; split pieces cascade; a post sends its own ending |  |
| Filer completes or fails a task itself | `completeTask` / `failTask` → Terminal row plus notice marker | No docs say when a filer should use these |
| Block a task | `blockTask` → Pending → blocked | Nothing unblocks it except cancel [no way out] |
| Automatic second attempt | System, on first failure → Row back to pending | Fixed at 2 attempts (posts get 1); no option |
| File a failed task again | Judgment turn woken by the failure → A new row | One of four retry forms |
| Hear how a task ended | System · notice owed on the row → `onTaskSettled` → run-board, resume, line, or line + turn | Deduped by task/attempt/ending; 500 kept; 32 queued |
| Task stops on a question; filer answers | Worker · `parkOnQuestion`; filer · `answerTask` → Row parked with `parkedOnQuestion` | Not in Inbox; no answer control in the UI |
| Follow-up task in the same session | `dispatchTask {followUpOf}` → Row `-f` with the root's assignee | No assignee allowed; the root must have finished |
| Reopen a finished task by messaging its session | A person sends `run` in a finished task session → Row reopened to pending; board runs | FIX-1817 said nothing reopens; FIX-1764 added this |
| Split a task into pieces | Task-session turn files tasks → Pieces on the task session's own board; parent parks quietly | Any roster worker is reachable, not just delegates |
| Retry a failed piece | Turn woken by a piece's failure → Piece filed with `metadata.retryOf` | `retryOf` isn't a tool field |
| Ending a split task cancels its pieces | Cancel/complete/fail/block on a parked split row → `cancelSplitPieces`, recursive |  |
| Limits on how far a chain goes | System → `taskChain {depth, top}` plus a chain record | Depth 5, 100 tasks under one top |
| List or read tasks | `listTasks`, `readTask` → Reads; every read also wakes and replays | A read has side effects |
| An app drives the board through actions | App or DevTool · `_tasks` (11) → Same writes as the model tools, no claim | Answers `no_delegation_board` where no tasks are filed |
| Failed tasks go to the Error Reporter | System · `reportOwed` marker → Sent to the reporter's intake; resent after 5 min | A second marker and outbox beside notices |

**Coordination** (16)

| Use case | Started by → mechanism today | Notes |
| -- | -- | -- |
| Route a message by the coordinator's judgment | Person's message · `routing: judgment` → The coordinator's own turn calls `dispatchTask {post:true}` per delegate, or answers | Same tool as tasks; only the flag differs |
| Route a message by best fit | `routing: best-fit` → One evaluator call; ladder held → evaluated → fallback → own turn → unplaced | Same kind of call as leadFit, written twice |
| Route round-robin | `routing: round-robin` → Cursor picks the next delegate; no model call | Can't receive messages |
| Hand each message to everyone | `routing: everyone` → One post row per delegate | Can't receive messages |
| Delegates answer each other in rounds | `rounds: 0–3` → Answers routed back out; deadline sweep | Messages are a second way for delegates to talk |
| Hand a post to a delegate | Routing, or judgment turn · `post:true` → Post row (`sealed.kind: post`, 1 attempt) | A task with exceptions: no reassign, complete, fail or block |
| Manage a conversation's delegates | `listDelegates`, `addDelegate`, `removeDelegate`, `setFallback` → Server-owned session state, copied from the file on first use | Same actions on any worker with `delegates:`; 25 max |
| Make a custom flow a delegate | Flow author → Declare a post entry and/or a task entry | Two entries produce takes posts/tasks/both/nothing, and the skip refusals |
| Project coordinator hands an ask to a workstream | Person in the project Stream · `post:true` + `target` → Delegate list computed from your open workstreams | Delegates here are workstreams, not workers |
| Open or edit a workstream | `openWorkstream` (leadFit), `editWorkstream`, `setBrief`, `setRepository` → Workstream entry plus delegate record | Shift Coordinator also opens workstreams, but hands nothing |
| Workstream sessions | `openWorkstream` → Lasting lead session with its own board | A fifth kind of session per worker |
| Shift Coordinator (chief of staff) | Person at `/cos` → Best-fit coordinator plus hire/fire/project tools | Two names for one worker |
| Standing rules | Person coaching · `rules/*` → Rules in the prompt every turn | Only on user-started turns; 20 rules, 300 chars |
| Error Reporter files issues | Failed request, errored task, rescued crash, or `reportProblem` → Fingerprint → harness draft → Inbox preview → tracker filing run | No button to open its conversation in Shift Manager |
| Hire, fork, edit, fire workers | Roster actions or tools → Roster row; fire behind approval | Effective next turn |
| A coordinator takes a task as a delegate | Task entry on the coordinator flow → Runs the judgment turn | Nesting |

**People & messages** (13)

| Use case | Started by → mechanism today | Notes |
| -- | -- | -- |
| Message another worker | Worker turn · `messageWorker` → Message-log row; internal dispatch to the recipient's `onWorkerMessage` | Never waits; hop 6, 3 per turn |
| Reply to a message | `messageWorker {replyTo}` → Routed to `answerTo` |  |
| Auto-relay a woken turn's final text | System → If the turn never messaged back, its text is sent | Pending a product decision [pending] |
| Review park | Board · `awaitReview`, `onReview: hold\|exit` → Row parked; `unparkAndDrain {feedback}` | `answerTask` refuses it; a different field name from question parks |
| A coding run asks a question | Harness file marker in the checkout → Claim board → question park; fixed board → inbox row + `awaitReview` | Fixed-board inbox has no UI [no UI] |
| A person talks to a running coding run | Person in the task composer → `messageDoor` stops the run; row parked for a turn | Built separately from reopen |
| Approval | Worker · `ctx.suspend {human_approval}` → Suspended request; resume route | Fire, set repository, EM ask gate |
| Free-form input | Error Reporter · `ctx.suspend {human_input}` → Suspended request with a form |  |
| Shift Manager Inbox | Person → Lists only `human_approval` and `human_input` suspensions | Task questions aren't here; the "Questions" filter means `human_input` |
| A person chats with a worker | Person · `sendTurn` to a session's door → A line into the session | The same composer reopens, steers, or answers, depending on the session |
| Messages view | Person → Reads the message log | Nothing links a message to a task |
| Workstream report | Lead · `updateWorkstream` → Write to the workstream entry | Another progress channel beside notices |
| Where talk lands | — → Derived address: worker (+ filing session / task / workstream / project) | A person can type into each, with different effects |

**Framework** (25)

| Use case | Started by → mechanism today | Notes |
| -- | -- | -- |
| Task ledger | Pattern or board author → `getOrCreateTaskCollection`; state or resource backing | Docs say 3 backings; code refuses 2; board names 4 |
| Claim-order dispatchers | Board config → fifo, topological, priority, classifier, event (+2 outside the package) | fifo = topological; classifier and event unused |
| Hand-rolled claim loops | Author → `dispatchAndExecuteBlock`, `taskLoopBack` | Re-implements the board loop; only tests use it [unused] |
| taskBoard inline drain | Code-first author → Rows plus atomic claim; workers map; concurrency 4 | Base for 5 patterns and the conversation board |
| Board assignee that dispatches | `dispatcher()` in `workers` → Claim, then a task dispatch; child re-checks through the claim gate | Same block as internal dispatch, with claim bookkeeping |
| Task entry served by many boards | `taskLedgers` / `from` → Ledger resolver plus claim gate | Workforce wraps it twice (tasks, posts) |
| goalSeekLoop | Author → Seed → drain → judge → replan | planAndExecute and parallelTasks are configurations of it |
| Board capability and actions | Sibling blocks or callers → `ctx.cap..addTask`, `addTask_` and 9 more | Third and fourth write surfaces for one ledger |
| Model task tools | Agent author · `taskTools` → Default: the generator's own-state delegation board | The own-state board has no production user [unused default] |
| Internal dispatch | `dispatcher()` internal / `dispatchThroughSeam` → `{key}`, `{id}`, or `{from:true}` | Workforce calls the raw seam in about 8 places |
| Host dispatcher | Deployer → In-process vs BullMQ queue | `worker-only` silently runs in-process |
| Schedules (cron) | Flow `schedules` → Host cron → scheduled adapter, or BullMQ native | Two cron paths |
| Side chains | Sequencer `.sideChain` → Fire-and-forget after a step |  |
| Inline composition | Block as tool, router, forEach, loopBack → No ledger |  |
| parallelTasks | Pattern → Decompose, then one drain | goalSeekLoop with 1 iteration |
| supervisor | Pattern → Board plus a reviewer inside each worker | A third drain-then-judge loop |
| planAndExecute | Pattern → Board inside goalSeekLoop, evaluator as judge |  |
| eventActors ("Reactive Blackboard") | Pattern → Topic-subscribed actors as tasks on a board | Doesn't use the event dispatcher built for it |
| routedSpecialists ("Blackboard") | Pattern → Model picks the next specialist; own-state task log; no board | Its own hand-rolled claim and lease |
| roundRobin / debate | Pattern → Fixed turns; tasks as a transcript on sequencer state |  |
| responseAuditor | Pattern → Parallel analyzers via side chain |  |
| rlm | Pattern → Recursive generator-as-tool | "No current consumers" [unused] |
| Drain Pool | Pattern → — | Described in the patterns overview; no code [docs only] |
| Supervised coding run (harness manager) | Board row via a dispatching assignee → Own checkout, verdict, judge, run record | Its own question channel and message door |
| Workforce conversation board | Any worker with `delegates:` → A taskBoard per conversation on a partitioned user ledger | Posts and tasks both ride it |

**Shift Manager journeys** (14). Steps marked * are where work changes hands.

| ID | Journey | Steps | Notes |
| -- | -- | -- | -- |
| J1 | Ask the Shift Coordinator to get a feature built | your line at /cos → best-fit picks eng.em* → post row → EM's session* → EM files a coder task on its own board* → coder task session → harness run → judge → ending notice → EM's session* | The coder's result never reaches your chat. It goes to the EM's session; the TASKS panel at /cos doesn't show the coder task. |
| J2 | Have the coder look at or change a project's repo | your line at /cos → best-fit can't post to the coder (it takes tasks only) → Shift Coordinator turn runs → dispatchTask to eng.coder* → coder task session → answer or implement manager → notice → your chat* | Whether your message is a post or a task depends on which worker best fit picks. |
| J3 | Ask what a finished task found | your line → listTasks → readTask → answer |  |
| J4 | Hire, fire, start a project, set a repository | your line → tool call → fire / setRepository → human_approval* → approve in Inbox* → roster or project write | Three separate approval-gated writes, each built its own way. |
| J5 | Change who the Shift Coordinator hands work to | DELEGATES panel → add / remove delegate | Only at /cos; the project coordinator's delegates are computed, not editable. |
| J6 | Ask a project coordinator for new work | your line in Stream → listLeads → openWorkstream → post:true + target* → lead's workstream session* → lead files a task* → task session → notice → workstream session* → updateWorkstream report | "Stream" here means the coordinator chat; elsewhere it means a workstream. |
| J7 | Talk directly to your workstream's lead | Workstreams → your entry → line into the lead's workstream session → lead files tasks on that board* | The documented `@worker` syntax isn't implemented. |
| J8 | Approve the boot feature | Inbox → Approve* → EM ask door resumes → files a row, no model* → coder implement run |  |
| J9 | Answer any ask, or reply under one | Inbox card or /cos summary → resume route* → or reply box → sendTurn | Asks raised inside dispatched runs can't be answered from Shift Manager. |
| J10 | Watch, stop or steer a running task | Tasks → task → Interrupt aborts → composer → message door: stop, park for a turn, continue* → on a finished task: reopen* | Three ways to redirect, with three different effects. |
| J11 | A task stops on a question | worker parks the task* → notice → filer's chat* → "waits on you" in the /cos summary → you reply in chat → coordinator calls answerTask* → same task session resumes | Not in Inbox, and no answer button. You answer by chatting and hoping the coordinator relays it. |
| J12 | Workers message each other | messageWorker* → recipient's conversation wakes → Messages view (read-only) |  |
| J13 | A failure becomes an issue | failed request or task → Error Reporter drafts → human_input form in Inbox* → filing run via tracker MCP | No button to open the Error Reporter's own conversation. |
| J14 | Configure | Settings → MCP keys → Worker settings → standing rules | "Settings" means two unrelated things. |
