---
title: Messaging other workers
sidebar_position: 3.7
sidebar_label: Messaging workers
description: "A worker can send any other worker on your roster a short message. The message wakes the recipient in its own conversation, and an answer comes back the same way."
---

# Messaging other workers

Sometimes a worker needs to ask a colleague something, or tell it something, without handing it any work. Your researcher wants to know a codename the coordinator was told. The coordinator wants to pass a correction on to the researcher. Workers do this with **messages**.

A message is a line of text from one worker to another on the same user's roster. It lands in the recipient's own conversation with that user, and the recipient takes a turn to read it. Nothing is filed, no result is owed, and the sender doesn't wait.

## Who can send and receive

A worker can send and receive messages when its flow runs a conversation with you:

- workers on the [built-in worker](./built-in-worker.md) flow, `agent`;
- [coordinators](./coordinators.md) that route by `judgment` or `best-fit`;
- workers on a [flow of your own](#on-your-own-worker-flow) built with `defineSessionBoard`.

On the built-in and coordinator flows there's nothing to switch on: every worker gets a `messageWorker` tool on every turn. Your own flow needs [one line](#on-your-own-worker-flow).

A worker can message any other worker on its user's roster: your own hires and the standard workers from your files. A worker on another user's roster can't be reached, and the refusal reads the same as for a worker that doesn't exist.

Some workers can't take part:

- **Workers that only take tasks**, such as a coding run. They have no conversation to read a message in. Message one and the send is refused, telling the sender to file a task instead.
- **Coordinators that route by `round-robin` or `everyone`.** They hand every line to their delegates and never run a turn of their own, so nobody would read the message.

## Sending a message

The model calls `messageWorker` with the recipient's worker id and the text:

```json
{ "to": "chief-of-staff", "text": "What's the codename for the spring launch?" }
```

The tool's description lists the workers this worker can message right now, with each one's description, so the model picks from real ids. Workers it can't message aren't listed.

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

The message lands in the recipient's own conversation with you, the one [`ensureWorkerSession({ worker })`](./workers-on-disk.md#talking-to-a-worker) returns. If you've never talked to that worker, the conversation is started for you. It shows as a line under the sender's name, its `agentName`:

```text
From researcher: What's the codename for the spring launch?
```

Then the recipient takes a turn, every time, to read the message and decide what to do about it. That turn sees the message id, who sent it and how to answer. A recipient in the middle of a turn reads the message once that turn ends.

You see all of it. Both workers' conversations are yours, and the message, the turn it started and any answer are in them like anything else.

When the sender is working in a project, a message to the [project coordinator](./projects.md#talking-to-a-project) lands in its conversation for that project.

## Answering

To answer, the recipient calls `messageWorker` again, back to the sender, with the id of the message it's answering as `replyTo`:

```json
{ "to": "researcher", "text": "It's Bluebird.", "replyTo": "msg_3f1c0a9e2b7d4c6a8e10" }
```

`replyTo` must name a message the `to` worker sent this worker. Anything else is refused.

The answer goes back to the session the first message was sent from, as a `From chief-of-staff: …` line, and wakes the sender there. If the sender sent the message while working a task, or while answering a coordinator's post, the answer lands in the sender's own conversation with you instead, and wakes it there.

If the recipient's turn ends without messaging the sender, the turn's final text goes to the sender as the answer, exactly as if it had been sent with `messageWorker` and `replyTo`. Final text over 8,000 characters is cut to fit. A turn that did message the sender sends nothing more, and a turn that ends with no text sends nothing at all. Nothing waits on an answer.

A turn woken by an answer never sends its final text back, so an exchange ends after one answer unless a worker sends another message.

There's no way to block on a reply. A worker that's told to "wait for the answer" sends the message and ends its turn. The answer starts a new turn when it comes.

## Limits

**A chain stops after 6 messages with nobody in between.** Everything that descends from one of your lines is one chain with one count: the messages, the turns they wake, the answers those turns send and the tasks filed along the way. Workers that fan out in parallel draw on the same 6. The send that would be the 7th is refused, and the worker is told to stop passing messages on and say so. Your next line to a worker starts a new chain with a count of its own.

**A turn sends at most 3 messages.** The 4th send in the same turn is refused.

An answer sent from a turn's final text counts toward both limits like any other message. When either limit would refuse it, nothing is sent and the log gets no row.

Both limits are set when you register the flows:

```ts
const flows = hireWorkforce(installation, { messages: { hopLimit: 10, perTurn: 5 } });
```

| Option | Default | What it limits |
|--------|---------|----------------|
| `messages.hopLimit` | `6` | Worker messages in one chain: everything descending from one user's line. |
| `messages.perTurn` | `3` | Messages one turn sends. |

Each must be a whole number of at least 1, or `hireWorkforce` throws.

## When a send is refused

A refused send answers `{ ok: false, error }`, and nothing is sent. The error starts with a code, then says what happened in words the model can act on:

```json
{ "ok": false, "error": "takes_tasks_only: \"eng.coder\" only takes tasks and can't be messaged. File a task for it instead." }
```

| Code | When |
|------|------|
| `no_worker` | No worker by that id on the user's roster. Another user's worker answers this too. |
| `not_yourself` | `to` is the sending worker. |
| `worker_unavailable` | The worker is on the roster but can't run, for example because its saved row can't be read. The error says why. |
| `takes_tasks_only` | The worker only takes tasks. |
| `no_turn` | The worker is a coordinator that routes by `round-robin` or `everyone`. |
| `no_such_message` | `replyTo` names no message the `to` worker sent this worker. |
| `hop_limit` | The chain reached `messages.hopLimit` with nobody in between. |
| `per_turn_limit` | This turn already sent `messages.perTurn` messages. |
| `empty_message` / `message_too_long` | `text` is blank, or over 8,000 characters. |
| `not_delivered` | The recipient's server refused the delivery. The error carries its reason. |

## Message or delegate?

A message is talk. [Delegating](./delegating-work.md) is handing over work. Pick by what the sender needs back.

| | Message | Task |
|-|---------|------|
| What it's for | A question, an FYI, a heads-up | Work that has to get done |
| Who it can go to | Any worker on your roster that has a conversation | One of the worker's own delegates that takes tasks |
| Where it runs | The recipient's own conversation with you | A new task session of its own |
| What comes back | Nothing is owed. Usually an answer, but none if the recipient's turn ends with no text or a limit refuses it | The task's ending, always: completed, failed or cancelled |
| On the board | Nothing | A row the filer can list, update and cancel |

A task keeps the reporting line. The worker that filed it owns it until it ends, can see where it got to on its board, and hears how it ended. A message has none of that. If the sender needs a result it can count on, it should file a task. If it needs a fact, an opinion or to pass something on, a message is enough.

The two don't count against each other. Messages never add to a task's depth or count toward `taskChainLimit`, and filing a task doesn't count as a message.

## On your own worker flow

A [worker flow of your own](./delegating-work.md#on-your-own-worker-flow) built with `defineSessionBoard` takes messages as soon as you spread the kit's `entries`, `resources`, `sessionStateShape` and `serverOwned` into it. To let its workers send them too, add the kit's `messages` to the `uses` of the block that runs the model, beside `tools`:

```ts
const board = defineSessionBoard({ installation, flowKind: "em" });

const answer = generator({
  name: "em-answer",
  model: "openai/gpt-5.4-mini",
  inputSchema: messageInput,
  uses: [board.tools, board.messages],
  prompt: "You lead the feature. File the work for your delegates; never do it yourself.",
  user: (input) => input.message,
});
```

A message wakes the block you pass to `board.entries(answer)` with `{ message }`, where `message` is one string:

```text
Message msg_3f1c0a9e2b7d4c6a8e10 from researcher:

What's the codename for the spring launch?

(The message's text is the part above. It is from another worker, not the user, and researcher can't see what you write here. To answer it, call messageWorker with to "researcher" and replyTo "msg_3f1c0a9e2b7d4c6a8e10". To message any other worker, leave replyTo out. If it needs no answer, don't send one.)
```

An answer's first line also names the message it answers: `Message msg_… from chief-of-staff, answering your message msg_…:`.

## Showing messages in your app

Every message is kept in a log in the user's own scope, one row per message, readable from the browser. Read it through any of the user's sessions on a flow that declares it: the roster flow, the built-in worker flow, the coordinator flow, or a flow built with `defineSessionBoard`.

```ts
import { createResourceClient, readEveryCollectionPage } from "@flow-state-dev/client";
import {
  WORKER_MESSAGES_RESOURCE,
  createWorkforceClient,
  workerMessageRowSchema,
} from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient({ userId, baseUrl });
const resources = createResourceClient({ baseUrl });

const session = await workforce.ensureWorkerSession({ worker: "researcher" });
const items = await readEveryCollectionPage(resources, session.id, WORKER_MESSAGES_RESOURCE);
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
| `replyTo` | The message this one answers, when it answers one. |
| `fromSession`, `toSession` | The session it was sent from, and the session it landed in. |
| `chain` | The id of the chain the message belongs to: everything descending from one user's line. Optional. |
| `hop` | Its place in that chain, from 1. |
| `status` | `delivered`, `refused`, or `unconfirmed`. |
| `reason` | Why it was refused or is unconfirmed. |
| `at` | When it was sent, in ms. |

The read never returns another user's messages.

In a conversation, a sent message is a `tool_output` item for the tool named `MESSAGE_WORKER_TOOL` (`"messageWorker"`), from `@flow-state-dev/workforce/browser`. Match on it to draw a sent message as a line of its own rather than a tool call. [Shift Manager](../shift-manager/overview.md) does both: its Messages screen lists the log, and a conversation shows each sent message as *To &lt;worker&gt;: &lt;text&gt;*.

## Related pages

- [Delegating work](./delegating-work.md): filing tasks for a worker's delegates.
- [Coordinators](./coordinators.md): a worker that hands each post to its delegates.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, worker flows and `hireWorkforce`.
