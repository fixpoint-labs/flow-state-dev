# Facts for Messaging between workers (K-08, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example (the Teammates lab). No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read for a fact. Every surface named here is built; nothing is marked for reconciling at cutover except where a flag says so. Paths are from the repo root.

Abbreviations:

- `mt` = `packages/workforce/src/messages/message-tool.ts`
- `sm` = `packages/workforce/src/messages/send-message.ts`
- `wr` = `packages/workforce/src/messages/wait-for-reply.ts`
- `rx` = `packages/workforce/src/messages/message-received-entry.ts`
- `or` = `packages/workforce/src/messages/owed-replies.ts`
- `lr` = `packages/workforce/src/messages/log-row.ts`
- `ml` = `packages/workforce/src/messages/message-log.ts`
- `lim` = `packages/workforce/src/messages/message-limits.ts`
- `keys` = `packages/workforce/src/messages/keys.ts`
- `q` = `packages/workforce/src/messages/queue.ts`
- `kit` = `packages/workforce/src/kit/workforce-kit.ts`
- `br` = `packages/workforce/src/browser.ts`
- `mw` = `apps/docs/docs/workforce/messaging-workers.md` (the existing page)
- `de` = `apps/docs/docs/advanced/durable-execution.md`
- `t1` = `packages/workforce/test/worker-messages.test.ts`
- `t2` = `packages/workforce/test/worker-reply-requested.test.ts`
- `t3` = `packages/workforce/test/worker-reply-wait.test.ts`
- `g1` = `goals/shift-manager/workers-message-each-other/goal.md`
- `g2` = `goals/teammates-lab/a-worker-talks-to-another-while-you-talk/goal.md`
- `lab` = `labs/teammates`
- `cos` = `labs/teammates/workforce/teams/teammates/workers/chief-of-staff/WORKER.md`
- `res` = `labs/teammates/workforce/teams/teammates/workers/researcher/WORKER.md`
- `ad` = `labs/teammates/src/adapter.ts`
- `tl` = `packages/shift-manager/src/components/ToolLine.tsx`
- `rm` = `packages/shift-manager/src/components/ReceivedMessage.tsx`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/worker-messaging`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

## Flags against the page plan and the existing page (read first)

1. **The existing page is the source for most prose, and it carries one stale name.** `mw:614-630` imports `workerMessageRowSchema` from `@flow-state-dev/workforce/browser`. The browser entry exports `workerMessageResourceStateSchema` and the type `WorkerMessageResourceState`, not that name: `br:86-91`. An example that reads the log must use `workerMessageResourceStateSchema`. The existing page and `packages/workforce/README.md` (lines 2532, 2819, 2869) still say the old name. Flagged for the owner; the sheet states only the exported name. [page]
2. **The sitemap's Reference link target is a Reference page that does not exist yet** (`reference/worker-messaging`). Delivery states, refusal codes, the limits table and the log row's full shape are marked **[ref]** below so the Reference page can take them. [ref]
3. **"Install it" has nothing separate to install.** Messaging is part of the workforce kit; there is no kit of its own and no config key that turns it on. The only config is `messages: { budget, perTurn }`, and it is optional. The page's "Install it" step is the workforce kit's, which the K-01 page owns; this page says what the install already gives. [page]
4. **The kit plan's "what the page fills and opens".** Messaging opens no slot of its own. It uses one slot of the workforce kit, `workerFlows` (flows beside the built-in `agent`): a flow an app puts there must carry the entry a message arrives on, or the kit refuses it. `kit:8-20`; `packages/workforce/src/workers/register.ts:117`. The views it serves are the log (a resource a browser reads) and two item types an app draws. [page]
5. **The page plan's two examples.** "A worker allowed to message": the lab's `researcher` file has a `tools:` line that does not list `sendMessage`, and it still sends. `sendMessage` is a control tool of the capability and a `tools:` line does not fence it out: `mt:121-123`, `mt:163`; `res:6`, `res:14-16`. So "a worker allowed to message" is every worker; nothing in its file allows it. The page should show a worker file that *tells* the worker when to message (the lab's Chief of Staff, `cos:23-25`, `cos:33-36`), not a switch. [page]
6. **The model-facing call is JSON, not TypeScript.** The model calls the tool; a reader does not call `sendMessage(...)` from their code in the common case. The examples are the tool's input as a JSON object (`mw:34-36`), plus the file that guides the worker. The exported helper `sendMessage(ctx, installation, flowKind, input, from, options)` exists (`sm:287-294`, exported `packages/workforce/src/messages/index.ts:44`) but is for server code in a block; the page does not need it. [page, one clause or none]
7. **Test and goal files name issue ids in headers and comments** (`mt:1`, `t3:2`, `g1:3`). None of them goes on the page. [cut]
8. **The goal's model names (`openai/gpt-5.4-mini`) and the lab's names are not page names.** Use `openai/gpt-6-luna` for any example that needs a model. [cut]

## 1. What it is (opening)

- A message is one line of text from one worker to another worker on the same user's roster. It wakes the recipient for a turn; the recipient decides what to do. `mw:12`; `mt:94-97`. [page]
- A message is not a task: no task record, no delegate, no result owed. `mt:2-4`; `mt:96-97`; `t1:114-145` (`await h.rows("alice")` is `[]`, line 142). [page]
- The worker's model sends one by calling a tool named `sendMessage`. `keys:140` (`SEND_MESSAGE_TOOL = "sendMessage"`). [page]
- Every worker on the built-in `agent` flow and the coordinator flow gets the tool on every turn, with nothing to turn on. `mw:22`; `packages/workforce/src/agent-worker-flow.ts:1090` (`board.messages` among the agent's capabilities); `mt:176` (`default: ["tools"]`). [page]
- The tool's description is rebuilt before each model call and lists the workers the sender can message, each by id and description (description cut to 160 characters, at most 25 workers listed). `mt:33`, `mt:109-118`, `mt:163-167`; `packages/workforce/src/messages/recipients.ts:184` (`MAX_LISTED_RECIPIENTS = 25`); test `t1:148` ("every roster worker the send would take, by id and description"). [page, one sentence; the 160 and 25 are **[ref]**]
- The sending worker itself, and workers that hear only in their tasks' sessions, are not listed. `mw:38`; `recipients.ts:205-221`. [page]

## 2. Question 1: can Alice's worker message Bob's?

- A worker can message any other worker on its own user's roster: the user's own hires and the standard workers from the app's files. `mw:24`; `sm:318-321` (the recipient is looked up through `installation.rosterWorker(ctx, to)`, the running session's user's roster). [page]
- A worker on another user's roster cannot be reached. The refusal is `no_worker: no worker "<id>" on your roster.`, the same text as for an id that does not exist, so a refusal tells the sender nothing about another user's workers. `sm:103`; `mw:24`; test `t1:1005` (`no_worker: no worker \"bob.friend\" on your roster`) and `t1:1014` (`logRows(h, "bob")` is `[]`). Goal `g1:21` (`4:bobs-worker-refused`: refused `no_worker:` and writes no row). [page]
- A refused send writes no row and spends none of the budget. `sm:297-299`, `sm:202-241` (the place is taken only after the checks; a refusal gives the count back); test `t1:1005-1014` (only `otto>rota` is a row). [page]
- Two users' standard workers are the same files, but each user's conversation with one is that user's own: a message lands in the recipient's conversation with *the sending user*. `sm:152-170` (`conversationAddress` derives the session from the running session's `userId` and `orgId`); `mw:74`. [page, one sentence]
- The text refused is the whole answer: the tool returns `{ ok: false, error }` and the model reads the error. `mt:88-92`; `mw:339-343`. [page]

## 3. Use it: Send and go on

The call and its input (strict: no other key is accepted):

- Input: `to`, `text`, optional `inReplyTo`, `replyRequested`, `wait`, `deadline`. `mt:36-73`. A call naming any other key is not taken. `mt:73` (`.strict()`); test `t1:1040`. [page]
- `to` is usually a worker's id. It can also be `{ task: id }` or `{ session: id }`. `mt:38-47`. [page, one sentence; the targets are K-09's or the Reference's] [ref]
- `text` holds at most 8,000 characters and must contain a non-blank character. A longer one is refused with `message_too_long`, not cut; a blank one with `empty_message`. `lr:226` (`MAX_MESSAGE_CHARS = 8_000`); `mt:49`; `sm:428-431`. [page, the 8,000]
- The result of a plain send is `{ sent: "msg_<20 hex characters>" }`. `mt:151-153`; `ml:127-129` (`msg_` + the first 20 hex characters of a UUID); test `t3:260` (`sent: expect.stringMatching(/^msg_/)`). [page]
- `{ sent }` means the message is written to the log and on its way, not that it has landed. `mw:46`; `sm:578-580`, `sm:44-47`. [page]
- The sender's turn goes on after a plain send. `mw:88`. [page]
- A plain message owes nothing. The recipient's turn that ends in plain text sends that text to no one; to answer, the recipient calls `sendMessage` back with `inReplyTo` set to the message's id. `mw:78-88`; `rx:21-22`; test `t1:206-224` ("a turn that ends in plain text sends nothing back"). [page]
- Not answering is allowed: the prompt the recipient reads says "If it needs no answer, don't send one: not answering is an answer." `rx:141-142`. [page, as the recipient's rule]
- An answer is a message sent with `inReplyTo`. `inReplyTo` must name a message the `to` worker sent this worker; anything else is refused `no_such_message`. `sm:322-326`; `mw:84`. [page, one sentence] An answer lands in the session the original was sent from. `sm:336-338`. [ref]
- Asking for a reply and going on: `replyRequested: true` on the send. The tool's result is still `{ sent }`, and the sender's turn goes on. `mt:55-58`, `mt:151`; test `t2:272-350`. [page]
- A message that asks for a reply always gets exactly one answer: the recipient's final text, or the framework's "no answer". The answer is sent back as a message from the recipient with `inReplyTo` set to the id of the original; it lands in the session that sent the original and wakes a turn there. `or:57-61`; `rx:24-31`, `rx:300-311`; `mw:100`; test `t2:272` ("is answered with the recipient's final text, as a message from it that lands in the asking session"). [page]
- The recipient's turn is told, in its prompt, that the sender asked for a reply and that its reply goes back when the turn ends. `rx:126-135`. [page, in plain words; the prompt text itself is **[ref]** or **[cut]**]
- If the recipient answers with `sendMessage` and `inReplyTo` during its turn, that is the answer, and the turn's final text is not sent too: one answer only. `mw:102`; `sm:516-529` (`claimAnswer`); test `t2:389` ("gets that answer only: the turn's final text isn't sent too"). [page]
- The answer spends none of the budget, and never asks for a reply itself. `mw:100`, `mw:320`; `or:122` (the answer is sent with `exempt`). [ref]
- The framework's "no answer" texts: the turn ended with no text, the turn failed, the recipient's flow runs no turn on messages, or the server stopped partway. The texts are in `or:57-61`; `mw:108-113`. The sender is never left without an answer. The row of a "no answer" has `noAnswer: true`. `lr:326`. [page, the idea in one sentence; the four texts are **[ref]**]
- A reply request to a worker that is known to run no turn on messages is refused `no_reply` before anything is sent. `sm:346-348`; `packages/workforce/src/messages/received-mark.ts:76-78`; test `t2:507` ("is refused no_reply before anything is written"). [ref]
- Asking several workers at once: send each a message with `replyRequested: true` in the same step. Each answer arrives as its own message and wakes its own turn in the sender's session. `mt:99-100`; test `t2:351` ("to two workers gets two answers, each its own message and its own turn in the asking session"). [page]
- The lab's Chief of Staff does exactly this: it messages `researcher` or `writer` with `replyRequested: true`, never passes `wait`, keeps answering the user in the same turn with what it has, and uses the reply "as its own message after your current answer". `cos:23-25`, `cos:33-36`. [page, as the example]
- Goal evidence: step 3 of the lab's goal checks the reply "shows in Lead's conversation under researcher's name, after Lead's answer to you", and that Lead's message asked for a reply, and that the log holds the answer as a delivered reply. `g2:17` (the lab's lead is Chief of Staff on disk; see the teammates facts sheet, flag 3). [page, as a described behaviour; never name the goal]

## 4. Use it: Ask and wait

- `wait: true` asks for a reply exactly as `replyRequested` does, so it needs no `replyRequested`. The difference is that the sender waits for the answer in the same turn. `mt:59-65`; `mw:125`. [page]
- `deadline` is in milliseconds, goes with `wait: true`, and is optional. A `deadline` passed without `wait: true` is refused `deadline_without_wait`. `mt:66-71`, `mt:148-150`. [page, one clause]
- A wait that names no deadline waits the host's default, five minutes. A host sets the default and the bounds with `waitDeadlines: { defaultMs, minMs, maxMs }` on `createFlowState`; the bounds default to one second and 24 hours. A deadline outside the bounds is refused `wait_deadline_out_of_range`, never clamped. `packages/engine/src/durability/wait-chain.ts:66-77`, `:86-93`; `de:369-380`; test `t3:313-324`. [page, "five minutes, set by the host"; the bounds **[ref]**]
- The three results a wait answers, as JSON:
  - answered in time: `{ "status": "answered", "sent": "msg_…", "reply": "…" }`. `mt:77-86`; test `t3:248-272` (output `toEqual({ status: "answered", sent: /^msg_/, reply: "The codename is Bluebird." })`). [page]
  - the framework answered for the recipient: the same with `"noAnswer": true`, and `reply` holds the reason. `wr:129-132`. [page]
  - deadline first: `{ "status": "running", "sent": "msg_…" }`. Nothing is stopped; the recipient keeps working; the sender goes on. The answer arrives later as a message and wakes a turn in the sender's session. `wr:158-166`; `mw:151-157`; test `t3:425` ("answers running at its deadline and stops nothing; the answer comes later as a message"). [page]
  - refused or undeliverable: `{ "status": "failed", "sent": "msg_…", "error": "not_delivered: …" }`. `wr:149-152`; `mw:167-173`. [page, one line]
- The model should never send the question again after `running`; the answer still comes. `mt:101-103`; `mw:157`. [page]
- `reply` holds at most 8,000 characters; a longer final text is cut. `rx:311` (`reply.slice(0, MAX_MESSAGE_CHARS)`); `mw:141`. [ref]
- With a wait, the answer is the tool's result, in the same turn, and no message lands in the sender's conversation. The answer gets its own row in the log. Test `t3:248` ("gets the recipient's answer as its tool's result, in the same request, and no message lands in its conversation"): `heardIn(h, otto)` is `[]`, line 269; one answer row, lines 265-267. [page]
- The tool returns as soon as the answer is given, even if the recipient's turn goes on afterwards. `mw:143`; `wr:103-126` (`wakeHeldWait`); test `t2:553`. [ref]
- A wait needs a host that can hold one: durable execution, a store that keeps wakes, and the durability sweeper (which resumes a wait at its deadline). On any other host the wait is refused `wait_unavailable`, nothing is sent, and it is never turned into a plain send; send with `replyRequested` there. `wr:39-43`; `mw:179`; test `t3:273-294` (not durable; the refusal; `logRows` is `[]`; the later plain send lands). Durable execution is on by default wherever the stores persist (filesystem, SQLite, Postgres) and `fsdev dev` / `fsdev run` get it over their local SQLite file. `de:11`, `de:28`. [page, one short paragraph on "where a wait can run"]
- **[verify]** whether an in-memory store holds waits: `de:367` says all four built-in adapters have a `wakes` store, but does not name them; the page should not claim that memory-only hosts wait or do not. [verify]
- One round of the model's tool calls can hold one wait. A second wait in the same round (or a `getTask` with `wait`) is refused `wait_already_pending`; to hear from several workers in one step, ask each with `replyRequested`. `mw:181`; test `t3:296-311`. [page, one sentence]
- Waits nest at most five deep (a wait whose recipient waits on another worker); the sixth is refused `wait_too_deep`. `packages/core/src/types/wait-gate.ts:60` (`MAX_WAIT_DEPTH = 5`); test `t3:467` ("is refused wait_too_deep at the sixth wait, before anything is sent"). [ref]
- If the user stops the sender's request while it waits, the wait ends with it; the recipient's turn runs on. `mw:165`. [ref]
- An answer to a message whose sender is still waiting for it may not itself pass `replyRequested` or `wait`: it is refused `reply_to_waiting`, because that answer goes back as the wait's result and a question in it would never be answered. `sm:328-335`; test `t2:534-551`. [ref]
- A wait sits behind whatever the recipient is doing. A recipient mid-turn takes the message after that turn ends. A conversation held by the user (stopped for approval or input) takes it once nothing holds it, and the wait's `running` answer then carries `"recipient": "waiting_on_person"`. `q:1-30`; `wr:165`; `mw:159-163`; test `t3:378` ("queues behind the stop, answers running at its deadline saying so, and the answer comes later as a message, sent once"). [page, one sentence]
- Choosing between the two: a plain send for an FYI; `replyRequested` when the sender wants the answer but can go on; `wait: true` when the sender needs the answer before it can go on. `mw:486`; the tool's own description: "To get the answer in this turn, pass wait: true instead." `mt:99-103`. [page: question 2's answer is wait]
- Question 2's answer, from the surface: a question that blocks the answer is **ask and wait**. If the host cannot hold a wait, or the deadline passes first, the answer arrives later as a message, so the worker should be told (in its file) what to do with a `running` result: go on, and use the answer when it arrives. `mt:101-103`; `wr:158-166`. [page]
- The Chief of Staff file's rule is the contrast: it "never" passes `wait` so it can keep answering the user. `cos:34-35`. [page, as the contrast]

## 5. Where you see it (question 3)

What the user sees in a conversation:

- The sender's side: the call is a `tool_output` item for the tool named `sendMessage` in the sending worker's session, like any tool call. An app matches on `SEND_MESSAGE_TOOL` to draw it as a line of its own. `keys:140`; `br:78`; `ad:991-993`; `mw:667`. [page]
- The recipient's side: a message that lands adds two items to the recipient's session. (1) A line the recipient's model reads in its history, `From <sender>: <text>`, role `user`, visibility `{ client: false, history: true }`, so it is never sent to the client. (2) A data item whose `dataType` is `workforce:received` (`RECEIVED_MESSAGE_DATA_TYPE`), visibility `{ client: true, history: false }`, for an app to draw. `rx:244-257`; `keys:22`; test `t1:133-138` (visibility of both items; `t1:134` matches `type === "data"` and `dataType`). [page]
- The data item's `value`: `{ id, from, text, inReplyTo?, budget, replyRequested?, noAnswer? }`. `rx:245-257`; test `t1:102` (reads `item.value`), `t1:132` (`{ id, from: "otto", text, budget: 5 }`). [page, as the example "the message as it appears in the conversation"; the fields are **[ref]**]
- `budget` in the item is how many more messages the exchange can send after this one: 5 for the first message under the default 6. `rx:230-237`; test `t1:132` (`budget: 5`). [ref]
- Then the recipient takes a turn on it (unless its flow runs no turn on messages; then the message lands as its two items and nothing runs). `rx:24`, `rx:298-300`; `mw:57`. [page]
- A recipient in the middle of a turn hears the message after that turn ends; if the same message is delivered twice, the recipient wakes once. `mw:59`; test `t1:1052`, `t1:1171`. [ref]
- Where a message lands (the recipient's own conversation with the user, or the session the original came from for an answer, or the conversation that filed the sender's task): `sm:336-340`; `mw:67-74`. [page, the first case; the table is **[ref]**]
- If the recipient has never talked with the user, its conversation is opened for the message. `sm:33-38`; `mw:74`; test `t1:126` ("the lead's conversation was opened"). [page]
- The user sees all of it. Both workers' sessions are the user's own, and a message, the turn it started and any answer are in them like any other item. `mw:63`. [page]
- The user can read a log of every message, on a screen an app writes. In Shift Manager, a Messages screen lists the log; a conversation shows each sent message as *To <worker>: <text>* and one that asked for a reply as *Asked <worker>* (*Asking <worker>…* while the call is running), and a refused one as *Not sent to <worker>*; a waited one shows the answer, or *No answer by the deadline yet. The answer comes as a message.*, under it. `tl:163-199`, `tl:152-160`. [page]
- A received message in Shift Manager is drawn as a line under its sender's name, with the time it landed, a link to Messages, *answering your message* when it answers one and *asks for a reply · the reply goes back* when the sender asked. `rm:15-45`. [page]
- In the Teammates lab, a worker's record in the list says *Messaging writer* while it is sending, and the conversation shows a *sent* line and a *received* line. `labs/teammates/README.md:12-17`; `ad:991-993` (sent entry), `ad:1013-1015` (received entry); `labs/teammates/src/components/flow-state/tool-grouping.ts:79` (`sendMessage: { singular: "sent a message", … }`). [page, one clause, as the example; the exact label wording belongs to K-02]
- The page's example "the message as it appears in the conversation" can be the two items of one exchange, from the test: the sender's `tool_output` and the recipient's `workforce:received` component (`t1:132`, `rx:244-258`), plus how the lab draws the received line. [page]

The log (the other place a user sees it; **stored parts, four questions**):

- Every message is one row in a log. The log's rows hold: `id`, `from`, `to`, `text`, `exchange`, `inReplyTo?`, `fromSession`, `fromFlow`, `toSession`, `toFlow`, `hop`, `chain?`, `status`, `reason?`, `replyRequested?`, `answeredBy?`, `noAnswer?`, `deadlineAt?`, `waitEndedAt?`, `waitGate?`, `queuedBehind?`, `takenBy?`, `deliveredAs?`, `deliveredAt?`, `resent?`, `toldAt?`, `at`, and for a task or conversation target `addressedBy?` and `toTask?`, and `toState?`. `lr:249-345`. [ref; the page names `from`, `to`, `text`, `status`, `inReplyTo` at most]
- `status` is one of `unconfirmed`, `delivered`, `refused`, `undeliverable`. `lr:246`; exported `MESSAGE_STATUSES` from the package root (`packages/workforce/src/messages/index.ts:21`). [ref; delivery states are the Reference's per the plan]
- How to read the log from a browser: `createWorkforceClient(fsd)` (from `@flow-state-dev/workforce/browser`), `ensureWorkerSession({ worker })` for a session, then `readEveryCollectionPage(fsd.resources, session.id, WORKER_MESSAGES_RESOURCE)` (from `@flow-state-dev/client`), and parse each item's `clientData` with `workerMessageResourceStateSchema` (see flag 1). `br:21-30` (`createWorkforceClient`), `br:86-91`; `packages/workforce/src/workers/client.ts:157`, `:171`; `packages/client/src/resource-client/read-every-page.ts:70`; `packages/client/src/index.ts:106`. Test `t1:178-204` reads the log through the user's roster session; `list("alice")` has the one row, `list("bob")` is `[]`. [page, one example; **[verify]** that the example type-checks in pass 4]
- `WORKER_MESSAGES_RESOURCE` is `"workforceMessages"`; its pattern is `"workforce/messages/*"`. `lr:219-222`. [ref]

Four questions, per stored part:

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| **The message log** (one row per message) | The user whose line started the exchange: user scope, `flowIsolation: false`, so it is shared across every flow the user's workers run on. `ml:65-73`; `ml:61-64` | The user's own sessions read it (`client: { state: { read: true } }`); another user's read returns none of it. Only the server writes a row; the sender, sessions and counts are never a tool input. `ml:72`; `lr:12-14`; test `t1:178-204`; goal `g1:22` (`5:lists-every-message`) | In the user's scope at `workforce/messages/*`, in the app's store (it persists as the store does: goal control `memory-log` fails `5:lists-every-message` after a restart, `g1:52`) | One row per message sent: every plain message, every answer (including the framework's "no answer"), every reply to a wait, every task question a filer is told. A refused send leaves none. `sm:476-513`; `mw:207`, `mw:239` |
| **The chain row** (the budget's count) | The user: user scope, `flowIsolation: false`. `ml:90-96` | The server only: the collection declares no client read. `ml:90-96` (no `client` key); `ml:88` ("Server-only") | In the user's scope at `workforce/message-chains/*`. `ml:76` | One per user line whose exchange sent a message; it holds the ids sent in it. `ml:75`, `ml:82` |
| **The two items of a landed message** | The recipient's session, which is the user's | The `workforce:received` component is sent to the client; the `From <sender>:` line is history only, never sent to the client. `rx:244-258` | In the recipient's session, with its other items | Two per landed message. An answer that a waiting sender holds lands as no item: it is the tool's result. `rx:203-208`; `mw:141` |
| **The sender's tool call** | The sending session, the user's | The client, like any tool call item | In the sending session | One `tool_output` per call, refused ones included |
| **The owed lists** (`workerMessagesOwed`, `workerRepliesOwed`) | The session, server-written | The server; not a part of any page | In session state | Cut. `keys:155`, `keys:164`. [cut] |

- A browser never sees another user's messages: "The read never returns another user's messages." `mw:663`; test `t1:178-204`. [page]
- Whether a user can *delete* a log row, or the log is pruned: **[verify]** nothing on the exported surface or in a test; the page must not say. [verify]

## 6. Slots (kit template: slots it opens, slots it fills, views it serves)

- The kit's `messages` config takes `{ budget?, perTurn? }`. `kit:101-102`, `kit:274`; `lim:17-22`. [page]
- Defaults: `budget` 6, `perTurn` 3. `lim:11`, `lim:14`. [page]
- Each must be a whole number of at least 1, or the hire throws, naming the key: `hireWorkforce: messages.budget must be a whole number of at least 1; got 0.` `lim:31-41`; test `t1:528`. [page]
- A fresh budget starts at each line the user types: at most `budget` messages for everything descending from that line, across every worker, parallel branches included; `perTurn` at most per request. The send that would pass the budget is refused `budget`; one past `perTurn` is refused `per_request_limit`. `lim:3-8`; `sm:202-207`, `sm:226`; test `t1:433-484`, `t1:486-505`, `t1:532-572`. [page, the idea and the two numbers; the limits' edge cases are **[ref]**]
- A refused send spends nothing; filing a task spends nothing; the answer to a message that asked for a reply spends nothing. `sm:297`; `mw:320`. [ref]
- The next user line starts a fresh budget. `mw:313`. [page]
- A woken turn is told how many more messages the exchange can send. `rx:126-145`, `rx:237`. [ref]
- The kit refuses a worker flow an app adds through the `workerFlows` slot that does not carry the message entry (`onMessageReceived`), and one that offers `sendMessage` without the pass that sends a message again; it names the flow. `packages/workforce/src/workers/register.ts:117`; `rx:108-120`; `packages/workforce/src/messages/delivery.ts:133-139`. [page, one sentence under "slots it fills"; the how-to is the Reference's and the workforce-folder page's]
- A flow of the app's own built with `defineSessionBoard` receives messages by spreading the factory's `entries`, `resources`, `sessionStateShape` and `serverOwned`, and sends them when `board.messages` is in the `uses` of the block that runs the model. `packages/workforce/src/conversation-board/session-board.ts:20-40`; `mw:500-515`. [page, as "change it"; code example from `mw:507-515`, **[verify]** type-check in pass 4]
- The hired worker's flow: a worker the user hires runs on the built-in `agent` flow and so receives and sends messages. `labs/teammates/src/adapter.ts:523` (see the teammates sheet, flag 7). [page, one clause]

## 7. Change it

- Raise or lower the limits: `workforce({ messages: { budget: 10, perTurn: 5 } })`. `kit:101-102`, `kit:274`; `mw:324-335`. (`hireWorkforce(installation, { messages })` is the lower-level spelling; the page uses the kit's.) [page]
- Change what a worker does about messages: its `WORKER.md` instructions. The lab's two files show both ends: Chief of Staff, "When you need a fact, message researcher with `sendMessage`; … Pass `replyRequested: true` … never pass `wait`" (`cos:33-36`); researcher, "when they asked for a reply, your answer here goes back to them; when they didn't, answer with `sendMessage`, `inReplyTo` set to their message's id" (`res:14-16`). [page, as the example's file]
- Stop one worker from being messaged by name: a worker flow built with `messageReceivedEntry({ ..., hears: "task-sessions" })` is refused by name with `task_sessions_only`. `rx:177-181`; `sm:107-111`. [ref; the coding workers are the example, K-02's]
- A worker that hears no message: not offered. Every worker flow on an installation receives messages. `mw:16`; `rx:108-120`. [page, one clause]
- `sendMessage` is not fenced out by a worker's `tools:` line. `mt:121-123`. [page, one sentence: a worker that lists its tools still sends]

## 8. What it will not do (limits)

- No task record, no result owed, no tracking: a message has no reporting line; to get a result the sender can count on, file a task. `mw:496`; `mt:96-97`, `mt:103`. [page, one sentence; the link is to delegating work]
- A message never reaches another user's worker. §2. [page]
- A message cannot name its sender, a hop count, or any other key. `mt:73`; `mt:7-9`. [ref]
- A message to a worker that hears only in its tasks' sessions (the coding workers) is refused by name with `task_sessions_only: "<id>" answers only from its tasks' sessions, so it can't be messaged by name. File it a task instead.` `sm:107-111`; test `t1:973-1021` (outputs[2]). [page, one sentence: names the coding workers; K-02's page names the lab's]
- A worker cannot message itself (`not_yourself`). `sm:102`. [ref]
- Messages never add to a task's depth or count toward `taskChainLimit`. `mw:498`. [ref]
- A consult is the other way to learn what another conversation already holds: it reads that conversation's finished turns, runs nothing there, and appears in no log. `mw:372-374`; `mt:104-107`. [page, one pointer sentence; consulting is not this page's job: links to K-0x if one exists]

## 9. Reference rows this page links to and does not state

These go to `reference/worker-messaging`; the page links.

- The delivery states and what each means (`unconfirmed`, `delivered`, `refused`, `undeliverable`); the resend schedule (first resend 2 seconds after the send, doubling up to 5 minutes, until delivered, refused or past `maxDebtAgeMs`, a day by default); which failures are waited out and which are final; that a message lands once; the line the sender gets when a message later cannot land. `mw:247-281`; `lr:246`. The 2-second and 5-minute figures are stated on the existing page (`mw:258`); the code takes them from orchestration's backoff (`packages/workforce/src/messages/delivery.ts:314`, `:389`), which this sheet did not read, so the Reference sheet must verify them. **[verify]**
- Every refusal code (`not_a_worker`, `empty_message`, `message_too_long`, `not_yourself`, `no_worker`, `worker_unavailable`, `task_sessions_only`, `no_task_session`, `no_session`, `not_a_conversation`, `task_running`, `no_such_message`, `budget`, `per_request_limit`, `not_delivered`, `deadline_without_wait`, `reply_to_waiting`, `wait_unavailable`, `wait_deadline_out_of_range`, `wait_already_pending`, `wait_too_deep`, `no_reply`). `mw:345-368`; the codes in `sm`, `mt`, `wr`, `packages/workforce/src/messages/message-target.ts`.
- The log row's full shape. `lr:249-345`.
- Messages to a task or a conversation (`{ task }`, `{ session }`) and where each lands. `mw:185-220`; `mt:38-47`.
- A task that asks a question tells its filer in one message; `service:<provider>` messages from an outside service. `mw:222-307`.
- Consult. `mw:370-482`.

## 10. Examples the page may use

1. **A worker file that tells the worker when to message** (from the lab's Chief of Staff, `cos:23-25`, `cos:33-36`): the paragraph about `sendMessage`, `replyRequested: true`, and never `wait`. The existing text may be quoted shortened; it is the lab's file, a public example. [page]
2. **The three call shapes as JSON**, taken from the existing page and checked against `mt:36-73`: a plain send (`mw:34-36`), `replyRequested: true` (`mw:95`), and `wait: true` with `deadline` (`mw:128`). Their results: `{ "sent": "msg_…" }` (`mt:153`), `{ "status": "answered", "sent": "msg_…", "reply": "…" }` (`wr:131`; test `t3:259`), `{ "status": "running", "sent": "msg_…" }` (`wr:165`). [page]
3. **The message as it appears in the conversation**: the `workforce:received` item's data from `rx:245-257`, e.g. `{ id: "msg_…", from: "researcher", text: "…", budget: 5 }` (`t1:132`). [page]
4. **Reading the log from a browser**: `mw:613-630`, with `workerMessageResourceStateSchema` in place of the stale name (flag 1). [page; type-check at pass 4]

## 11. Figure facts: *Two ways to ask*

- Timeline one (ask and go on): the sender's turn calls `sendMessage` with `replyRequested: true`; the call returns `{ sent }` at once; the sender's turn goes on and ends; the recipient takes its own turn; its final text goes back as a message; that message wakes a new turn in the sender's session. `mt:151`; `rx:300-311`; `mw:98-100`. Hatching on the stored message (the log row outlives the request, `ml:65-73`); dashed outline on each turn (a turn lasts one action run).
- Timeline two (ask and wait): the sender's turn calls `sendMessage` with `wait: true`; the turn waits; the recipient takes its turn; its answer is the call's result; the sender's turn goes on, the same turn. No new turn in the sender's session. `wr:158-166`; test `t3:248`. A short "deadline passes first" branch is `{ status: "running" }` and the answer comes later as a message (`t3:425`).
- Both leave a stored row per message and a stored row for the answer. `t3:265-267`.

## 12. Words to avoid (glossary)

- Say **message**, **worker**, **roster**. The retired names are listed in the glossary (`docs/contributing/glossary.mjs:384-393`, `:442-456`). The page uses none of them; the surface is `sendMessage`, `onMessageReceived`, `messages.budget`. [cut]
- Do not say "hop" on the page; the log's `hop` field is a Reference row. The page says "the budget". [page]

## 13. Revise round 1: what moved off the page

Moved to the Reference page (R-26, `reference/worker-messaging`), and the page links to it: the `no_worker` refusal text (§2); the answer when the recipient's turn ends empty or fails, and delivery states (§3); the `deadline` unit, the `running`, `failed` and `noAnswer` results, and the five-minute default (§4); `wait_unavailable` and the one-wait-per-round limit (§4); `task_sessions_only` (§8, was [page], now [ref]); the `workforce:received` entry fields, the `From <worker>:` model-only line and `budget` (§5); `budget` and `per_request_limit` and what each counts (§6). Moved to R-25: the `messages.budget` and `messages.perTurn` minimum-1 start-time error (§6). Moved to R-11: the startup refusal for a `workerFlows` entry that cannot receive messages (§6).

Page now states: the tool is always on (`mt:176`); `perTurn` is the most one turn sends (`lim:11-22`; the refusal code `per_request_limit` says "request" and is Reference-only); a flow added through `workerFlows` is built with `messageReceivedEntry`, exported from the package root (`packages/workforce/src/messages/index.ts:11`, re-exported at `packages/workforce/src/index.ts:166`; `messageReceivedProblem` in `received-mark.ts` names it as the fix); Shift Manager draws the `to` argument verbatim, so the example send reads *To teammates.researcher: …* (`tl:143-182`; worker ids are `<team>.<worker>`).

## 14. Revise round 2

- A message lands in the recipient's conversation with the sending user (`sm:152-170`); the page now says "that user" after naming Alice. An answer lands elsewhere (`sm:336-340`); the page does not claim otherwise. [page]
- "Durable execution" is glossed on the page as a host that can pause a turn and resume it later (`wr:39-43`; `de:11`). [page]
- `task_sessions_only` refuses only a message by id (`sm:107-111`); an answer, a `{ task }` or a `{ session }` target is not refused by it (`sm:101-103` comment; `mt:38-47`). The page says "by id", and the refusal text is Reference. [page]
- The `budget` is a fresh count per user line, shared by every worker in that exchange (`lim:3-8`). [page]
- The option table for `messages` moved from a closing line to the Next list. [page]

## 15. Revise round 3

- A worker whose flow hears only in its tasks' sessions (`messageHearingOf(...) === "task-sessions"`) is refused by id and not listed in the tool's description: `sm:107-111`; `recipients.ts:205-221`. The page says "answers only inside its tasks", with the coding workers as the example. [page]
- "Reporting line" is gone from the page; the point is "nobody owns a message and nothing has to come back" (`mt:96-97`). [page]
