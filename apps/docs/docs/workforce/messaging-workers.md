---
title: Messaging other workers
sidebar_position: 3.7
sidebar_label: Messaging workers
description: "A worker can send any other worker on your roster a short message, which wakes the recipient. It can also call: send a message and wait for the reply in the same turn."
---

# Messaging other workers

Sometimes a worker needs to ask a colleague something, or tell it something, without handing it any work. Your researcher wants to know a codename the coordinator was told. The coordinator wants to pass a correction on to the researcher. Workers do this with **messages**.

A message is a line of text from one worker to another on the same user's roster. It wakes the recipient for a turn, and the recipient decides what to do about it. Nothing is filed and no result is owed. Usually the sender doesn't wait either. When it needs the answer before it can go on, it makes the message a [call](#calls) and waits for the reply in the same turn.

## Who can send and receive

Every worker flow on an installation receives messages. On these flows, workers can send them too:

- the [built-in worker](./built-in-worker.md) flow, `agent`;
- the [coordinator](./coordinators.md) flow, whatever the coordinator routes by;
- a [flow of your own](#on-your-own-worker-flow) built with `defineSessionBoard`.

On the built-in and coordinator flows there's nothing to switch on: every worker gets a `sendMessage` tool on every turn. Your own flow needs [one line](#on-your-own-worker-flow).

A worker can message any other worker on its user's roster: your own hires and the standard workers from your files. A worker on another user's roster can't be reached, and the refusal reads the same as for a worker that doesn't exist.

A message to a coordinator wakes the coordinator's own turn, even one that hands your lines straight to its delegates by `round-robin` or `everyone`.

Some workers hear messages only in their tasks' sessions, such as the coding worker in Shift Manager's `devteam` Lab. They have no conversation to answer from, so a message sent to one by name is refused with `task_sessions_only`, and nothing is sent. File it a task instead, or [message one of its finished tasks](#workers-that-hear-only-in-task-sessions).

## Sending a message

The model calls `sendMessage` with the recipient's worker id and the text:

```json
{ "to": "chief-of-staff", "text": "What's the codename for the spring launch?" }
```

The input takes `to`, `text` and, for an answer, `inReplyTo`. A [call](#calls) adds `wait`, `deadline` and `callId`. Nothing else is accepted. `to` is usually a worker id; it can also name [a task or a conversation](#messaging-a-task-or-a-conversation). The tool's description lists the workers the send would take, by id and description, so the model picks from real ids. The sending worker itself, and workers that hear only in task sessions, aren't listed.

Once the message is written to the [log](#showing-messages-in-your-app), the tool answers with its id:

```json
{ "sent": "msg_3f1c0a9e2b7d4c6a8e10" }
```

That answer means the message is on its way, not that it has landed. See [Delivery](#delivery) for what happens next.

`text` holds up to 8,000 characters. A longer one is refused, not cut.

## What the recipient sees

When a message arrives, the session it lands in gets two items:

- a line the recipient's model reads in its history, `From researcher: What's the codename for the spring launch?`, under the sender's name. It is never sent to the client.
- a component item of type `workforce:received` (`RECEIVED_MESSAGE_COMPONENT`), for your app to draw. Its `data` is `{ id, from, text, inReplyTo?, budget, call }`, where `budget` is how many more messages the exchange can send after this one and `call` is `true` when the sender is [waiting for the reply](#calls). See [Showing messages in your app](#showing-messages-in-your-app).

Then the recipient takes a turn on it. That turn is told the message id, who sent it, how to answer, and how many more messages the exchange can send (see [The budget](#the-budget)).

A recipient in the middle of a turn hears the message after that turn ends. If the same message is delivered twice, the recipient wakes once.

A message also waits while the user holds the conversation it's going to: the conversation is stopped for the user's approval or input, or, in a task's session, the task is held on the user's stop or a question. The message lands once nothing holds it. While it waits, its row in the [log](#showing-messages-in-your-app) has `queuedBehind: "user"`.

You see all of it. Both workers' sessions are yours, and the message, the turn it started and any answer are in them like anything else.

### Where a message lands

| The message is | It lands in |
|----------------|-------------|
| An answer (sent with `inReplyTo`) | The session the original message was sent from, even a task's session whose task has finished. The answer wakes a turn there. |
| To `{ task: id }` | The session working that task, or that worked it. |
| To `{ session: id }` | That conversation. |
| To the worker that filed the sender's current task, or the sender's ongoing delegate session | The conversation that filed it. |
| To the [project coordinator](./projects.md#talking-to-a-project), from work in a project | That project's conversation with the coordinator. |
| Anything else | The recipient's own conversation with you, the one [`ensureWorkerSession({ worker })`](./workers-on-disk.md#talking-to-a-worker) returns. If you've never talked to that worker, the conversation is opened. |

## Answering

Nothing is sent back on its own. To answer, the recipient calls `sendMessage` back to the sender, with the id of the message it's answering as `inReplyTo`:

```json
{ "to": "researcher", "text": "It's Bluebird.", "inReplyTo": "msg_3f1c0a9e2b7d4c6a8e10" }
```

`inReplyTo` must name a message the `to` worker sent this worker. Anything else is refused with `no_such_message`.

If the recipient's turn ends in plain text, that text goes to no one. Not answering is a valid answer: an FYI usually needs none.

A plain message doesn't wait for its answer. The sender's turn goes on, and the answer starts a new turn when it comes. When the sender needs the answer before it can go on, it [calls](#calls) instead.

## Calls

A **call** is a message whose sender waits for the reply in the same turn. The model passes `wait: true` with the message:

```json
{ "to": "chief-of-staff", "text": "What's the codename for the spring launch?", "wait": true, "deadline": 60000 }
```

The message is sent and logged like any other, and spends the same [budget](#the-budget). Then the tool waits, until the reply comes or `deadline` (in milliseconds) passes, whichever is first. A call that names no deadline waits for the host's default, five minutes unless the host [sets another](../advanced/durable-execution.md#wakes). A deadline outside the host's bounds, one second to 24 hours by default, is refused with `wait_deadline_out_of_range`. It's never clamped.

### The reply is the result

The recipient doesn't send a message back. It takes a turn on the call, and the final text of that turn is the reply. The reply comes back as the tool's result:

```json
{ "status": "answered", "callId": "msg_3f1c0a9e2b7d4c6a8e10", "reply": "It's Bluebird." }
```

`callId` is the message's id. A reply holds up to 8,000 characters; a longer final text is cut.

The recipient's prompt tells it that the sender is waiting, and to answer in its reply rather than with `sendMessage` (see [the prompt](#on-your-own-worker-flow)). On a flow of your own, the turn's input has `call: true`.

### When the deadline passes first

```json
{ "status": "running", "callId": "msg_3f1c0a9e2b7d4c6a8e10" }
```

Nothing is stopped. The recipient keeps working, and its reply is kept. The sender can go on with its turn, then wait again later for the same reply by passing only the `callId`, with an optional deadline:

```json
{ "callId": "msg_3f1c0a9e2b7d4c6a8e10", "deadline": 120000 }
```

Waiting again sends nothing: no new message, no row in the log, no budget spent. It answers the same way a call does. The model should never send the question again to get its answer.

A call waits behind whatever the recipient is doing. A recipient in the middle of a turn takes the call after that turn ends. A conversation [held by the user](#what-the-recipient-sees) takes it once nothing holds it, and a `running` answer in that case says so:

```json
{ "status": "running", "callId": "msg_3f1c0a9e2b7d4c6a8e10", "recipient": "waiting_on_person" }
```

If the user stops the sender's request while it waits, the call ends with it. The recipient's turn runs on.

### When a call fails

```json
{ "status": "failed", "callId": "msg_3f1c0a9e2b7d4c6a8e10", "error": "not_delivered: the message to \"chief-of-staff\" was refused (…)." }
```

A call answers `failed` when its message was refused or couldn't be delivered (`error` starts `not_delivered:`), or when the recipient's turn failed.

### Where a call can run

A call needs a host that can hold a wait: [durable execution](../advanced/durable-execution.md), a store that keeps [wakes](../advanced/durable-execution.md#wakes), and the [durability sweeper](../advanced/durable-execution.md#retention-and-cleanup) running, which resumes a wait at its deadline. On any other host it's refused with `wait_unavailable`, and nothing is sent. The call is never turned into a plain send. Send without `wait` there, and the answer comes back as a message.

One round of the model's tool calls (a model step) can hold one wait. Calling twice in the same round, or calling alongside `getTask({ id, wait: true })`, is refused with `wait_already_pending`. Calls made one after another in a turn are fine. Waits nest at most five deep: a call whose recipient calls another worker, and so on. The sixth is refused with `wait_too_deep`.

The other refusals a call can meet are in [When a send is refused](#when-a-send-is-refused).

## Messaging a task or a conversation

A worker id reaches a worker wherever the message would [usually land](#where-a-message-lands). To reach one particular session, `to` can name it instead.

To ask about a task, send to the task's id:

```json
{ "to": { "task": "task_7d2e41" }, "text": "Which branch did you push the fix to?" }
```

The message lands in the session that is working the task, or worked it, and wakes the worker there. If the worker is mid-turn there, it hears the message after that turn ends. The message is talk: the task's status, output and attempts stay as they are.

To reach one of the user's own conversations, send to its session id:

```json
{ "to": { "session": "ses_41b9c0" }, "text": "The launch moved to Thursday." }
```

That's how a worker reaches a second conversation the user has with a worker, or a project coordinator's conversation for one project. The tool's description lists workers, not sessions, so a worker uses this when the user gives it a session id.

Either way, the recipient is the worker that runs that session, and it answers the usual way: `sendMessage` back to the sender's worker id, with `inReplyTo`. A send to `{ task }` or `{ session }` can't carry `inReplyTo` itself, and is refused with `no_such_message` if it does.

A refused send leaves no row in the [message log](#showing-messages-in-your-app) and spends none of the [budget](#the-budget). The codes are in [When a send is refused](#when-a-send-is-refused).

A task id only reaches the user's own tasks. An id that names no task, a task that hasn't started yet, and another user's task all answer `no_task_session`, so a refusal tells the sender nothing about anyone else's work. The same goes for `{ session }`: a session that doesn't exist, or belongs to another user, organization or tenant, answers `no_session`.

A session that works a task isn't a conversation. Sent to by `{ session }`, it's refused with `not_a_conversation`, and so is a delegate's session. Message the task with `{ task: id }` instead.

### Workers that hear only in task sessions

A worker whose flow hears messages only in its tasks' sessions, such as the coding worker in Shift Manager's `devteam` Lab, has no conversations. Any `{ session }` that reaches one of its sessions is refused with `not_a_conversation`. Its tasks can be messaged once they're done:

- While the task, or a follow-up running in the same session, is still open, `{ task }` is refused with `task_running`. A message never reaches work in progress. The sender can read the task with `getTask`, or message it once it has ended.
- Once every task in that session has finished, the message wakes the worker there.

That coding worker answers from the coding session the task ran in, by resuming it with the message. It has no `sendMessage`, so its reply stays in the task's session, where you can read it. Nothing goes back to the sender. To build the same on your own coding flow, pass `harnessTalkTurn` as the flow's message turn (see [Answering a worker's message](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/harness-manager/README.md#answering-a-workers-message) in the `@flow-state-dev/harness-manager` README).

## When a task asks a question

A task can stop midway to ask a question and wait for the answer (see [A task held on questions](../orchestration/task-board.md#a-task-held-on-questions)). The question comes from a model's `askQuestion` tool, from code calling `askMidway(ctx, board, [{ prompt }])`, or from a coding run in Shift Manager's `devteam` Lab. Whichever it is, the worker that filed the task gets a message about it.

Each question is one message from the task's worker to the filer. It lands in the conversation that filed the task and wakes the filing worker there, like any other message. The filer's model reads:

```text
From researcher: Your task "Write the adoption script" (task_7d2e41) asks: "Which CSV export should the script read?"
Answer it with updateTask({ id: "task_7d2e41", question: "hold_5a2c", message }), or leave it to the user, who sees it in their Inbox.
```

The task is named by its title, or by its goal when it has no title. A very long question is cut short with an ellipsis so the whole text fits in one message.

The filer can answer from the message alone, with `updateTask({ id, question, message })`. It doesn't need `getTask` first. When the task asks for a yes or a no, the message says to answer with `done: true` or `done: false` as well. The task then goes on, on the same attempt. Or the filer can leave the question to the user. The user's Inbox lists the task once either way, as the place they answer it. The message adds nothing to the Inbox and holds nothing up.

A task filed to a workstream, with `target` or `targetSessionId`, has questions only the user answers. Its message ends `The user answers it from their Inbox; it isn't yours to answer.` instead, and an `updateTask` answer from the filer is refused with `question_is_the_users`.

Each question sends its message once. If the turn that asked is replayed, nothing new is sent. The message's id is `q:<task id>:<question id>`, and it's free: it isn't counted toward the [budget](#the-budget), and a spent budget doesn't stop it.

No message is sent in these cases. The question waits in the Inbox, and `getTask` can read it:

- the task was filed from its own session;
- the task wasn't filed by a worker: your server code filed it;
- the task's worker flow doesn't mount `messageReceivedEntry` (see [Without the session kit](#without-the-session-kit)).

## Delivery

A message is delivered once it lands in the recipient's conversation. The recipient *takes* a message when it starts landing it there. Its row in the [log](#showing-messages-in-your-app) says where it got to, in `status`:

| `status` | What it means |
|----------|---------------|
| `unconfirmed` | On its way: written to the log, and not yet taken by the recipient. |
| `delivered` | It landed in the recipient's conversation. |
| `refused` | It can't be delivered. Final, with the reason in `reason`. |
| `undeliverable` | Nobody had taken it by the host's debt age, [`maxDebtAgeMs`](../configuration/runtime.md), a day by default. Final. |

**It's sent again until it lands.** While a message is `unconfirmed`, the session that sent it sends it again. The first resend comes 2 seconds after the send, then the gap doubles each time, up to 5 minutes. It stops once the message is delivered, refused or past the debt age. The row's `resent` holds how many times it was sent again and when last, and `reason` holds why the last try failed.

Some failures are waited out. The message is sent again when:

- the recipient's host is busy and turns the delivery away for now (`dispatch-rejected`);
- the host has no way to deliver it (`no-dispatch-operation`);
- a flow is missing for a moment (`flow-not-found`);
- the delivery throws.

Others are final, and the message is `refused`: the recipient's flow has no entry for messages, its session is missing or can't be addressed, or creating the session was refused.

Each resend checks the recipient again, the same way the send did. If the recipient is fired after the send, the message is refused with `no_worker` or `worker_unavailable` and never reaches it.

**It's heard once.** However many copies arrive, and however late, the message lands in the recipient's conversation once and wakes one turn. If a delivery stops partway, the next copy finishes it.

**The sender hears when it can't land.** If the recipient's host refuses the first delivery for good, the tool answers [`not_delivered`](#when-a-send-is-refused) with the reason. If a message can't land after the tool has answered `{ sent }`, the sending session gets one line in its conversation:

```text
Your message msg_3f1c0a9e2b7d4c6a8e10 to chief-of-staff wasn't delivered: <reason>.
```

Its next turn reads the line in its history. No turn is started for it.

**Resends need a host that keeps wakes.** The resend runs on the sending session's [wake](../advanced/durable-execution.md#wakes), so it needs a durable host. On a host without wakes, an owed message is sent again only when that session's board runs for something else. A worker flow without the session kit's entries, `board.entries(turn)`, sends a message once and never again.

## The budget

Messages between workers can't run on forever. Each line you type starts a **budget**: at most 6 messages (`hopLimit`) for everything that descends from that line, across every worker. The messages, the turns they wake, the answers those turns send and the tasks filed along the way all draw on the same 6, parallel branches included. On top of that, any one request sends at most 3 (`perTurn`).

The send that would go past the budget is refused with `budget`, and the worker is told to stop passing messages on and say so. Your next line starts a fresh budget.

A fresh budget also starts:

- for a task that was filed held, when it is released;
- for a request with nothing behind it, such as one your server code starts.

A task a woken worker files draws on its filer's budget, and so does a delegate's ongoing session. Filing a task spends nothing. Nor does a refused send, or the message that tells a filer [its task asked a question](#when-a-task-asks-a-question).

A woken turn sees what's left: its input's `budget` field, and the prompt the session kit builds, say how many more messages the exchange can send.

Both limits are set when you register the flows:

```ts
const flows = hireWorkforce(installation, { messages: { hopLimit: 10, perTurn: 5 } });
```

| Option | Default | What it limits |
|--------|---------|----------------|
| `messages.hopLimit` | `6` | Worker messages descending from one of the user's lines, across every worker. |
| `messages.perTurn` | `3` | Messages one request sends. |

Each must be a whole number of at least 1, or `hireWorkforce` throws.

## When a send is refused

A refused send or call answers `{ ok: false, error }`, and nothing is sent. The error starts with a code, then says what happened in words the model can act on:

```json
{ "ok": false, "error": "task_sessions_only: \"eng.coder\" answers only from its tasks' sessions, so it can't be messaged by name. File it a task instead." }
```

| Code | When |
|------|------|
| `not_a_worker` | The sending session runs no worker. |
| `empty_message` | `text` is blank. |
| `message_too_long` | `text` is over 8,000 characters. |
| `not_yourself` | `to` is the sending worker, or the session the message is sent from. An answer from another of the worker's own conversations goes through. |
| `no_worker` | No worker by that id on the user's roster. Another user's worker answers this too. For `{ task }` or `{ session }`, the worker that ran the session has been fired. |
| `worker_unavailable` | The worker is on the roster but can't run, for example because its saved row can't be read, or it has moved to another flow since the session opened. The error says why. |
| `task_sessions_only` | The worker hears messages only in its tasks' sessions. File it a task instead, or message a finished one with `{ task: id }`. |
| `no_task_session` | `{ task }` names no task of the user's that has a session: an unknown id, a task that hasn't started, or another user's task. |
| `no_session` | `{ session }` names no conversation of the user's: it doesn't exist, or belongs to another user, organization or tenant. |
| `not_a_conversation` | `{ session }` names a session working a task, a delegate's session, or a session of a worker that hears only in task sessions. Message the task with `{ task: id }`. |
| `task_running` | `{ task }` names a task of a worker that hears only in task sessions, and the task or a follow-up in its session is still open. |
| `no_such_message` | `inReplyTo` names no message the `to` worker sent this worker, or is passed with `{ task }` or `{ session }`. |
| `budget` | The send would go past `messages.hopLimit` messages since the user's last line. |
| `per_request_limit` | This request already sent `messages.perTurn` messages. |
| `not_delivered` | The recipient's host refused the first delivery for good. The error carries its reason, and the message's row in the log is `refused`. See [Delivery](#delivery). |
| `missing_message` | Neither `to` and `text`, nor a `callId`, was passed. |
| `deadline_without_wait` | `deadline` was passed without `wait: true` or `callId`. |
| `wait_unavailable` | `wait: true` or `callId` on a host that can't hold a wait. Send without `wait` instead. See [Where a call can run](#where-a-call-can-run). |
| `wait_deadline_out_of_range` | `deadline` is outside the host's bounds, one second to 24 hours by default. |
| `wait_already_pending` | This round of tool calls already waits on something: a call, or `getTask` with `wait`. See [Where a call can run](#where-a-call-can-run). |
| `wait_too_deep` | The call would be a sixth wait nested in its chain. |
| `no_such_call` | `callId` names no call sent from this conversation. |
| `wait_again_only` | `callId` was passed with `to`, `text`, `inReplyTo` or `wait`. Pass only `callId` and, if you like, `deadline`. |

## Message or delegate?

Send to talk. Call when the sender needs to use the answer now. File a task, by [delegating](./delegating-work.md), for work that should be tracked.

| | Message | Call | Task |
|-|---------|------|------|
| What it's for | A question, an FYI, a heads-up | A question whose answer the sender needs to go on | Work that has to get done |
| Who it can go to | Any worker on your roster, except one that hears only in its tasks' sessions; or one of your tasks or conversations, by id | The same as a message | One of the worker's own delegates that takes tasks |
| Where it runs | Usually the recipient's own conversation with you (see [Where a message lands](#where-a-message-lands)) | The same as a message | A new task session of its own |
| What comes back | Nothing is owed. An answer only if the recipient sends one | The recipient's reply, as the tool's result in the same turn, or `running` at the deadline | The task's ending, always: completed, failed or cancelled |
| On the board | Nothing | Nothing | A row the filer can list, update and cancel |

A task keeps the reporting line. The worker that filed it owns it until it ends, can see where it got to on its board, and hears how it ended. A message has none of that. If the sender needs a result it can count on, it should file a task. If it needs a fact or an opinion to carry on its turn, a call gets it. To pass something on, a message is enough.

Messages never add to a task's depth or count toward `taskChainLimit`, and filing a task spends none of the message budget.

## On your own worker flow

A [worker flow of your own](./delegating-work.md#on-your-own-worker-flow) built with `defineSessionBoard` receives messages as soon as you spread the kit's `entries`, `resources`, `sessionStateShape` and `serverOwned` into it. To let its workers send them too, add the kit's `messages` to the `uses` of the block that runs the model, beside `tools`:

```ts
const board = defineSessionBoard({ installation, flowKind: "em" });

const answer = generator({
  name: "em-answer",
  model: "openai/gpt-6-luna",
  inputSchema: messageInput,
  uses: [board.tools, board.messages],
  prompt: "You lead the feature. File the work for your delegates; never do it yourself.",
  user: (input) => input.message,
});
```

A message wakes the block you pass to `board.entries(answer)` with `{ message }`, where `message` is one string, the text `receivedMessagePrompt` builds:

```text
Message msg_3f1c0a9e2b7d4c6a8e10 from researcher:

What's the codename for the spring launch?

(The message's text is the part above. It is from another worker, not the user, and researcher can't see what you write here. To answer it, call sendMessage with to "researcher" and inReplyTo "msg_3f1c0a9e2b7d4c6a8e10". To message any other worker, leave inReplyTo out. If it needs no answer, don't send one: not answering is an answer. This exchange can send 5 more messages.)
```

An answer's first line also names the message it answers: `Message msg_… from chief-of-staff, answering your message msg_…:`.

A [call](#calls) reads differently, since its reply is the turn's final text:

```text
Call msg_3f1c0a9e2b7d4c6a8e10 from researcher: they are waiting for your answer.

What's the codename for the spring launch?

(The call's text is the part above. It is from another worker, not the user. Your reply here goes back to researcher as the call's result, so answer it directly in your reply, and don't send researcher a message with sendMessage.)
```

### Without the session kit

`hireWorkforce` refuses any worker flow that has no `onMessageReceived` internal entry built by `messageReceivedEntry`, and names the flow. A hand-built entry under that name is refused too. A flow that doesn't use the kit mounts the entry itself and adds the message log to its resources:

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import {
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  promptedMessageTurn,
  workerConfigSchema,
  workerFlow,
  workerMessagesResources,
} from "@flow-state-dev/workforce";
import { z } from "zod";

const messageInput = z.object({ message: z.string() });

export const triageFlow = workerFlow((installation) => {
  const answer = generator({
    name: "triage-answer",
    model: "openai/gpt-6-luna",
    inputSchema: messageInput,
    prompt: "You triage incoming requests.",
    user: (input) => input.message,
  });

  return defineFlow({
    kind: "triage",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: {
      respond: { inputSchema: messageInput, block: answer, userMessage: (input) => input.message },
    },
    internal: {
      actions: {
        [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({
          installation,
          flowKind: "triage",
          turn: promptedMessageTurn(answer),
        }),
      },
    },
  });
});
```

`messageReceivedEntry` takes:

| Option | What it is |
|--------|------------|
| `installation` | Your worker installation. |
| `flowKind` | The flow's kind. |
| `turn` | Optional. The block a message wakes, with a `MessageReceived` as its input. Leave it out and the message lands as its two items and nothing runs. |
| `hears` | Optional. `"task-sessions"` makes the flow's workers hear messages only in their tasks' sessions; a message to one by name is refused with `task_sessions_only`. |

`turn` takes a `MessageReceived`:

| Field | What it holds |
|-------|---------------|
| `id` | The message id, what an answer passes as `inReplyTo`. |
| `from` | The sending worker's id. |
| `text` | What was said. |
| `inReplyTo` | The message this one answers, when it answers one. |
| `budget` | How many more messages the exchange can send. |
| `call` | `true` when the sender is waiting for the reply. The turn's final text is the reply. |

`promptedMessageTurn(answer)` wraps a block that takes `{ message }` so it can serve as `turn`, handing it the text `receivedMessagePrompt(received)` returns, shown above. A flow built this way receives messages. Its workers can't send them unless the block that runs the model carries the session kit's `messages`.

## Showing messages in your app

Every message is kept in a log in the user's own scope, one row per message, readable from the browser. Read it through any of the user's sessions on a flow that declares it: the roster flow, the built-in worker flow, the coordinator flow, or a worker flow that spreads `workerMessagesResources` (the session kit's `resources` include it).

```ts
import { createClient, readEveryCollectionPage } from "@flow-state-dev/client";
import {
  WORKER_MESSAGES_RESOURCE,
  createWorkforceClient,
  workerMessageRowSchema,
} from "@flow-state-dev/workforce/browser";

const fsd = createClient({ userId, baseUrl });
const workforce = createWorkforceClient(fsd);

const session = await workforce.ensureWorkerSession({ worker: "researcher" });
const items = await readEveryCollectionPage(fsd.resources, session.id, WORKER_MESSAGES_RESOURCE);
const messages = items.flatMap((item) => {
  const row = workerMessageRowSchema.safeParse(item.clientData);
  return row.success ? [row.data] : [];
});
```

Each row has:

| Field | What it holds |
|-------|---------------|
| `id` | The message id, `msg_…`, or `q:<task id>:<question id>` for [a task's question](#when-a-task-asks-a-question). |
| `from`, `to` | The sending and receiving worker ids. |
| `addressedBy` | `task` or `session` when the message was sent to `{ task }` or `{ session }`. Absent when it was sent to a worker id. |
| `toTask` | The task it was sent to, when `addressedBy` is `task`. |
| `text` | What was said. |
| `exchange` | The id of the first message in the exchange. A message and its answers share one. |
| `inReplyTo` | The message this one answers, when it answers one. |
| `fromSession`, `fromFlow` | The session it was sent from, and that session's flow. |
| `toSession`, `toFlow` | The session it landed in, and that session's flow. |
| `chain` | The id of the budget the message drew on: everything descending from one user's line. Optional. |
| `hop` | Its place in that budget, from 1. |
| `status` | `unconfirmed`, `delivered`, `refused` or `undeliverable`. See [Delivery](#delivery). The package root exports the list as `MESSAGE_STATUSES`. |
| `reason` | Why it was refused or couldn't be delivered. While it's `unconfirmed`, why the last try failed. |
| `toState` | The state the recipient's conversation starts with. Optional. |
| `takenBy` | The recipient's request that took it. Optional. |
| `deliveredAs`, `deliveredAt` | The request it landed in, and when. Set once, on delivery. |
| `resent` | `{ n, at }`: how many times it was sent again, and when last. Optional. |
| `toldAt` | When the sending session was told it was refused or couldn't be delivered. Optional. |
| `call` | `true` for a [call](#calls). Absent on a plain message. |
| `deadlineAt` | When a call's sender stops waiting, in ms. A `repliedAt` later than this means the reply came after the call answered `running`. |
| `repliedAt` | When the recipient's turn gave a call's reply, in ms. |
| `queuedBehind` | `"user"` while the message waits for the user to answer in the recipient's conversation. Cleared when it lands. |
| `at` | When it was sent, in ms. |

The read never returns another user's messages.

In a conversation, each side of a message is an item you can match on. Both names come from `@flow-state-dev/workforce/browser`:

- A sent message is a `tool_output` item for the tool named `SEND_MESSAGE_TOOL` (`"sendMessage"`). Match on it to draw the message as a line of its own rather than a tool call.
- A received message is a `component` item whose component is `RECEIVED_MESSAGE_COMPONENT` (`"workforce:received"`), with `data` of `{ id, from, text, inReplyTo?, budget, call }`.

[Shift Manager](../shift-manager/overview.md) does all of this: its Messages screen lists the log, a conversation shows each sent message as *To &lt;worker&gt;: &lt;text&gt;* (or *To task &lt;id&gt;* and *To conversation &lt;id&gt;* for one sent to a task or a session), and each received message as its own item under the sender's name. A call shows as *Asking &lt;worker&gt;…* while it waits and *Asked &lt;worker&gt;* once it's done, with the reply under it.

## Related pages

- [Delegating work](./delegating-work.md): filing tasks for a worker's delegates.
- [Coordinators](./coordinators.md): a worker that hands each message to its delegates.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, worker flows and `hireWorkforce`.
