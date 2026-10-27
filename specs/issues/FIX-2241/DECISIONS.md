# FIX-2241 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic decided the model ([FIX-2070](../../epics/FIX-2070/DECISIONS.md)): the question goes as a
message from the task's session to the filer's `onMessageReceived`, through `sendMessage`'s server
path and never the model tool; the hold stays the record and the Inbox the answer's home (seam
table, PR-3); the server's question is exempt from the budget (ER-6); it lands in the session that
filed the task (ER-2). The answer itself is FIX-2133's (ER-4). What is left is engineering, so
this spec carries no decision card.

## Decided, not asked

- **The convergence point is `askMidway`.** Every midway ask, `askQuestion` and `harness-manager`'s
  coding-run ask alike, goes through it and then through the collection's one `ask` write; after
  the ask it calls the ledger's declared `onMidwayQuestion(ctx, row, holds)`. A test pins both callers. Orchestration names no message (Layer 1 boundary).
- **Once, a replay included.** The message is built from the row, not from the ask's return: after
  the ask, `askMidway` reads the committed row's open midway holds and calls the hook with those (while one
  is open no other turn runs the task, so they are the ones this turn asked). Their ids are stored on the row, so a durable turn that crashed after
  the hold write and replays (its ask now declined, the lease gone) finds the same holds and sends
  the same ids. A question answered before the replay is closed and needs no message. A declined
  ask tells only when the row records that this turn asked (`askedOnTicket`), so another turn's
  questions are never told by this one.
  The message id is derived from the task and the hold (for example
  `q:<taskId>:<holdId>`), and the row's take keeps any repeat to one message: a server-only id on
  the send's server function, with no new debt or reset when the row exists (FIX-2240's). After the message row,
  FIX-2240's delivery takes over, except when the sending flow has no session board pass (the
  coder's; `j1b` proves it). The send keys off the board's presence, not the worker:
  - the send takes the fast path only and enrolls no pass debt;
  - `askMidway`'s durable replay is its only resend;
  - a server send never leaves a "wasn't delivered" line.
  Jake approved this loss window in the cross-spec review (2026-10-27). On a host without durable execution a crash before the row loses
  the message, as the epic's D2 leaves every send; the Inbox item stands.
- **One message per hold**, so each names the one question id the filer answers.
- **Who is told.** The row's filer session (`Task.filer`), whatever its result setting
  (`resultTo: "conversation"` included: the question is the filer's to hear, the ending the
  conversation's). A task filed by a screen or a schedule (no filer session) and a board without
  the hook send nothing. Plan steps are never held (`plan.ts`), so no plan row asks. A filer
  session that is gone refuses the send; the refusal is logged and the Inbox item stands.
- **A filer waiting on the task hears it at once.** A wait is a suspension on the engine's wait
  gate, and a suspended request gives its place back. Epic ER-4 holds a message's admission only
  while the recipient session waits on a person: a person's suspension, or, in a task's session,
  its row's open hold (FIX-2239's `hasOpenHold`). A wait gate is neither, so the filer's
  `onMessageReceived` runs beside its parked wait. A filer that is itself a task's session whose
  own row holds an open question hears it once that question is answered. Its steer lets the
  task go on, and the wait then resumes with the result. No change to a wait's outcomes.
- **Sender, server-set.** `from` is the row's assignee and the sending session is the task's,
  both read from the row, never from input (BP-031). `call` is false: the task never waits on the
  answer through the message.
- **Budget.** The send skips every budget check and pays nothing (epic ER-6): the chain's 6, the
  per-request 3 and the hop reservation, so an ask with several holds is never refused; the filer's
  `onMessageReceived` is told the budget the task's chain has left, so its own sends count there.
- **Routed tasks are told too** (concept rule 11: "also messaged to the filer"), with text that
  says the user answers it from the Inbox. The text is the server's, built from the row; a confirm
  says to answer with `done`.
- **No new field on `onMessageReceived`'s input.** The task id and question id ride the text the
  model reads; epic ER-1's input stays as FIX-2238 ships it.
- **Answered, cancelled or past its deadline before the filer's turn**: the turn's `updateTask`
  is refused as today (`question_answered`, finished); nothing is recalled.

## Considered and dropped

- **A filer waiting on the task hears it only once its wait ends** (the first draft's D1). Its
  premise, that a message queues behind a waiting request, was wrong: a wait gives its place back.

- **Bring back the park's notice** (removed by FIX-2131 in `043be81`): a question marker on the
  row, paid by the notice's wake. Durable from the hold's own write, but it lands on
  `onTaskSettled`, the entry for endings, and the epic chose a message. It would also make a
  question count as an owed notice in the filer's done check.
- **Send from the `askQuestion` tool.** Misses the coding run's question (the smaller goal).
- **Structured `about: { task, question }` on the received message.** Changes ER-1's input for one
  sender; the text carries the ids the model needs.

## Open

None.

## Settled

No POC: every premise is a read of `main` (the two `askMidway` callers and the collection's `ask`,
whose hold ids are minted before its write; `DeclaredDelivery` filled by `conversationDelivery`;
`answerQuestion`'s routed refusal; a wait gate as a suspension, `resume-wait-gate.ts`).

## Notes for the implementer

- **Order.** The exempt send edits FIX-2238's send path, which FIX-2160, FIX-2240 and FIX-2239 stack
  on. This lands after FIX-2238, stacked on its PR while that is open, and rebases on whichever of
  the others merged first; it touches only the send's budget check.
- **Renames.** `DeclaredDelivery.onMidwayQuestion` and the server-written text that teaches
  `updateTask({ id, question, message })` are in FIX-2183's scope (#3985 hands it the meanings of
  *hold* and `updateTask`'s `question`), so its codemod changes the name and the text together.
- `DeclaredDelivery`'s doc says `onMidwayQuestion` is not the notice pipeline (no marker, no
  `noticeEntry`): same declaration, a different moment. Whether the hook takes the holds or reads
  them from the row is the implementer's call.
- `answerQuestion` checks the caller reaches the row, not that it is the filing session; nothing
  here relies on that.

## How it got here

- 2026-10-27, initial draft, on `main` after FIX-2238's spec merged (#3986). The research found
  that FIX-2131 removed a park's question notice a day earlier, so today no midway question
  reaches a filer, and that `askMidway` is the one point both ask paths share.
- Same day, an independent review against `main`, folded: D1 dropped (a wait gives its place
  back, so a waiting filer hears at once); "once" rebuilt on the row's stored holds, since a
  replay's ask is declined; who is told with `resultTo: "conversation"` and a gone session; plan
  steps never ask; the goal's Lab gains a workstream and a model-filed coding task.
- 2026-10-27, after merge, amended with the implementation: the hook is named `onMidwayQuestion`
  (the vocabulary sweep refuses `questionAsked`), and the waiting-filer line states ER-4's
  admission as FIX-2239 builds it (an open hold in a task's session holds it too).
