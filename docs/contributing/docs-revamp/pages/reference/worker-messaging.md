---
title: Worker messaging
type: reference
description: "The fields of a message's log row, its four delivery states, every refusal, and the limits on asking for a reply, waiting, and how many messages one user line can start."
---

import Figure from "@site/src/components/Figure";
import States from "./figures/worker-messaging-states.svg";

# Worker messaging

A message is a line of text one worker sends another worker on the same user's roster, the workers that user has. It wakes the recipient for a turn and files no task, so the sender is owed nothing and the recipient decides what to do with it. A sender that wants an answer can ask for one and carry on, or ask and wait for it in the same turn.

Every message is written to a log before anyone hears it. A sender can see whether a message landed or was given up on, and an app can draw an exchange from the log alone. This page is the lookup for the log and for the limits around it. [Messaging between workers](../catalog/workforce/messaging.md) shows how to use it.

## Sending a message

A worker sends with the `sendMessage` tool. Here `researcher` asks `shift-coordinator` a question:

```json
{ "to": "shift-coordinator", "text": "What's the codename for the spring launch?" }
```

The tool answers with the message's id once it is written to the log.

```json
{ "sent": "msg_3f1c0a9e2b7d4c6a8e10" }
```

That means the message is on its way, not that it has landed. A refused send answers `{ ok: false, error }`, where `error` starts with a code from [When a message is refused](#when-a-message-is-refused), then text written for the model:

```json
{ "ok": false, "error": "no_worker: no worker \"writer\" on your roster." }
```

| Input | Type | Rule |
|---|---|---|
| `to` | string, `{ task: string }` or `{ session: string }` | A worker's id, the session that works a task, or one of the user's conversations. Each must be non-empty. |
| `text` | string | At most 8,000 characters, with at least one that is not a space. |
| `inReplyTo` | string, optional | The id of an earlier message this one answers. |
| `replyRequested` | boolean, optional | Ask for a reply and carry on. |
| `wait` | boolean, optional | Request a reply and wait for it in the same turn. Pass `wait` alone: it also requests the reply. |
| `deadline` | positive integer, optional | With `wait`: how long to wait, in milliseconds. Defaults to the host's default. |

- Nothing else is accepted. The sender, the hop and the sessions are never input: the server writes them from the sending turn.
- Text over 8,000 characters, or blank text, fails input validation before any send, so the model sees an input error and no refusal code. `empty_message` and `message_too_long` are answered only when server code calls the exported `sendMessage(ctx, installation, flowKind, input, from)` directly; both are listed under [Text](#text).
- The tool is present on every turn of a session that runs a worker, whatever the worker's `tools:` line says. The tool's description lists up to 25 workers it can send to, each by id with its description cut to 160 characters. The sender, and workers that hear messages only in their tasks' sessions, are not listed.

## Message fields

Each message is one row in a log. The row's shape is exported as `workerMessageResourceStateSchema` and the type `WorkerMessageResourceState`, from `@flow-state-dev/workforce` and from `@flow-state-dev/workforce/browser`.

### Who and what

| Field | Type | Holds |
|---|---|---|
| `id` | string | `msg_` and 20 hex characters. A framework answer is `a:<id of the message it answers>`. A task's midway question is `q:<task id>:<question id>`. |
| `from` | string | The sending worker's id, or `service:<provider>` for a service's event. |
| `to` | string | The recipient worker's id. |
| `addressedBy` | `"task"` or `"session"`, optional | How the sender addressed it. Absent when addressed by worker id. |
| `toTask` | string, optional | The task, when `addressedBy` is `"task"`. |
| `forward` | `{ as: "addressed" or "inferred", url }`, optional | A service event that no other subscription matched, forwarded to a coordinator's catch-all subscription for unmatched events. `as` is `addressed` when the event asks the app's agent and `inferred` when nobody asked; `url` is the event's link. Set by the server only. |

### The exchange

| Field | Type | Holds |
|---|---|---|
| `text` | string | The message, up to 8,000 characters. |
| `exchange` | string | The id of the first message of this exchange: its own id, or the exchange of the message it answers. |
| `inReplyTo` | string, optional | The message this one answers. |
| `hop` | integer, at least 1 | Its place among the worker messages since the user's last line, across the whole exchange. |
| `chain` | string, optional | The id of the user's turn the exchange descends from. |

### Sessions and times

| Field | Type | Holds |
|---|---|---|
| `fromSession`, `fromFlow` | string | The session and flow the sending turn ran in. An answer lands there. |
| `toSession`, `toFlow` | string | Where the message is delivered. |
| `toState` | `Record<string, string>`, optional | The state a worker's derived conversation is opened with. |
| `at` | epoch ms | When it was sent. |
| `toldAt` | epoch ms, optional | When the sending session was told the message was refused or could not be delivered. |

### Delivery

| Field | Type | Holds |
|---|---|---|
| `status` | `unconfirmed`, `delivered`, `refused`, `undeliverable` | See [Delivery states](#delivery-states). |
| `reason` | string, optional | Why it was refused or undeliverable, or why the last send failed. |
| `takenBy` | string, optional | The id of the recipient's request that has picked the message up to deliver it. A message with `takenBy` set is taken. |
| `queuedBehind` | `"user"`, optional | The message is taken but waits because the user holds the recipient's conversation. Cleared when it lands. |
| `deliveredAs`, `deliveredAt` | string, epoch ms | The request it landed in, and when. |
| `resent` | `{ n, at }`, optional | How often the sending session sent it again, and when last. |

### Reply and wait

| Field | Type | Holds |
|---|---|---|
| `replyRequested` | `true`, optional | Set when the sender passed `replyRequested` or `wait`. |
| `deadlineAt` | epoch ms, optional | When a waiting sender stops waiting. Set only for `wait: true`. |
| `waitEndedAt` | epoch ms, optional | When the waiting sender stopped waiting with no answer yet. |
| `waitGate` | `{ gateId, requestId }`, optional | Set while the sender waits. Not for app use. |
| `answeredBy` | string, optional | The id of the message that answered this one. Set once. |
| `noAnswer` | `true`, optional | This message is the framework's "no answer" to the one it answers. |

### Who owns and sees what is stored

| Stored part | Owner | Who can see it | Where | How many |
|---|---|---|---|---|
| Message row | The server, written from the sending turn | The user the sender acts for, through a client read of their own rows. Another user's rows are not visible. | User scope, shared across flows, at `workforce/messages/*`, accessor `workforceMessages` | One per message, framework answers, midway questions and service events included. A row stays after it is `delivered`. |
| Chain row | The server | Not readable by a client | User scope, at `workforce/message-chains/*`, accessor `workforceMessageChains` | One per user turn whose exchange sent a message. It lists the ids of the messages sent, in order. |
| The two items a landed message adds | The server, in the recipient's session | The `From <worker>: <text>` line is read by the recipient's model and never sent to the client. The `workforce:received` item is drawn by the client and never read by the model. | The recipient's session | Two per landed message |
| The send's own line, `workforce:sent` | The server, in the sender's turn | The client only | The sender's session | One per `sendMessage` call, refused calls included |

`isOpenMessage(row)` is true while `status` is `unconfirmed`, and while a row asked for a reply that has not come (`replyRequested` and no `answeredBy`) and is neither refused nor undeliverable.

## Delivery states

`status` has four values. A send writes the row `unconfirmed`, and the row stays there until the recipient lands it or the message is given up on.

| `status` | Meaning | Final |
|---|---|---|
| `unconfirmed` | Written to the log, not yet landed. A message that is taken but not yet delivered stays `unconfirmed`. | No |
| `delivered` | It landed in the recipient's conversation. | Yes |
| `refused` | It cannot be delivered. `reason` says why. | Yes |
| `undeliverable` | Nobody had taken it by the host's age limit, `maxDebtAgeMs`, 24 hours by default. | Yes |

<Figure svg={States} caption="A message's states" description={"On the left, one tall box for unconfirmed, highlighted: a message that has been sent and has not yet landed, resent until it lands. Three arrows run right to three boxes. The arrow labelled lands goes to delivered, the one labelled refused goes to refused, and the one labelled too old goes to undeliverable. Notes say that the recipient's turn takes the message, stores both items, then marks it delivered; that a busy host is waited out and the send made again while any other refusal is final; that a message nobody has taken by the host's age limit is undeliverable; and that the three right-hand states are final, while queuedBehind and resent are marks on the row and not states."} />

`status` does not change again once it is `delivered`, `refused` or `undeliverable`. Other fields can be written after that: `toldAt` when the sender is told, `answeredBy` when an answer is claimed, and `waitEndedAt` when a wait ends.

### Sending again until it lands

While a row is `unconfirmed`, the sending session sends it again. The first resend is due 2 seconds after the send, and the gaps after that double, up to 5 minutes. Resends stop when the message is `delivered`, `refused` or past the age limit. A message that has been taken never becomes `undeliverable` for its age. If it is past the age and its recipient is gone, a recheck or a final refusal on a resend ends it `refused`.

| The recipient's host answers | Result |
|---|---|
| The flow is busy under a `reject` [concurrency policy](./concurrency.md), the host is not set up to start a flow from a message, the flow is not registered on this host, or starting it throws | Waited out. The message is sent again, and `reason` records why. |
| The flow has no `onMessageReceived` action at all, the session is missing or cannot be addressed, creating the session was refused, or any other refusal | Final. The row is `refused` with `reason` `<refusal>: <detail>`. |

- Each resend checks the recipient again, without spending budget. A worker fired after the send ends the row `refused` with `no_worker` or `worker_unavailable`. A task worked in another session by then ends it with `task_moved`.
- A message is heard once, however many times it is sent again.
- A message that cannot land after the tool answered `{ sent }` gives the sending session one line, `Your message <id> to <to> wasn't delivered: <reason>.` Its next turn reads the line from history and no turn starts for it. The line is shown to the client and the model, and it is written once.

### When a message is heard

A message never interrupts a turn in progress, and none is dropped.

- A recipient in the middle of a turn hears the message after that turn ends.
- While the user holds the recipient's conversation, the message waits with `queuedBehind: "user"` and lands when nothing holds it. A conversation is held while one of its requests waits on the user's approval or answer, until that request ends. In a task's session it is held while the task has an open [hold](./task-collections.md#holds): a question or approval waiting on the user.
- A task waiting on something outside the board, such as a coding task waiting on its pull request, is not held for the message. The message lands at once and its text is taken as the outcome of that wait. The task's worker reads it when the task next runs, and the message starts no turn of its own.
- On a host that cannot hold a wait, a message is not queued. It lands as soon as it is taken.

### What the recipient gets

A landed message adds two items to the recipient's session.

| Item | Visible to | Content |
|---|---|---|
| A message item, role `user`, `agentName` the sender | The model | `From <sender>: <text>`. |
| A `data` item with `dataType` `"workforce:received"`, `agentName` the sender | The client | A `ReceivedMessageValue`, below. |

| `ReceivedMessageValue` field | Holds |
|---|---|
| `id`, `from`, `text` | The message's id, sender and text. |
| `budget` | How many more messages the exchange can send after this one: `max(0, messages.budget - max(hop, messages in the chain so far))`. It is read when the message is heard, so a message that waited shows what is left then. |
| `inReplyTo` | The message this one answers. Present only for an answer. |
| `replyRequested` | `true` when the sender asked for a reply or waited. |
| `noAnswer` | `true` when the message is the framework's "no answer". |

`RECEIVED_MESSAGE_DATA_TYPE` is `"workforce:received"`. The turn's input is `MessageReceived`, exported from `@flow-state-dev/workforce`. It carries `id`, `from`, `text`, `budget`, `inReplyTo` and `replyRequested`, and has no `noAnswer`.

## When a message is refused

A refused send answers `{ ok: false, error }`, where `error` is `<code>: <text for the model>`. It spends no budget. It writes no row, except `not_delivered`, which records a `refused` row. Input that fails the tool's schema is answered first, as an input error with no code. After that the first check that fails answers, starting with the flow's own `refuses` hook. With `wait: true`, the wait checks come next: the host can hold a wait (`wait_unavailable`), the deadline is in bounds (`wait_deadline_out_of_range`), the chain is not too deep (`wait_too_deep`), and the model step holds no other wait (`wait_already_pending`). Without `wait`, `deadline_without_wait` comes next instead. Then, on both paths: the session runs a worker, the text ([Text](#text)), the target, the recipient, `inReplyTo`, whether a reply can be requested, then the budget.

### Text

| Code | Raised when |
|---|---|
| `empty_message` | `text` has no character other than spaces. |
| `message_too_long` | `text` is over 8,000 characters. |

Only server code that calls the exported function sees these codes; see [Sending a message](#sending-a-message).

### The sender and the recipient worker

| Code | Raised when |
|---|---|
| `not_a_worker` | The sending session runs no worker. |
| `not_yourself` | `to` is the sending worker, or the target session is the one the message is sent from. An answer sent from another of the worker's own conversations is allowed. |
| `no_worker` | No worker with that id is on the sender's user's roster. An unknown id and another user's worker answer with the same text: `no worker "<to>" on your roster.` For `{ task }` or `{ session }`, the worker that runs the session has been fired. |
| `worker_unavailable` | The worker is on the roster but cannot run: its saved row cannot be read, or it moved to another flow since the session opened. The error says why. |
| `task_sessions_only` | The recipient's flow hears messages only in its tasks' sessions, and the send is by worker id. Does not apply to an answer. File the worker a task instead. |

### A task or a conversation

| Code | Raised when |
|---|---|
| `no_task_session` | `{ task }` names no task of the user's that has a session: an unknown id, a task that has not started, a plan step, an id held in more than one conversation, or another user's task. One text covers all. |
| `no_session` | `{ session }` names no conversation of the user's: it does not exist, or belongs to another user, organization or tenant. Also answered when the host cannot read sessions. |
| `not_a_conversation` | `{ session }` names a session that works a task, a delegate's session, or a session of a worker that hears only in task sessions. |
| `task_running` | `{ task }` names a task of a worker that hears only in task sessions, and the task or one of its follow-ups is not yet in a terminal status. Once all have ended, sending the same message again succeeds. |

### Answers and delivery

| Code | Raised when |
|---|---|
| `no_such_message` | `inReplyTo` names no message the `to` worker sent this worker, or `inReplyTo` is given with `{ task }` or `{ session }`. |
| `reply_to_waiting` | An answer passes `replyRequested` or `wait`, but the message it answers is one whose sender is waiting for it. Answer without them. |
| `no_reply` | `wait` or `replyRequested` to a flow whose `onMessageReceived` was built by `messageReceivedEntry` with no `turn` option, so nothing runs when a message lands. Nothing was sent. A plain send to such a flow is not refused. |
| `not_delivered` | The recipient's host refused the first delivery for good. Text: `the message to "<to>" was refused (<refusal>: <detail>).` Also the answer to a repeat of a send whose row ended `refused` or `undeliverable`. |

### Limits

| Code | Raised when |
|---|---|
| `budget` | The send would be the next worker message after the budget is spent. The text tells the worker to stop passing messages on and say so. |
| `per_request_limit` | The request has already sent `perTurn` messages. |

### Ask and wait

| Code | Raised when |
|---|---|
| `deadline_without_wait` | `deadline` was passed without `wait: true`. |
| `wait_unavailable` | `wait: true` on a host that cannot hold a wait. Nothing was sent, and the send is not turned into a plain one. Send with `replyRequested` instead. |
| `wait_deadline_out_of_range` | `deadline` is not finite, or is outside the host's bounds. It is never clamped. |
| `wait_too_deep` | The wait would be the sixth in its chain. |
| `wait_already_pending` | This model step already waits on something. Wait again on a later step. |

## Ask and wait

`replyRequested: true` asks for a reply and lets the sender carry on. `wait: true` asks and holds the sender's turn at the tool call until the answer arrives. Either way exactly one answer comes: the recipient's own `sendMessage` with `inReplyTo`, or the framework's.

A send returns one of these, besides a refusal. Only a send with `wait: true` returns a `status`.

| Result | When |
|---|---|
| `{ "sent": "<id>" }` | A plain send, or one with `replyRequested`. On its way, not landed. |
| `{ "status": "answered", "sent": "<id>", "reply": "<text>" }` | The answer came in time. It comes back as the tool's result and does not land in the sender's conversation as a message. |
| `{ "status": "answered", ..., "noAnswer": true }` | The answer is the framework's "no answer", and `reply` holds the reason. |
| `{ "status": "running", "sent": "<id>" }` | The deadline passed first. |
| `{ "status": "running", "sent": "<id>", "recipient": "waiting_on_person" }` | The deadline passed first, and the user holds the recipient's conversation. |
| `{ "status": "failed", "sent": "<id>", "error": "<text>" }` | The row was read as `refused` or `undeliverable` (`not_delivered: ...`), or has no record (`no_such_message: ...`). |

A refusal of the first delivery of a waited send is the `not_delivered` refusal above, not `failed`.

### What ends a wait

- **The answer arrives.** The tool returns at once, even if the recipient's turn goes on, for example after answering with `sendMessage` and carrying on.
- **The deadline passes.** The tool returns `running`. Nothing is stopped: the recipient keeps working and the sender goes on. The answer arrives later as a message that wakes a turn in the sender's session, sent once. The model should not send the question again to get it.
- **The message cannot land.** The tool returns `failed` once the row is read as `refused` or `undeliverable`. No answer comes.
- **The user stops the sender's request.** The wait ends with it. The recipient's turn runs on.

### Limits on waiting

| Limit | Value |
|---|---|
| Default deadline | 5 minutes (300,000 ms) |
| Shortest and longest deadline | 1 second (1,000 ms) and 24 hours (86,400,000 ms) |
| Waits held in one model step | 1. A second `wait: true`, or `getTask` with `wait`, in the same step is refused. Waits on later steps are fine. |
| Waits nested in one chain | 5. A wait whose recipient waits on another worker counts as one deeper. |
| Text and reply length | 8,000 characters. A final text longer than that is cut when sent as the answer. |

A host sets the default and the bounds with `waitDeadlines: { defaultMs?, minMs?, maxMs? }` on `createFlowState`. They must be finite and satisfy `0 < minMs <= defaultMs <= maxMs`, or the host throws at start. A deadline outside the bounds is refused. They take effect only on a host that can hold a wait.

A host can hold a wait when it is a process that serves the routes, such as `fsdev dev`, `fsdev serve` or a self-hosted server, on a store that persists. Elsewhere `wait` is refused with `wait_unavailable`. See [Pause, resume and replay](./durable-execution.md).

### When the turn gives no reply

For a message that asked for a reply, the framework sends the answer when the recipient does not. It is an ordinary answer from the recipient, with `inReplyTo` set and the id `a:<original id>`. When the turn ends with text, the answer is that text, cut to 8,000 characters. Otherwise the answer is one of the "no answer" texts below and carries `noAnswer: true`. It spends no budget and is never itself reply-requested. `answeredBy` is written once, by whichever answer is sent first. If the recipient answers with `sendMessage` during its turn, that is the answer and the final text is not sent too.

| What happened | The answer's text |
|---|---|
| The turn ended with no text | `No answer came back: the turn ended without saying anything.` |
| The turn threw | `No answer came back: the turn failed before it could answer.` |
| The recipient's `onMessageReceived` has no `turn`, and the send could not tell | `No answer came back: this worker doesn't answer messages.` |
| The server stopped partway through the turn | `No answer came back: the turn stopped before it finished.` |

When a turn throws before it answers, the framework sends the one answer as the recipient, with `noAnswer: true` and the "turn failed" text. A waiting sender's tool returns:

```json
{ "status": "answered", "sent": "msg_3f1c0a9e2b7d4c6a8e10", "reply": "No answer came back: the turn failed before it could answer.", "noAnswer": true }
```

The recipient's turn fails all the same, and its error goes on as it would have. The "server stopped" answer arrives a few seconds after the server finds the turn ended.

A send can tell that a flow's `onMessageReceived` has no `turn`, and refuses a reply request to it with `no_reply`. It cannot tell when that `onMessageReceived` was built by another installed copy of `@flow-state-dev/workforce` that does not record it. Then the message is sent, lands, and gets the "doesn't answer messages" text. A flow with no `onMessageReceived` action at all is different again: its delivery is refused for good, as under [Sending again until it lands](#sending-again-until-it-lands). A message that was refused gets no "no answer": the refusal is the whole answer.

## How many messages

Each line a user types starts a budget: at most `messages.budget` worker messages for everything that descends from it, across every worker. Every worker message counts, whichever worker sends it, parallel branches included. On top of that, one request sends at most `messages.perTurn`. The woken turn is told how many are left.

| Option | Default | Limits |
|---|---|---|
| `messages.budget` | 6 | Worker messages descending from one user line, across every worker. |
| `messages.perTurn` | 3 | Messages one request sends. |

Set them on `hireWorkforce(installation, { messages: { budget, perTurn } })`, or as `messages` on the workforce kit's config. Each must be a whole number of at least 1, or `hireWorkforce` throws. The defaults are exported as `DEFAULT_MESSAGE_BUDGET` and `DEFAULT_MESSAGES_PER_TURN`.

- A refused send spends nothing, from `perTurn` or from the budget.
- A server's own messages are exempt: a framework answer to a reply request, a task's midway question to its filer, and a service event. They take no place in the budget and are not refused when it is spent.
- Filing a task spends no budget. A task carries its filer's budget, so the messages its worker sends, or a delegate's ongoing session sends, draw on it.

A fresh budget starts at:

- the user's next line in a conversation. Two sessions are the exception: a task's session while the task or any of its follow-ups is open, and a delegate session, the session a coordinator opens on a worker for one conversation (see [Coordinators](../catalog/workforce/coordinators.md)). A line there is input to the task or delegate and starts no budget;
- a user's line in a finished task's session, once the task and every follow-up have ended;
- the release of a task that was filed held. A hold the task asks for midway, such as a question for the user, carries its budget on;
- the first send of a request with no chain behind it, such as one your server code starts.

## Reading messages in an app

These come from `@flow-state-dev/workforce/browser`.

| Name | What it is |
|---|---|
| `workerMessagesResource` | The log's definition, for `useResource(workerMessagesResource, { all: true })`. |
| `workerMessageResourceStateSchema`, `WorkerMessageResourceState` | The row's schema and type. |
| `isOpenMessage(row)` | Whether a row is open, as defined under [Message fields](#message-fields). |
| `RECEIVED_MESSAGE_DATA_TYPE`, `ReceivedMessageValue` | The `workforce:received` item's type string and its data. |
| `SENT_MESSAGE_DATA_TYPE`, `SentMessageValue` | The `workforce:sent` line's type string and its data. |

## Related

| Page | What is there |
|---|---|
| [Messaging between workers](../catalog/workforce/messaging.md) | Sending, asking for a reply and waiting, with examples. |
| [Workforce](./workforce.md) | The roster and the kit options the messaging options sit in. |
| [Pause, resume and replay](./durable-execution.md) | Durable execution and wakes, which a wait needs. |
