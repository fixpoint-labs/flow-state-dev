# Fact sheet: Worker messaging (R-26, reference, `reference/worker-messaging`)

Pass 1. Cites only what a fact sheet may cite: existing user docs (`apps/docs/**`, `packages/workforce/README.md`), the
exported surface and its doc comments, tests, `goals/`, and one example (`labs/teammates`). No spec, issue, changeset,
`docs/internal`, `CLAUDE.md`, PR or commit message was read. Source files carry tracker ids in header comments; none of
them goes on the page.

Marks: **[run]** I ran it in this pass (the five workforce message test files, 88 tests, all green; plus a throwaway
vitest file, since deleted, that sent the tool odd inputs through a scripted agent and read the tool outputs).
**[test]** a committed test asserts it (the files are in the last column of the abbreviation table). **[read]** I read
the code and no test pins it; pass 5 should run it before the page states it. **[doc]** only an existing user page says it.

Legend for the page: **[table: X]** goes in table X. **[fig]** feeds the figure. **[cut]** history or mechanism, never on
the page. **[flag]** read the flags first.

All paths are under `/home/user/flow-state-dev/`.

| Abbr | File |
|---|---|
| `sm` | `packages/workforce/src/messages/send-message.ts` |
| `mt` | `packages/workforce/src/messages/message-tool.ts` |
| `wr` | `packages/workforce/src/messages/wait-for-reply.ts` |
| `rx` | `packages/workforce/src/messages/message-received-entry.ts` |
| `or` | `packages/workforce/src/messages/owed-replies.ts` |
| `lr` | `packages/workforce/src/messages/log-row.ts` |
| `ml` | `packages/workforce/src/messages/message-log.ts` |
| `lim` | `packages/workforce/src/messages/message-limits.ts` |
| `dl` | `packages/workforce/src/messages/delivery.ts` |
| `q` | `packages/workforce/src/messages/queue.ts` |
| `mtg` | `packages/workforce/src/messages/message-target.ts` |
| `rm` | `packages/workforce/src/messages/received-mark.ts` |
| `hop` | `packages/workforce/src/messages/hop.ts` |
| `lv` | `packages/workforce/src/messages/line-values.ts` |
| `keys` | `packages/workforce/src/messages/keys.ts` |
| `rcp` | `packages/workforce/src/messages/recipients.ts` |
| `wv` | `packages/workforce/src/messages/worker-messages-view.ts` |
| `ut` | `packages/workforce/src/standing-rules/user-turn.ts` |
| `reg` | `packages/workforce/src/workers/register.ts` |
| `br` | `packages/workforce/src/browser.ts` |
| `wot` | `packages/orchestration/src/tasks/helpers/wait-on-task.ts` |
| `tn` | `packages/orchestration/src/tasks/notice/task-notice.ts` |
| `wg` | `packages/core/src/types/wait-gate.ts` |
| `dsp` | `packages/core/src/types/dispatch.ts` |
| `wc` | `packages/engine/src/durability/wait-chain.ts` |
| `rw` | `packages/engine/src/durability/request-wakes.ts` |
| `dsw` | `packages/engine/src/durability/durability-sweeper.ts` |
| `rc` | `packages/engine/src/runtime-config.ts` |
| `mw` | `apps/docs/docs/workforce/messaging-workers.md` (existing page) |
| `de` | `apps/docs/docs/advanced/durable-execution.md` |
| `rt` | `apps/docs/docs/configuration/runtime.md` |
| `rd` | `packages/workforce/README.md` ("Worker messages", line 2424 on) |
| `t1` | `packages/workforce/test/worker-messages.test.ts` |
| `t2` | `packages/workforce/test/worker-reply-requested.test.ts` |
| `t3` | `packages/workforce/test/worker-reply-wait.test.ts` |
| `t4` | `packages/workforce/test/worker-messages-delivery.test.ts` |
| `t5` | `packages/workforce/test/worker-messages-targets.test.ts` |
| `t6` | `packages/workforce/test/worker-messages-recheck.test.ts` |
| `lab` | `labs/teammates/src/components/Conversation.tsx`, `labs/teammates/src/lib/talk.ts` |

## 0. Flags (read first)

1. **`empty_message` and `message_too_long` are not returned to a model.** [run] The tool's input schema caps `text` at
   8,000 characters and requires a non-blank character (`mt:206`), so a model's call with 8,001 characters or only spaces
   fails input validation before `execute` runs. The tool output is
   `{"message":"Block \"sendMessage\" input validation failed at \"text\": String must contain at most 8000 character(s)"}`
   and, for blank text, `... at \"text\": say something`. It is not `{ ok: false, error: "message_too_long: ..." }`. The two
   codes are answered only when server code calls the exported `sendMessage(ctx, installation, flowKind, input, from)`
   directly (`sm:428-431`). `mw:349-350` and `rd` list both as codes the tool returns. The page should say: over 8,000
   characters or blank is refused as an input error, and the two codes belong to the exported function. Pass 5: run it
   again before stating.
2. **A received message is a `data` item, not a component item.** The page `mw:55` says "a component item of type
   `workforce:received` (`RECEIVED_MESSAGE_COMPONENT`)". Neither the constant nor the item kind exists. The constant is
   `RECEIVED_MESSAGE_DATA_TYPE = "workforce:received"` (`keys:22`), the item is emitted with `emit.data` (`rx:245`), and a
   test reads it as `item.type === "data" && item.dataType === "workforce:received"` (`t1:76-78` helper, used at
   `t1:132`). `rd:2869` also names `RECEIVED_MESSAGE_COMPONENT`, `workerMessageRowSchema` and `WorkerMessageRow`; none
   exists in `packages/workforce/src`. The real names are `workerMessageResourceStateSchema` and
   `WorkerMessageResourceState` (`lr:47`, `lr:145`; exported from the root `messages/index.ts:24,28` and from
   `@flow-state-dev/workforce/browser`, `br:119-125`). The page uses the real names.
3. **A refused first delivery of a waited send is an error result, not `status: "failed"`.** [read] The existing page
   (`mw:167-173`) says a wait "answers `failed` when its message was refused or couldn't be delivered" and shows
   `{ "status": "failed", ..., "error": "not_delivered: ..." }`. In code: a final refusal on the send's own dispatch makes
   `sendMessage` return `{ ok: false, error: "not_delivered: ..." }` (`sm:574-577`), and the tool returns that as its
   result (`mt:341`), the same shape as any refusal. `{ status: "failed" }` comes only from the wait path reading the row
   later as `refused` or `undeliverable` (`wr:149-151`), from a row with no record (`wr:161`, `wr:147`), or from the
   waiting call throwing (`mt:333-338`, line only). No test runs the `status: "failed"` result for a refused row; pass 5
   should run it and settle which cases the page names. [flag]
4. **Which hosts can hold a wait.** `mw:179` (`wait_unavailable`) names three needs: durable execution, a store that keeps
   wakes, a running sweeper. The catalog draft says `fsdev dev` and `fsdev run` have them. `de:46` says the opposite for
   `fsdev run`: "A one-shot command such as `fsdev run` sweeps nothing". The code agrees with `de:46`: a wait is offered
   only when `host.resumeWait`, `host.hasWaitSweeper === true` and `host.waits` all exist (`wg:239-242`); the sweeper that
   registers as a wait sweeper is built by `createFlowApiRouter` (`engine/src/routes/createFlowApiRouter.ts:571-585`),
   which `fsdev run` does not build (`packages/fsdev/src/commands/run.ts` calls `runAction` directly, line 536) [read]. The
   page lists hosts as `de:44-46` does (a process that serves the routes: `fsdev dev`, `fsdev serve`, a self-hosted server,
   `createFlowApiRouter`) and does not list `fsdev run`. Pass 5 should run a `wait: true` send under `fsdev run` before
   the page states either.
5. **"Reply shows as a pending line" is the Teammates lab's drawing, not the framework's.** The row from the starter page
   (`teammates.record.md` → R-26) says a reply "shows as pending until it lands after the current answer". In the lab it is
   a line drawn for a row whose `status` is `unconfirmed` and whose received item has not been read (`lab`
   `talk.ts:39-42` `pendingFor`; `Conversation.tsx:32-34`). The framework fact is the one in section 5 below.
6. **`MESSAGE_RECEIVED_ENTRY` is imported by existing examples but not exported.** See section 8.
7. **Unchecked here:** the `status: "failed"` result (flag 3); the `fsdev run` wait (flag 4); a recipient that answers a
   waited message with `sendMessage` and then keeps running (`mw:143`: the tool returns at the answer) is [test]
   (`t2:553-577`).

## 1. Rows other pages moved here (each checked)

All nine rows grep returns for `→ R-26` are carried. Where I changed or narrowed one, it says so.

| Moved row (from) | Verdict | Where in this sheet |
|---|---|---|
| Message delivery states: never interrupts a running turn; reply "pending" (`teammates.record.md:81`) | **Carried, narrowed.** The never-interrupts half is true [test]. The "pending" wording is the lab's UI (flag 5), so the page states the log fact instead. | 5.3, 5.6 |
| `no_worker` for another user's roster and for an unknown id, identical text, nothing written (`messaging.record.md:91`) | **Carried.** True [test]. | 4 (`no_worker`) |
| Delivery states and failure answers: what the reply carries when the turn ends empty or fails (`:92`) | **Carried.** Four texts [test for three; `stopped` [test] too]. | 5.5 |
| Ask-and-wait fields: `wait`, `deadline` (ms), tool-result shapes (`:93`) | **Carried.** Result shapes verified; one case corrected (flag 3). | 6.1, 6.2 |
| Ask-and-wait limits: `running` on deadline, nothing stopped, five-minute default and host override (`:94`) | **Carried.** True [test]; the override is `waitDeadlines`. | 6.3, 6.4 |
| `wait_unavailable` and one wait per round (`:95`) | **Carried, with flag 4.** | 6.5, 4 |
| `task_sessions_only` (`:96`) | **Carried.** True [test]. | 4 |
| Message fields and the `workforce:received` entry, the model-only `From <worker>: ...` line (`:97`) | **Carried, with the item-kind correction** (flag 2). | 2, 3 |
| `budget` and `per_request_limit`: what each counts, a refused send spends nothing, when a budget resets (`:99`) | **Carried.** True [test]. | 4, 7 |

Not mine, left alone: the startup refusal for a `workerFlows` entry that cannot receive messages (`→ R-11`) and the
`messages.budget` / `messages.perTurn` kit option rows (`→ R-25`). Section 7 states the option once because the budget
rows need it; R-25 owns the kit's config table.

## 2. Message fields: the log row

The log is one row per message, a user-scoped resource collection. `lr:47-143`. [table: message fields]

| Field | Type | What it holds | Cite |
|---|---|---|---|
| `id` | string | `msg_` + 20 hex characters. A framework answer is `a:<id of the message it answers>`; a task's midway question is `q:<task id>:<question id>`. | `ml:101-103`; `or:40-42`; `dl`/`midway-question.ts:35-37` |
| `from` | string | The sending worker's id. For a service's event, `service:<provider>`. | `lr:50`; `sm:377-383` |
| `to` | string | The recipient worker's id. | `lr:52` |
| `addressedBy` | `"task"` or `"session"`, optional | How the sender addressed it. Absent when addressed by worker id. | `lr:58`; `sm:349` |
| `toTask` | string, optional | The task, when `addressedBy` is `task`. | `lr:60` |
| `forward` | `{ as: "addressed" or "inferred", url }`, optional | A service event no other subscription heard, forwarded to a coordinator's unmatched subscription. Set by the server, never by a model. | `lr:68` |
| `text` | string | The message. At most 8,000 characters. | `lr:69`; `lr:24` |
| `exchange` | string | The id of the first message in this exchange: its own id, or the exchange of the message it answers. | `lr:71`; `sm:491` |
| `inReplyTo` | string, optional | The message this one answers. | `lr:73` |
| `fromSession`, `fromFlow` | string | The session and flow the sending turn ran in. Where an answer lands. | `lr:75-77` |
| `toSession`, `toFlow` | string | Where the message is delivered. | `lr:79-80` |
| `toState` | `Record<string,string>`, optional | The state a worker's derived conversation is opened with. | `lr:82` |
| `hop` | integer ≥ 1 | This message's place among the worker messages since the user's last line, across the whole exchange. | `lr:84`; `sm:242-243` |
| `chain` | string, optional | The id of the user's turn the exchange descends from. | `lr:86` |
| `status` | `unconfirmed`, `delivered`, `refused`, `undeliverable` | See section 5. | `lr:44`, `lr:87` |
| `reason` | string, optional | Why it was refused or undeliverable, or why the last send failed. | `lr:89` |
| `replyRequested` | `true`, optional | The sender asked for a reply (`replyRequested: true` or `wait: true`). | `lr:97` |
| `deadlineAt` | epoch ms, optional | When a waiting sender stops waiting. Set only for `wait: true`. | `lr:103` |
| `waitEndedAt` | epoch ms, optional | When the waiting sender stopped waiting with no answer yet. | `lr:110`; `wr:162` |
| `waitGate` | `{ gateId, requestId }`, optional | Bookkeeping for the parked wait. | `lr:118` |
| `answeredBy` | string, optional | The id of the message that answered this one. Set once. | `lr:121`; `sm:523-529` |
| `noAnswer` | `true`, optional | This message is the framework's "no answer" to the one it answers. | `lr:124` |
| `queuedBehind` | `"user"`, optional | The message is taken but waits because the user holds the recipient's conversation. Cleared when it lands. | `lr:130`; `q:283`, `q:278` |
| `takenBy` | string, optional | The request that took it. | `lr:133` |
| `deliveredAs`, `deliveredAt` | string, number | The request it landed in, and when. | `lr:135-136`; `dl:290` |
| `resent` | `{ n, at }`, optional | How often the sending session sent it again, and when last. | `lr:138`; `dl:387-388` |
| `toldAt` | number, optional | When the sending session was told it was refused or couldn't be delivered. | `lr:140` |
| `at` | epoch ms | When it was sent. | `lr:142`; `sm:503` |

- The row's schema is exported: `workerMessageResourceStateSchema`, type `WorkerMessageResourceState`, `MESSAGE_STATUSES`,
  `MAX_MESSAGE_CHARS` (root: `messages/index.ts:19-29`; browser: `br:119-125`). [test: `t1:178-205` reads the log through
  the user's session]
- `isOpenMessage(row)`: a row is open while `status` is `unconfirmed`, or while it asked for a reply that has not come
  (`replyRequested` and no `answeredBy`) and is neither refused nor undeliverable. Exported from the browser entry.
  `lr:153-156`; `br:120`. [read] (`wv` tests: `packages/workforce/test/worker-messages-view.test.ts`, not run here)
- A row is written by the server only, from the sending turn's own session. The sender, the hop and the sessions are never
  tool input. `lr:11-12`; `mt:230` (input is strict); `t1:1062-1071` [test]. A text `from` key in the input is rejected as
  an unrecognised key [run].

### 2.1 The four storage questions, for each stored part

| Stored part | Who owns it | Who can see it | Where it is stored | How many |
|---|---|---|---|---|
| **Message row** | The server writes it, from the sending turn. No worker or model writes a field. `lr:11-12`; `ml:33` ("nobody writes them but the server"). | The user the sender acts for, through a client read of their own rows. Another user's id answers as unknown. `ml:34` (`client: { state: { read: true } }`); `wv:15-16`. `t1:178-205` [test]. | User scope, shared across flows (`flowIsolation: false`), at `workforce/messages/*`, accessor `workforceMessages`. `lr:17`, `lr:20`; `ml:27-31`. Persists as far as the host's store for user-scoped resources does. | One per message, including each framework answer, each midway question and each service event. Nothing in `packages/workforce/src` deletes a row [read]. A row stays after it is `delivered`. |
| **Chain row** | The server. `ml:61-62` ("Server-only"). | Not readable by a client: no `client` setting on the collection. `ml:64-70`. | User scope, at `workforce/message-chains/*`, accessor `workforceMessageChains`. `ml:50-53`. | One per user's turn whose exchange sent a message; it holds the ids of the messages sent in that exchange, in order. A send is added only while the chain has a place left. `ml:56`; `sm:230-233`. Server-sent messages (exempt) are not added. `sm:254-258`. |
| **Owed lists** [cut from the page: not readable by an app] (`workerMessagesOwed`, `workerRepliesOwed`) | The server; session state marked server-owned. `dl:57-60`; `keys:36`, `keys:45`. | Not the client. | The sending session's state (messages sent and not landed) and the receiving session's state (reply-requested messages landed and not answered), each entry `{ id, by }` (`by` is the request). `dl:48`, `dl:56-60`. | One entry per message in flight; an entry is dropped once the message lands, ends, or (for replies) is answered. `dl:393`; `or:164`. [read] |
| **Hop and chain on the session** (`workforceMessageHop`, `workforceMessageChain`, `workforceUserLines`) | The server. `hop:39-51`, `hop:64-68`. | Not the client. | The session's state. | One of each per session. |
| **The two items a received message adds** | The server, in the recipient's session. | The `From <worker>: <text>` line: the recipient's model reads it, the client never gets it. The `workforce:received` data item: the client draws it, the model never reads it. `rx:244`, `rx:256`; test `t1:132-139`. | The recipient's session, as items of the request that took the message. | Two per landed message. |
| **The send's own line** (`workforce:sent`) | The server, in the sender's turn, one per `sendMessage` call, refused calls included. Keyed by the call, so a waited send's answer replaces the first write. | The client only (`itemVisibility: { client: true, history: false }`). `mt:283-286`; `lv:84-97`. | The sender's session. | One per call. |

## 3. What the recipient gets (fields of a landed message)

- A landed message makes two items in the recipient's session. `rx:241-257`. [table: message fields; see 2.1]
  - A message item, role `user`, `agentName` = the sender, text `From <sender>: <text>`, visible to the model (`history`),
    not to the client. `rx:244`. [test `t1:132-139`]. It is written as a `user` line so the recipient's model does not read
    the sender's words as something it said.
  - A `data` item, `dataType` `workforce:received`, `agentName` = the sender, visible to the client, not to the model.
    `rx:245-257`. Its `data` is `{ id, from, text, inReplyTo?, budget, replyRequested?, noAnswer? }`. Type
    `ReceivedMessageValue`, exported from the browser entry (`lv:61-75`; `br:97-102`). [test `t1:132`: for a plain message
    the value is exactly `{ id, from, text, budget }`]
- `budget` in the item and in the turn's input: how many more messages the exchange can send after this one,
  `max(0, budget − max(row.hop, number of messages in the chain so far))`. It is the chain's count at hearing time, not
  at send time, so a message queued behind a busy recipient shows what is left when it is heard. `rx:227-238`;
  `t1:132` (budget 5 for hop 1), `t1:1119-1170` [test].
- `replyRequested: true` on the item when the sender asked for a reply or waited. `rx:253`. `noAnswer: true` when the
  message is the framework's "no answer". `rx:254`. `inReplyTo` when it answers something. `rx:251`.
- The turn's input (`MessageReceived`): `{ id, from, text, replyRequested?, inReplyTo?, budget }`, no `noAnswer` (only the `workforce:received` data value carries it). `rx:76-93`, `rx:231-256`. Exported from the package root only, not `/browser`:
  `messageReceivedSchema`, `MessageReceived`, `receivedMessagePrompt`, `promptedMessageTurn`, `messageReceivedEntry`
  (`messages/index.ts:10-18`). The built-in and coordinator flows use them with no setup.
- The turn is told, in words: the message id, who sent it, how to answer (`sendMessage` with `to` the sender and
  `inReplyTo` the id), that not answering is allowed, and how many more messages the exchange can send. For a message that
  asked for a reply, it is told the final text goes back as the answer and that answering with `sendMessage` and
  `inReplyTo` instead sends nothing more. `rx:126-145`. The page may quote the prompt as an example (`mw:517-537`). [test
  `t1:286-330`: "hands the recipient's model a heard message as another's words"]
- The entry's request output is the turn's final text, `{ reply }`, cut to 8,000 characters, once it landed a message; no
  reply from a copy; `{ turnless: true }` when the flow runs no turn. `rx:166`, `rx:294-313`. [read]

## 4. Refusals

A refused send answers `{ ok: false, error }` and writes nothing. The error starts `<code>: <text for the model>`. `sm:413`;
`mt:322-325`. Every row below spends no budget; where a code is raised after the budget place is taken, the place is given
back (`sm:236-241`, `sm:512`). [table: refusals]

Order of checks (the first that fails answers): the input schema, validated by the tool before `execute` runs, so a failure
is an input error and not `{ ok: false, error }`; then in `execute`: `refuses?.(ctx)` (a flow hook, `mt:170`), then
`deadline_without_wait` (`mt:189`), then in `sendMessage` (`sm:287-351`): the session runs a worker, the text checks, the
target, the recipient, `inReplyTo`, reply-request possibility, then the budget (`sm:476`). `mt:161-192`.

| Code | Raised when | Cite | Pinned |
|---|---|---|---|
| `not_a_worker` | The sending session runs no worker. | `sm:297` | [read] |
| `empty_message` | `text` is blank, from the exported function. Via the tool: input error (flag 1). | `sm:428` | [run, via tool] |
| `message_too_long` | `text` over 8,000 characters, from the exported function. Via the tool: input error (flag 1). | `sm:429-431` | [run, via tool] |
| `not_yourself` | `to` is the sending worker, or the target session is the one the message is sent from. An answer from another of the worker's own conversations goes through (the answering exception). | `sm:102`, `sm:327`; `mtg:97` | [test `t1:1031`, `t5:403`] |
| `no_worker` | No worker with that id on the sender's user's roster. The text is `no worker "<to>" on your roster.` for an unknown id and for another user's worker alike. For `{ task }`/`{ session }`: the worker that runs the session has been fired (text names the session). | `sm:103`; `mtg:77` | [test `t1:1027-1028`: both texts match; nothing written, `t1:1033-1037`] |
| `worker_unavailable` | The worker is on the roster but cannot run: its saved row can't be read, or it has moved to another flow since the session opened. The error says why. | `sm:104`; `mtg:78-81` | [test `t4:345`] |
| `task_sessions_only` | The recipient's flow hears messages only in its tasks' sessions (`hears: "task-sessions"`, as the coding worker does). Applies to a send by worker id, not to an answer. Text: `"<to>" answers only from its tasks' sessions, so it can't be messaged by name. File it a task instead.` | `sm:107-111`; `rm:143-147` | [test `t1:955-993`, `t1:1029`] |
| `no_task_session` | `{ task }` names no task of the user's that has a session: unknown id, a task that hasn't started, a plan step, an id held in more than one conversation, or another user's task. One text for all. | `mtg:62-63`; `mtg:107-117`, `mtg:125-139` | [test `t5:226-249`] |
| `no_session` | `{ session }` names no conversation of the user's: it doesn't exist, or belongs to another user, organization or tenant. Also answered when the host can't read sessions: text adds "This host can't check a session, so only a worker's name reaches one." | `mtg:61-67` | [test `t5:399-400`] |
| `not_a_conversation` | `{ session }` names a session that works a task, a delegate's session, or a session of a worker that hears only in task sessions. | `mtg:70-74`, `mtg:83-88` | [test `t5:398`, `t5:402`] |
| `task_running` | `{ task }` names a task of a worker that hears only in task sessions, and the task or a follow-up in its session is not yet in a terminal status. Once all have ended, sending the same message again succeeds (a refused send writes no row). | `mtg:89-95` | [test `t5:256-294`] |
| `no_such_message` | `inReplyTo` names no message the `to` worker sent this worker; or `inReplyTo` is passed with `{ task }` or `{ session }`. Two different texts. | `sm:309-311`, `sm:324-326` | [run] |
| `reply_to_waiting` | An answer passes `replyRequested` or `wait`, but the message it answers is one whose sender is still waiting for it (has a deadline, no `waitEndedAt`, no `answeredBy`). Answer without them. | `sm:328-335` | [test `t2:534-552`, `replyRequested` only; `wait` shares the same branch [read]] |
| `no_reply` | `wait: true` or `replyRequested: true` to a destination flow whose `onMessageReceived` was built with no turn (`runsTurn === false`). Refused only when the sender can tell before sending; otherwise the framework answers "no answer" (5.5). For an answer, the check runs against the original sender's flow. | `sm:344-348`; `rm:195-208` | [test `t2:506-529`, `t3:337-386`] |
| `budget` | This send would be the (budget+1)th worker message in its chain, counting parallel branches. Text tells the worker to stop passing messages on and say so. | `sm:202-207`, `sm:232-241` | [test `t1:432-466`, `t1:508-530`] |
| `per_request_limit` | This request already sent `perTurn` messages. Checked first; given back if the chain has no place left. | `sm:219`, `sm:225-227` | [test `t1:532-554`] |
| `not_delivered` | The recipient's host refused the first delivery for good (final refusal, 5.2). Text: `the message to "<to>" was refused (<refusal>: <detail>).` Also the answer to a repeat of a send whose row ended `refused` or `undeliverable`. The row is `refused`. | `sm:574-577`; `sm:436-438` | [test `t4:218-233`, `t4:504-522`] |
| `deadline_without_wait` | `deadline` passed without `wait: true`. | `mt:345-347` | [run] |
| `wait_unavailable` | `wait: true` on a host that can't hold a wait (4.1, flag 4). Text: `this host can't hold a wait (it needs durable execution, a store that keeps wakes and a sweeper that resumes waits at their deadline). Nothing was sent. Send with replyRequested and without wait, and the answer comes back as a message.` Never turned into a plain send. | `wr:39-43`; `wot:355` | [test `t3:284-305`; `t3:298` code] |
| `wait_deadline_out_of_range` | `deadline` is not finite, or is below `minMs` or above `maxMs`. Text: `deadline must be from <min> to <max> ms; <n> is outside it. Nothing was written.` (the tool rewrites the last words to "Nothing was sent."). Never clamped. | `wot:357-365`; `wr:52` | [test `t3:324-335`] |
| `wait_too_deep` | The wait would be the sixth in its chain. Text: `waits nest at most 5 deep, and this one would make <n> in its chain ...`. | `wot:366-367`, `wot:385-400`; `wg:60` | [test `t3:479-512`] |
| `wait_already_pending` | This model step already waits on something: another `wait: true`, or `getTask` with `wait`. Text: `this step already waits on something. Wait again on a later step.` Waits one after another across steps are fine. The step is claimed last, so a wait refused for depth does not hold it. | `wot:370-375` | [test `t3:307-322`] |

- The two wait refusals that also exist for `getTask` (`wait_taken`, `wait_not_filer`, `wait_on_conversation_result`,
  `wait_on_plan_step`) are not reachable from `sendMessage`: `checkWaitable` returns only the four in `WaitableRefusal`
  (`wot:322`). [cut: not on this page]
- A recheck on resend can also end a message `refused` with any recipient code above, and with `task_moved` (a task that
  is now worked in another session): `task_moved: task "<id>" is worked in another session now, so this message can't
  reach it. Send it again if it still matters.` `sm:137-139`; `t6:26-29` [test]. It lands in `reason` on the row, not as
  a tool refusal.
- A refusal is also one `workforce:sent` line with `refused` set to the error, so an app can draw it. `mt:320-325`;
  `lv:95-96`. [test `line-items.test.ts:103`]

### 4.1 Reply and wait: where the refusal text for an unrecoverable ask comes from

- `no_reply` text: `no_reply: "<to>" takes messages but runs nothing on them, so no reply comes back. Send without replyRequested or wait, or file it a task. Nothing was sent.` `rm:206-208`; `sm:347`. [test `t2:514`, `t3:357`]

## 5. Delivery

### 5.1 States [table: delivery states] [fig]

Four values of `status`. `lr:44`; `lr:87`. `mw:251-256`.

| `status` | Meaning | Final? | Cite |
|---|---|---|---|
| `unconfirmed` | Written to the log; the recipient has not landed it. "Taken but not yet delivered" is still `unconfirmed`: `takenBy` is set. | No | `sm:502`; `dl:260-276` |
| `delivered` | It landed in the recipient's conversation (both items stored, then marked). | Yes | `dl:282-294`; `rx:260-265` |
| `refused` | It cannot be delivered. `reason` says why. | Yes | `dl:209-223` |
| `undeliverable` | Nobody had taken it by the host's debt age (`maxDebtAgeMs`). | Yes | `dl:356-359` |

Transitions for the figure (A message's states). [fig]

- A send writes the row `unconfirmed`. `sm:483-505`.
- `unconfirmed` → `delivered`: the recipient's `onMessageReceived` request takes the row (writes `takenBy`, one guarded
  write, only while `unconfirmed`), stores the two items, then marks it. The mark is guarded on the same request's take.
  `dl:260-294`; `rx:198-265`. [test `t4:267-334`: heard once at any distance; taken over from a taker that ended;
  marked only once its items are stored]
- `unconfirmed` → `refused`: (a) the send's own dispatch refused for good, `sm:574`; (b) a resend's recheck of the
  recipient fails, `dl:371-373`; (c) a resend's dispatch refused for good, `dl:380-383`. Written only while `unconfirmed`
  and not taken; for a taken message only when it is past the debt age (`force`). `dl:209-223`, `dl:372`, `dl:383`.
- `unconfirmed` → `undeliverable`: owed past the debt age, never taken. `dl:356-359`. A message that was taken is never
  ended `undeliverable` for its age, because its taker may hold it while it waits on the user; once past the age and the
  recipient is gone (recheck refuses, or a final dispatch refusal on a resend) it is force-ended `refused`. `dl:360-384`. [test `t4:353-380`]
- `status` does not change once `delivered`, `refused` or `undeliverable`: the end writes and the delivered mark both check
  `status === "unconfirmed"`. `dl:218`, `dl:289`. Other fields are written after the end: `toldAt` (`dl:347-351`, `tellSender`), `answeredBy` (`sm:523-529`, claimAnswer), `waitEndedAt` (`wr:~178`).
- Side marks, not states: `queuedBehind: "user"` (taken, waiting for the user), `resent` (how many times it was sent
  again), `answeredBy` (a reply-requested message's answer came), `waitEndedAt` (a waiting sender gave up).

Pass 6 note for the figure: the highlighted idea is that a message is `unconfirmed` until the recipient lands it, and three
of the four states are final.

### 5.2 Send again until it lands

- While `unconfirmed`, the sending session sends it again from its board pass. The first resend is due 2 seconds after the
  send (`NOTICE_DUE_MS = 2_000`); then the next is the last resend's time plus `2 s × 2^n` (n = resends so far), at most
  300 s. `tn:108`, `tn:149`, `tn:480-483`; used at `dl:363`, `dl:390`. `mw:258`. [read; `t4:172-216` run the resend, not
  the exact gaps]
- Stops when the message is `delivered`, `refused` or past the debt age. `dl:345-359`.
- Debt age: `maxDebtAgeMs`, default 86,400,000 ms (24 hours). A host option; `rt:63`; `rw:79`; `dl:324`, `dl:45`. The
  undeliverable reason text reads `it couldn't be delivered within <N> minutes`. `dl:357`. [test `t4:353-366`]
- Failures that are waited out (the message is sent again): `dispatch-rejected` (the recipient's host is busy under a
  reject policy), `no-dispatch-operation`, `flow-not-found`, and a dispatch that throws (the error text goes in `reason`).
  `dl:176-178`, `dl:376-379`; `sm:568-571`. [test `t4:172-216`]
- Failures that are final: every other `DispatchRefusal`: `no-entry` (the flow declares no `onMessageReceived`),
  `session-not-found`, `session-not-addressable`, `key-occupied`, `create-refused`, `external-flow-runner`, `no-sender`.
  `dsp:484-516`. The page's own summary: no entry for messages, the session is missing or can't be addressed, creating the
  session was refused (`mw:267`). `reason` is `<refusal>: <detail>`. `sm:573`. [test `t4:218-233` (`session-not-found`)]
- Each resend checks the recipient again as the send did, without the budget. A recipient fired after the send is refused
  `no_worker` or `worker_unavailable`. `dl:368-373`; `sm:124-144`. [test `t4:336-352`, `t6`]
- [page: "heard once, however many times it is sent again"; the taker rules are cut] Delivery is heard once: the take is one guarded write; a copy finding a live taker runs nothing; one finding a taker that
  ended without delivering takes over. `dl:260-276`; `rx:198`. [test `t1:1193-1217`, `t4:267-334`]
- A resend of a send under a server-chosen id is one message; the repeat writes no row and pays no budget. `sm:420-450`.
  [test `t4:445-522`] [cut: server code only]

### 5.3 A message waits; it never interrupts

- A recipient in the middle of a turn hears the message after that turn ends, never inside it, and nothing is dropped.
  The entry runs with the `defer` concurrency policy on the conversation's reply line. `rx:342`;
  `conversation-board/task-settled.ts:187`. [test `t1:1074-1117`]
- The message also waits while the user holds the recipient's conversation: a request of the session is stopped for the
  user (approval or input), or, in a task's session, the task has an open hold (a stop for the user or a question). It
  lands when nothing holds it, and the row has `queuedBehind: "user"` meanwhile. `q:167-195`, `q:267-300`. [test
  `message-queue.test.ts`, `t3:388-433`: not run here by name; in the five-file run `t3` is green]
- A request stopped for the user holds the message until that request **ends**, not merely resumes. `q:176-179`. [test
  `t3:424-427`]
- A hold that is a task's wait on something outside the board (an `external` hold, such as a coding task waiting on its
  pull request) never queues a message: the message's words answer that wait, and no turn of the session runs on it.
  `q:190-193`, `q:242-259`; `rx:209-222`. [test `message-to-a-waiting-task.test.ts`, not run]
- On a host that can't hold a wait, a message is not queued; it lands as soon as it is taken. `q:269-271`. [read]
- A message whose queue park would pass 5 deep is not admitted: its request ends without landing it and the sender's pass
  sends it again. `q:282`; `q:187-189`. [read]
- A task session that is working a turn: a message to it runs after that turn. `rx:315-317`; `t5:134-185` [test].

### 5.4 The sender hears when it can't land

- If the recipient's host refuses the first delivery for good, the tool answers `not_delivered` (section 4). `sm:574-577`.
- If a message can't land after the tool answered `{ sent }` (a late refusal, a recipient fired, past the debt age), the
  sending session gets one line in its conversation: `Your message <id> to <to> wasn't delivered: <reason>.` Its next turn
  reads it from history; no turn is started for it. The line is visible to the client and the model
  (`itemVisibility: { client: true, history: true }`). `dl:226-236`. [test `t4:336-352`, `t4:353-366`]
- The sender is told once: `toldAt` is set. `dl:235`, `dl:349-352`.

### 5.5 What a reply carries when the turn gives none

For a message that asked for a reply (`replyRequested` or `wait`), exactly one answer comes: the recipient's own
`sendMessage` with `inReplyTo`, or else the framework's. The framework's answer is sent through the same `sendMessage`, as
the recipient, with `inReplyTo` set to the original id, `exempt` (no budget), id `a:<original id>`, and is never itself
reply-requested. `or:99-128`; `rx:277-340`. When the turn said something, the answer carries that text (cut to 8,000 characters) with no `noAnswer`; `noAnswer: true` is set only when the final text is blank (`or:111-127`). `answeredBy` is written once, by whichever sent first. `sm:523-529`.

| What happened | The answer's text | `noAnswer` | Cite | Pinned |
|---|---|---|---|---|
| The turn ended with no text (blank after trim) | `No answer came back: the turn ended without saying anything.` | `true` | `or:58`; `rx:307-308` | [test `t2:375-388`] |
| The turn threw (the turn still fails; the error goes on) | `No answer came back: the turn failed before it could answer.` | `true` | `or:59`; `rx:329-340` | [test `t2:406-423`] |
| The recipient's `onMessageReceived` has no `turn` and the send could not tell (its mark has no `runsTurn`: built by another installed copy of the package that does not record it) | `No answer came back: this worker doesn't answer messages.` | `true` | `or:60`; `rx:305-310` | [test `t2:519-529`, `t3:366-386`] |
| The server stopped partway through the turn | `No answer came back: the turn stopped before it finished.` | `true` | `or:61`; `or:140-166` | [test `t2:424-466`: answered once, by the recipient session's pass] |

- A turn that ran and gave no text also logs a warning to the console. `rx:286-288`. [read]
- The recipient's final text is cut to 8,000 characters when sent as the answer. `or:122`. [read]
- The `stopped` answer comes from the recipient session's board pass, a few seconds after the turn is found ended, on worker
  flows that carry the session factory's entries (the built-in and coordinator flows do). The pass owes itself a wake due
  `NOTICE_DUE_MS` (2 s) out. `or:70-82`, `or:140-166`; `rx:264`. [test `t2:424-466`] A flow with no pass never sends it. [page: the page says only that the answer arrives a few seconds after the server finds the turn ended; the flow condition is not stated, since the session factory's entries have no public name to point at]
- When the recipient answers with `sendMessage` during its turn, that is the answer, and the final text is not sent too.
  `rx:277-290`; `or:116`. [test `t2:389-405`]
- A reply-requested message that never landed (refused) gets no "no answer": the refusal is the whole answer.
  [test `t4:235-250`]
- Two reply-requested messages to two workers give two answers, each its own message and its own turn in the sender's
  session. [test `t2:351-374`]
- The answer lands in the session that sent the original, wakes a turn there, and spends none of the budget. `sm:337`,
  `sm:476`. [test `t2:272-350`]

### 5.6 Reading the log as an app

- `workerMessagesResource` (browser entry, `br:117`) is the log's definition for `useResource(workerMessagesResource, { all: true })`.
  `ml:45-47`. [read]
- The messages view answers a worker's open messages and each on-screen message's row and its answers. `wv:51-68`. Input:
  `{ worker, ids? }`, at most 50 ids; output: rows oldest first. `wv:37-43`, `wv:35`. Reads use two indexes: `open` (under
  sender and recipient) and `inReplyTo`. `ml:15-20`, `ml:39-42`. [test `worker-messages-view.test.ts`, not run]
- A reply an app wants to show as outstanding is a row that `isOpenMessage` says is open. The Teammates lab marks a line
  pending when `status === "unconfirmed"`, its `to` is the worker, and the received item has not been read. `lab`
  `talk.ts:39-42`. (Lab behaviour; the page does not state it as the framework's.)

## 6. Ask and wait (`replyRequested`, `wait`, `deadline`)

### 6.1 Input [table: ask-and-wait limits; or tool input]

`sendMessage` input, strict (nothing else accepted). `mt:193-230`. [test `t5:412-420`, `t1:1062-1071`, run]

| Field | Type | Rule | Cite |
|---|---|---|---|
| `to` | string, `{ task: string }`, or `{ session: string }` | A worker's id, the session that works a task, or one of the user's conversations. Each non-empty. | `mt:195-204` |
| `text` | string | At most 8,000 characters, at least one non-space character. | `mt:206` |
| `inReplyTo` | string, optional | An earlier message's id. | `mt:207-211` |
| `replyRequested` | boolean, optional | Request a reply and go on. | `mt:212-215` |
| `wait` | boolean, optional | Request a reply and wait for it in the same turn. Needs no `replyRequested`. | `mt:216-222` |
| `deadline` | positive integer, optional | With `wait`: how long to wait, in **milliseconds**. The host's default when left out. | `mt:223-229` |

- `wait: true` implies the reply request: the row has `replyRequested: true` and a `deadlineAt`. `mt:348`;
  `wr:79`; `lr:92-97`. The line an app draws for a waited send carries `wait`, not `replyRequested`. `mt:321`.
- `deadline` without `wait` is refused `deadline_without_wait` (section 4). [run]
- The tool also lists, in its description, who the worker can message: every roster worker the send would take, by id and
  description (description cut to 160 characters), at most 25. The sender and workers that hear only in task sessions are
  not listed. `mt:189-190`, `mt:266-275`; `rcp:159`, `rcp:180-197`. [test `t1:147-177`]
- The tool is present on every turn of a session that runs a worker, as a control tool: a worker's `tools:` line does not
  fence it out. `mt:299-306`, `mt:359-375`. [read]

### 6.2 Results of a waited send [table: ask-and-wait limits]

`wr:17-21`; `mt:233-243`. The tool returns one of (plus the refusal shape of section 4):

| Result | When | Cite | Pinned |
|---|---|---|---|
| `{ "sent": "<msg id>" }` | A plain send, or a `replyRequested` send. On its way, not landed. | `mt:351` | [test] |
| `{ "status": "answered", "sent": "<id of the asking message>", "reply": "<text>" }` | The answer came in time. It comes back as the tool's result and does not land in the sender's conversation as a message; it gets its own log row. | `wr:129-132` | [test `t3:248-282`] |
| `{ ..., "noAnswer": true }` (with `status: "answered"`) | The answer is the framework's "no answer"; `reply` holds the reason (5.5). | `wr:131` | [test `t3:366-386`] |
| `{ "status": "running", "sent": "<id>" }` | The deadline passed first. | `wr:165` | [test `t3:388-475`] |
| `{ "status": "running", "sent": "<id>", "recipient": "waiting_on_person" }` | The deadline passed first and the row has `queuedBehind: "user"` (the user holds the recipient's conversation). | `wr:165`; `mt:241-242` | [test `t3:388-432`] |
| `{ "status": "failed", "sent": "<id>", "error": "<text>" }` | The row was read as `refused` or `undeliverable` (`not_delivered: the message to "<to>" was <status> (<reason>).`), or has no record (`no_such_message: message "<id>" has no record.`). | `wr:147-151`, `wr:161`, `wr:173`, `wr:196` | [read] flag 3 |

- A reply holds at most 8,000 characters; a final text longer than that is cut. `or:122`; `rx:311`. A reply sent by the
  recipient's own `sendMessage` is bounded by the input schema. [read]
- The tool returns as soon as the answer is given, even when the recipient's turn goes on afterwards (for example, it
  answers with `sendMessage` and carries on). `wr:103-126` (`wakeHeldWait` resumes the wait when the answer lands). [test
  `t2:553-577`]
- If the user stops the sender's request while it waits, the wait ends with it; the recipient's turn runs on. [doc `mw:165`;
  the engine path is `wait_ended_the_request` in `wot:161-166`] [read; not tested in the files run]
- At the deadline nothing is stopped. The recipient keeps working, the sender goes on, and the answer arrives later as a
  message that wakes a turn in the sender's session, exactly as a `replyRequested` answer does. Written once: `waitEndedAt`
  is set only while no answer has claimed the row. `wr:158-166`; `sm:523-529`. [test `t3:388-475`: "the answer comes later
  as a message, sent once"]
- A model should not send the question again to get its answer. `mt:258-260` (tool description). [cut: advice, not a fact
  about the API; the page may keep it as one sentence]

### 6.3 Limits

| Limit | Value | Cite |
|---|---|---|
| Default deadline | 5 minutes (300,000 ms) | `wc:67` |
| Shortest and longest deadline | 1 second (1,000 ms) and 24 hours (86,400,000 ms) | `wc:74`, `wc:77` (constants) |
| Waits held in one model step (one round of tool calls) | 1; a second `wait: true`, or `getTask` with `wait`, is `wait_already_pending` | `wot:370-375` |
| Waits nested in one chain (a wait whose recipient waits on another, and so on) | 5; the sixth is `wait_too_deep` | `wg:60`; `wot:385-400` |
| Requests one wait follows to its answer (a taker that died, and the one that took over) | 5 | `wr:31` [cut: mechanism] |
| Text and reply length | 8,000 characters | `lr:24` |

[test `t3:307-335`, `t3:479-512`]

### 6.4 Host override

- A host sets the default and the bounds with `waitDeadlines: { defaultMs?, minMs?, maxMs? }` on `createFlowState` (and in
  the runtime config). `rc:133-139`; `flowstate/types.ts:373-379`; `de:369-379` (example with
  `{ defaultMs: 120_000, minMs: 1_000, maxMs: 3_600_000 }`). A deadline outside the bounds is refused, never clamped.
- The bounds must satisfy `0 < minMs <= defaultMs <= maxMs` and be finite, or the host throws at start:
  `[flow-state] wait deadlines must be finite and satisfy 0 < min <= default <= max; got min <n>, default <n>, max <n>.`
  `wc:87-101`. [read]
- Only takes effect with durable execution and a store that keeps wakes: waits are installed only when the host has a
  wakes store. `wc:109-116`; `de:367`. [read]
- The check for the deadline is in `checkWaitable`: finite, `>= minMs`, `<= maxMs`. `wot:357-365`. [test `t3:324-335`]

### 6.5 Which hosts can hold a wait (`wait_unavailable`) [flag 4]

- A host can hold a wait when it can resume a parked wait, has a sweeper that resumes waits at their deadline, and keeps
  wakes. `wg:239-242`; `wr:40-43`; `wot:353-356`. Durable execution is on by default wherever stores persist (filesystem,
  SQLite, Postgres); a store with no `wakes` table keeps none and offers no wait. `de:11`, `de:367`. The sweeper runs in
  a process that serves the routes. `de:46`.
- Elsewhere: `wait_unavailable`, nothing sent. A `replyRequested` send there is the way, and the answer comes back as a
  message. [test `t3:284-305`: "a send still lands there"]
- A task's wait on the same machinery (`getTask` with `wait`) has the same four refusals. [cut: out of scope]

## 7. Limits on how many messages: the budget

[table: refusals (budget, per_request_limit); option table]

- Each line a user types starts a **budget**: at most `messages.budget` worker messages (default 6) for everything that
  descends from that line, across every worker. Every worker message sent by a worker draws on the same budget, parallel
  branches included (tasks do not; see below). `sm:198-244`; `hop:3-35`. [test `t1:432-506`:
  ring stops at six; a branching fan-out stops at six in all]
- On top of that, one request sends at most `messages.perTurn` messages (default 3). The count is taken before the
  budget and given back if the chain has no place left. `sm:219`, `sm:236-241`. [test `t1:532-554`: three sent, two
  `per_request_limit`; each takes its own place, hops 1, 2, 3]
- A refused send spends nothing: not `perTurn`, not the chain. `sm:236-241`; `sm:29`. [test `t1:1033-1037`]
- A server's own messages (a framework answer to a reply request, a task's midway question to its filer, a service event)
  are `exempt`: they take no place in the chain and are not refused when the budget is spent. `sm:254-258`; `or:124`;
  `midway-question.ts:101-108`. [test `t2` (answers spend none), `midway-question-to-filer.test.ts`, not run here]
- Filing a task spends no budget and takes no place in the chain row. A task carries its filer's hop and chain, so the messages
  its worker sends, and a delegate's ongoing session sends, draw on the filer's budget. Tasks themselves do not. `sm:198-244`;
  `hop:21-37`. [test `t1:592-700`: the hop count carries into a task]
- The woken turn is told what is left. `rx:227-238`; `rx:143`.
- **When a fresh budget starts** (the page's "when a budget resets"):
  - the user's next line in a conversation: `markUserTurn` writes hop 0 in a new chain id. It is skipped for a task's
    session while the task chain is open, and for a conversation's delegate session. `ut:38-54`. [test `t1:432-466`
    ("a user's line lets it go on")]
  - a user's line in a finished task's session, once the task and every follow-up have ended. `ut:30-36`, `ut:46-47`. [test
    `t1:370-430`]
  - a task filed held, when it is released: it starts a fresh chain at 0. `hop:176-196` (`freshHopMark`,
    `heldFromFiling`). A midway hold carries its budget on. [test `t1:828-860`]
  - a request with no chain behind it, such as one your server code starts: its first send starts a chain. `sm:216`,
    `sm:230`. [read]
- The option, `hireWorkforce(installation, { messages: { budget?, perTurn? } })`; also on the workforce kit's
  config as `messages`. `reg:52`, `reg:84`; `lim:119-125`; `packages/workforce/src/kit/workforce-kit.ts:102`. [test
  `t1:508-530`]

| Option | Default | What it limits | Cite |
|---|---|---|---|
| `messages.budget` | `6` | Worker messages descending from one of the user's lines, across every worker. | `lim:114`, `lim:121` |
| `messages.perTurn` | `3` | Messages one request sends. | `lim:117`, `lim:123` |

- Each must be a whole number of at least 1, or `hireWorkforce` throws:
  `hireWorkforce: messages.<key> must be a whole number of at least 1; got <value>.` `lim:134-139`. [test `t1:526`
  (`budget: 0` throws `/messages.budget must be a whole number/`)]
- The defaults are exported: `DEFAULT_MESSAGE_BUDGET`, `DEFAULT_MESSAGES_PER_TURN`, type `MessageLimits`. `lim:114-125`;
  `messages/index.ts:32`.
- A woken turn's `budget` field: `max(0, budget − max(row.hop, chain's count))`, 0 when spent ("No more messages can be sent
  in this exchange."). `rx:237`, `rx:143`.

## 8. Names the page may use (public surface)

From `@flow-state-dev/workforce` (root, `messages/index.ts`): `SEND_MESSAGE_TOOL` (`"sendMessage"`),
`RECEIVED_MESSAGE_DATA_TYPE` (`"workforce:received"`), `messageReceivedEntry`, `messageReceivedSchema`,
`promptedMessageTurn`, `receivedMessagePrompt`, `MAX_MESSAGE_CHARS`, `MESSAGE_STATUSES`, `WORKER_MESSAGES_PATTERN`,
`WORKER_MESSAGES_RESOURCE`, `workerMessageResourceStateSchema`, `workerMessagesCollection`, `workerMessagesResources`,
`DEFAULT_MESSAGE_BUDGET`, `DEFAULT_MESSAGES_PER_TURN`, `sendMessageInputSchema`, `sendMessage`, `SendOutcome`,
`SendMessageInput`. From the browser entry: `RECEIVED_MESSAGE_DATA_TYPE`, `SENT_MESSAGE_DATA_TYPE` (`"workforce:sent"`),
`ReceivedMessageValue`, `SentMessageValue`, `SentMessageWait`, `workerMessagesResource`, `isOpenMessage`,
`workerMessageResourceStateSchema`, `WorkerMessageResourceState`. `br:95-125`.

`MESSAGE_RECEIVED_ENTRY` is **not** exported from `@flow-state-dev/workforce`. [read] `packages/workforce/src/index.ts`
has no line naming it, `messages/index.ts:9` exports only `SEND_MESSAGE_TOOL` and `RECEIVED_MESSAGE_DATA_TYPE` from `keys`,
and the browser entry does not export it. `grep -rn MESSAGE_RECEIVED_ENTRY src` finds it only in the files that define and
read it. `mw:546` and `rd:471`, `rd:560` import it from the package. The page names the entry as the string
`"onMessageReceived"` (`keys:8`) and does not import the constant. Pass 5: confirm against the built `.d.ts`, and tell the
caller, since the existing page and README examples would not compile.

## 9. Left out on purpose

- **Where a message lands** (`mw:65-74`: seven rows by kind of recipient) and **targets** (`{ task }`, `{ session }`)
  belong to the Messaging page (K-08) as a concept; the codes they raise are in section 4. If this reference page should
  carry the landing table, the rows are verified: answer → the sender's session (`sm:337`, [test `t1:331-368`]); `{ task }`
  → the session that works or worked the task, even after the task ended (`mtg:107-139`, [test `t5:91-132`]); `{ session }`
  → that conversation (`t5:296-316`); the worker that filed the sender's current task, or its ongoing delegate session →
  the filing conversation (`sm:177-182`, `sm:340`); project coordinator → the project's conversation (`sm:163`); else the
  recipient's own conversation, opened if absent (`sm:340`, `sm:152-170`; [test `t1:114-145`]).
- **Consult** (`consultSessionHistory`, its options and refusals `self`, `no_conversation`): its own surface, not in the
  R-26 plan's four tables. Source `mw:370-482`; `packages/workforce/src/messages/consult.ts`. Not verified here.
- **Messages from a service** (`subscribe`, screens, `capPerHour`, subscription ends): the workforce README's
  "Subscriptions" section carries it. Not verified here.
- **A task asks a question** (the `q:<task>:<question>` message, its text, when no message is sent): the delegating-work
  and task-board pages. Verified in passing at `midway-question.ts:58-67`, `:94-112`; not on this page.
- **The coding worker answering from its task session** (`harnessTalkTurn`): R-27.
- **Hiring-time refusal** for a worker flow with no `onMessageReceived` or with `sendMessage` and no pass
  (`messageReceivedProblem`, `sendWithoutPassProblem`): R-11 owns the startup refusal. Source `rx:108-120`; `dl:133-139`;
  `reg:117`.
- **History, design rationale and bookkeeping**: the idempotency names (`fsd.call.*`), `WAKE_TRIES`, `MAX_FOLLOWS`,
  the take rule's internals, the request-state keys, tracker ids in header comments. [cut]

## 10. Pass 3 notes: what the draft carries and leaves off

- All nine moved rows are carried. The "reply shows as pending" wording is left off (flag 5: it is the Teammates lab's drawing, not framework behaviour). The page gives the never-interrupts guarantee and the `queuedBehind` mark instead.
- Flag 1, 2 and 3 corrections are on the page as written in sections 0 and 2.
- Flag 4: the page lists hosts as `de:44-46` does and does not name `fsdev run`. Pass 5 should run a `wait: true` send under `fsdev run` before the page says more.
- Left off, by design: the landing table and targets (K-08), consult, service subscriptions, the hiring-time refusals (R-11), `MESSAGE_RECEIVED_ENTRY` (not exported), the four wait refusals shared with `getTask`, the idempotency names and take-rule internals.
- Unchecked and stated: the resend gap rule ("doubles from 2 seconds, up to 5 minutes", section 5.2 [read]) and the `failed` result cases (flag 3).

## 11. Pass 8 round 2 changes

- `empty_message` and `message_too_long` now sit in a Text table (`sm:428-431`); the tool path stays an input error (flag 1).
- The resend table names host conditions: `dispatch-rejected` is a `reject` concurrency policy whose key is held, `no-dispatch-operation` is a host not wired to dispatch, `flow-not-found` is a flow not registered on this host (`dsp:484-516`).
- Budget reset: a delegate session is the session a coordinator opens on a worker for one conversation (`filingSessionId`, `workers/keys.ts:46`); a task chain is open until the task and every follow-up have ended (`ut:30-47`).

## 12. Pass 8 round 3 changes

- `no_reply` is raised only when `runsMessageTurn` is `false` (declared turnless, `sm:344-348`; `rm:58-65`); a flow that says nothing is sent to and answers "no answer" if its landing ran no turn (`rx:305-310`). Both page rows now say so.
- `forward`: `addressed` when the event asks the app's agent, `inferred` when nobody asked, `url` the event's link (`lr:62-68`).
- `budget` formula names `messages.budget`.

## 13. Last revise round

- The declaration is named: `no_reply` is raised for a destination flow whose `onMessageReceived` was built by `messageReceivedEntry` with no `turn` option; the entry's mark sets `runsTurn: options.turn !== undefined` (`packages/workforce/src/messages/message-received-entry.ts:343-346`), and the send refuses when `runsMessageTurn(...) === false` (`send-message.ts:346-347`). A plain send to such a flow is not refused and lands as its two items with nothing run (`message-received-entry.ts:294-313`). [test `t2:506-517`, `t3:344-364`]
- The "doesn't answer messages" answer comes only when the send could not tell: the mark has no `runsTurn` (`received-mark.ts:31-35`, `:58-66`), which the test fixture produces by stripping it, "as an older copy of this package would" (`worker-reply-requested.test.ts:163-169`). The page says "built by another installed copy of `@flow-state-dev/workforce` that does not record it". [test `t2:519-527`, `t3:366-386`] The coordinator's `landsOnly` (inferred forward, `inferredWork: off`, `session-board.ts:344`) also lands turnless, but a service's forward is never reply-requested (`send-message.ts:377-400`), so it owes no answer.
- Three cases kept apart on the page: no `onMessageReceived` at all is the dispatch refusal `no-entry`, final, row `refused`, no "no answer" (`delivery.ts:171-178`; `packages/core/src/types/dispatch.ts:484-486`); an entry with no `turn` is `no_reply` at the send; an entry that cannot say gets the turnless text.
- A turn that throws: the sequencer's rescue sends the owed answer with blank text and reason `failed`, then rethrows (`message-received-entry.ts:326-341`); the answer is `a:<id>`, from the recipient, `noAnswer: true`, text `No answer came back: the turn failed before it could answer.` (`owed-replies.ts:57-62`, `:107-128`). A waiting sender's result copies `noAnswer` from the answer row (`wait-for-reply.ts:131`; `message-tool.ts:137`). The landing request ends `failed`. [test `t2:406-423`; the waited form of the `failed` case is [read], the waited path itself is pinned for the turnless case by `t3:366-386`]
- The first-answer sentence now reads "When the turn ends with text ... Otherwise": a throw has no final text, so the answer is always the failed text unless the recipient already answered with `sendMessage` (`answeredBy` set, `owed-replies.ts:116`).
