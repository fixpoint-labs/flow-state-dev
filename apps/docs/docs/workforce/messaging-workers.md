---
title: Messaging other workers
sidebar_position: 3.7
sidebar_label: Messaging workers
description: "A worker can send any other worker on your roster a short message. The message wakes the recipient, and the recipient answers, if it wants to, by sending a message back."
---

# Messaging other workers

Sometimes a worker needs to ask a colleague something, or tell it something, without handing it any work. Your researcher wants to know a codename the coordinator was told. The coordinator wants to pass a correction on to the researcher. Workers do this with **messages**.

A message is a line of text from one worker to another on the same user's roster. It wakes the recipient for a turn, and the recipient decides what to do about it. Nothing is filed, no result is owed, and the sender doesn't wait.

## Who can send and receive

Every worker flow on an installation receives messages. On these flows, workers can send them too:

- the [built-in worker](./built-in-worker.md) flow, `agent`;
- the [coordinator](./coordinators.md) flow, whatever the coordinator routes by;
- a [flow of your own](#on-your-own-worker-flow) built with `defineSessionBoard`.

On the built-in and coordinator flows there's nothing to switch on: every worker gets a `sendMessage` tool on every turn. Your own flow needs [one line](#on-your-own-worker-flow).

A worker can message any other worker on its user's roster: your own hires and the standard workers from your files. A worker on another user's roster can't be reached, and the refusal reads the same as for a worker that doesn't exist.

A message to a coordinator wakes the coordinator's own turn, even one that hands your lines straight to its delegates by `round-robin` or `everyone`.

Some workers hear messages only in their tasks' sessions, such as the coding worker in Shift Manager's `devteam` Lab. They have no conversation to answer from, so a message sent to one by name is refused with `task_sessions_only`, and nothing is sent. File it a task instead.

## Sending a message

The model calls `sendMessage` with the recipient's worker id and the text:

```json
{ "to": "chief-of-staff", "text": "What's the codename for the spring launch?" }
```

The input takes `to`, `text` and, for an answer, `inReplyTo`. Nothing else. The tool's description lists the workers the send would take, by id and description, so the model picks from real ids. The sending worker itself, and workers that hear only in task sessions, aren't listed.

A sent message answers with its id:

```json
{ "sent": "msg_3f1c0a9e2b7d4c6a8e10" }
```

`text` holds up to 8,000 characters. A longer one is refused, not cut.

If the delivery couldn't be confirmed, the answer says so. The message may still arrive:

```json
{ "sent": "msg_3f1c0a9e2b7d4c6a8e10", "unconfirmed": "the delivery couldn't be confirmed (…); it may still arrive." }
```

## What the recipient sees

When a message arrives, the session it lands in gets two items:

- a line the recipient's model reads in its history, `From researcher: What's the codename for the spring launch?`, under the sender's name. It is never sent to the client.
- a component item of type `workforce:received` (`RECEIVED_MESSAGE_COMPONENT`), for your app to draw. Its `data` is `{ id, from, text, inReplyTo?, budget }`, where `budget` is how many more messages the exchange can send after this one. See [Showing messages in your app](#showing-messages-in-your-app).

Then the recipient takes a turn on it. That turn is told the message id, who sent it, how to answer, and how many more messages the exchange can send (see [The budget](#the-budget)).

A recipient in the middle of a turn hears the message after that turn ends. If the same message is delivered twice, the recipient wakes once.

You see all of it. Both workers' sessions are yours, and the message, the turn it started and any answer are in them like anything else.

### Where a message lands

| The message is | It lands in |
|----------------|-------------|
| An answer (sent with `inReplyTo`) | The session the original message was sent from, even a task's session whose task has finished. The answer wakes a turn there. |
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

There's no way to block on a reply. A worker that's told to "wait for the answer" sends the message and ends its turn. The answer starts a new turn when it comes. When a worker needs a colleague's result before it can go on, it should file a task and wait on that instead (see [Message or delegate?](#message-or-delegate)).

## The budget

Messages between workers can't run on forever. Each line you type starts a **budget**: at most 6 messages (`hopLimit`) for everything that descends from that line, across every worker. The messages, the turns they wake, the answers those turns send and the tasks filed along the way all draw on the same 6, parallel branches included. On top of that, any one request sends at most 3 (`perTurn`).

The send that would go past the budget is refused with `budget`, and the worker is told to stop passing messages on and say so. Your next line starts a fresh budget.

A fresh budget also starts:

- for a task that was filed held, when it is released;
- for a request with nothing behind it, such as one your server code starts.

A task a woken worker files draws on its filer's budget, and so does a delegate's ongoing session. Filing a task spends nothing, and a refused send spends nothing.

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

A refused send answers `{ ok: false, error }`, and nothing is sent. The error starts with a code, then says what happened in words the model can act on:

```json
{ "ok": false, "error": "task_sessions_only: \"eng.coder\" answers only from its tasks' sessions, so it can't be messaged by name. File it a task instead." }
```

| Code | When |
|------|------|
| `not_a_worker` | The sending session runs no worker. |
| `empty_message` | `text` is blank. |
| `message_too_long` | `text` is over 8,000 characters. |
| `not_yourself` | `to` is the sending worker. |
| `no_worker` | No worker by that id on the user's roster. Another user's worker answers this too. |
| `worker_unavailable` | The worker is on the roster but can't run, for example because its saved row can't be read. The error says why. |
| `task_sessions_only` | The worker hears messages only in its tasks' sessions. File it a task instead. |
| `no_such_message` | `inReplyTo` names no message the `to` worker sent this worker. |
| `budget` | The send would go past `messages.hopLimit` messages since the user's last line. |
| `per_request_limit` | This request already sent `messages.perTurn` messages. |
| `not_delivered` | The server refused the delivery. The error carries its reason. |

## Message or delegate?

A message is talk. [Delegating](./delegating-work.md) is handing over work. Pick by what the sender needs back.

| | Message | Task |
|-|---------|------|
| What it's for | A question, an FYI, a heads-up | Work that has to get done |
| Who it can go to | Any worker on your roster, except one that hears only in its tasks' sessions | One of the worker's own delegates that takes tasks |
| Where it runs | Usually the recipient's own conversation with you (see [Where a message lands](#where-a-message-lands)) | A new task session of its own |
| What comes back | Nothing is owed. An answer only if the recipient sends one | The task's ending, always: completed, failed or cancelled |
| On the board | Nothing | A row the filer can list, update and cancel |

A task keeps the reporting line. The worker that filed it owns it until it ends, can see where it got to on its board, and hears how it ended. A message has none of that. If the sender needs a result it can count on, it should file a task. If it needs a fact, an opinion or to pass something on, a message is enough.

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
| `call` | Always `false`. |

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
| `id` | The message id, `msg_…`. |
| `from`, `to` | The sending and receiving worker ids. |
| `text` | What was said. |
| `exchange` | The id of the first message in the exchange. A message and its answers share one. |
| `inReplyTo` | The message this one answers, when it answers one. |
| `fromSession`, `fromFlow` | The session it was sent from, and that session's flow. |
| `toSession`, `toFlow` | The session it landed in, and that session's flow. |
| `chain` | The id of the budget the message drew on: everything descending from one user's line. Optional. |
| `hop` | Its place in that budget, from 1. |
| `status` | `delivered`, `refused`, or `unconfirmed`. |
| `reason` | Why it was refused or is unconfirmed. |
| `at` | When it was sent, in ms. |

The read never returns another user's messages.

In a conversation, each side of a message is an item you can match on. Both names come from `@flow-state-dev/workforce/browser`:

- A sent message is a `tool_output` item for the tool named `SEND_MESSAGE_TOOL` (`"sendMessage"`). Match on it to draw the message as a line of its own rather than a tool call.
- A received message is a `component` item whose component is `RECEIVED_MESSAGE_COMPONENT` (`"workforce:received"`), with `data` of `{ id, from, text, inReplyTo?, budget }`.

[Shift Manager](../shift-manager/overview.md) does all of this: its Messages screen lists the log, a conversation shows each sent message as *To &lt;worker&gt;: &lt;text&gt;*, and each received message as its own item under the sender's name.

## Related pages

- [Delegating work](./delegating-work.md): filing tasks for a worker's delegates.
- [Coordinators](./coordinators.md): a worker that hands each message to its delegates.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, worker flows and `hireWorkforce`.
