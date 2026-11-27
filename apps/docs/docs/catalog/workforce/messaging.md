---
title: Messaging between workers
type: catalog
description: "A worker sends another worker on the same roster a short message, then goes on with its turn or waits for the reply."
---

import Figure from "@site/src/components/Figure";
import TwoWays from "./figures/messaging-two-ways.svg";

# Messaging between workers

A message is one line of text from one worker to another worker on the same user's roster. A worker is a named agent the user talks to, and the roster is the set of workers that user has. The message wakes the recipient for a turn, one run of its model, and the recipient decides what to do about it. No task is filed and no result is owed.

Colleagues ask each other small things: a fact, a correction, a heads-up. Those are too light to hand over as work, so nobody owns a message and nothing has to come back. The sender chooses each time whether to go on with its own turn or wait for the reply.

## What you get

Every worker on the built-in `agent` flow, and every [coordinator](./coordinators.md), has a tool called `sendMessage` on every turn. It is always on. The tool's description lists the workers the sender can message, by id and description, so the model picks real ids.

A message reaches only workers on the same user's roster, so Alice's worker cannot message Bob's. A send to any other id, one of Bob's workers included, is refused with `no_worker: no worker "<id>" on your roster.`, the same text as for an id that does not exist, so the sender learns nothing about other rosters. A message lands in the recipient's conversation with that user, Alice. The other refusals are in the [Reference](../../reference/worker-messaging.md).

## Install it

There is nothing separate to install. Messaging is part of the workforce kit. [Workforce](./index.md) covers the install.

## Use it

### Send and go on

The model calls the tool with `to` and `text`:

```json title="sendMessage"
{ "to": "teammates.researcher", "text": "The launch date moved to May 14." }
```

The tool answers `{ "sent": "msg_…" }`. That means the message is recorded in the message log and on its way, not that it has landed. The sender's turn goes on, and the recipient takes a turn on the message.

If the recipient's turn ends in plain text, that text goes to no one. To answer, the recipient calls `sendMessage` back with `inReplyTo` set to the message's id.

To ask a question and go on, add `replyRequested: true`. The tool answers `{ sent }` and the sender's turn goes on. When the recipient's turn ends, its final text goes back as a message from it, which wakes a new turn in the conversation that sent the question. A message that asks for a reply always gets exactly one answer: when the recipient's turn fails or ends with no text, the framework sends a "no answer" in its place.

### Ask and wait

When the sender cannot go on without the answer, it passes `wait: true`. That asks for a reply as `replyRequested` does, and the sender waits for it in the same turn. The optional `deadline` caps the wait.

```json title="sendMessage"
{ "to": "teammates.researcher", "text": "When does the launch go out?", "wait": true, "deadline": 60000 }
```

The answer comes back as the tool's result, and no message lands in the sender's conversation:

```json title="sendMessage result"
{ "status": "answered", "sent": "msg_…", "reply": "May 14, from the launch plan." }
```

With no `deadline`, a wait lasts five minutes. If the deadline passes first, the result is `{ "status": "running", "sent": "msg_…" }`: nothing is stopped, the sender's turn goes on, and the answer arrives later as a message, as in the first timeline below. Don't send the question again; tell the worker in its file to carry on and use the answer when it comes. The fields and the other results are in the [Reference](../../reference/worker-messaging.md).

<Figure svg={TwoWays} caption="Two ways to ask, and where the answer lands" description={"Two timelines. The first, ask and go on with replyRequested, runs left to right: a dashed asking turn by chief-of-staff that sends and finishes, a hatched message, a dashed turn by researcher that writes the answer, a hatched message holding the answer, and a highlighted dashed later turn by chief-of-staff that the answer wakes. The second, ask and wait with wait true, is one long dashed turn by chief-of-staff. An arrow runs down from it to a hatched message, across to a dashed turn by researcher, to a hatched message holding the answer, and up into the same turn, so no new turn starts. A note says that if the deadline passes first, the turn goes on and the answer comes later as a message."} />

A wait needs a host with durable execution, one that can pause a turn and resume it later, and `fsdev dev` and `fsdev run` have it. The refusal on other hosts and the limit of one wait per round of tool calls are in the [Reference](../../reference/worker-messaging.md). To ask several workers, send each a message with `replyRequested`.

To pick between the three: a plain message for a heads-up, `replyRequested` when the answer is wanted but the turn can go on, `wait: true` when the answer blocks the turn.

A message is not a task. To get a result the sender can count on, file a task: [Delegating work](./delegating-work.md). A worker that answers only inside its tasks, such as one that runs only coding tasks, can't be messaged by id: `sendMessage` to its id is refused, and the tool doesn't list it. File it a task.

### Tell a worker when to message

The worker's model decides when to send. Guide it in the worker's file. You don't add `sendMessage` to a `tools:` line in `WORKER.md`, and leaving it out doesn't remove it.

```md title="workforce/teams/teammates/workers/chief-of-staff/WORKER.md"
---
name: Chief of Staff
description: Runs the team's work with you. It asks researcher and writer for facts and drafts.
---

When you need a fact, message researcher with `sendMessage`. Pass `replyRequested: true`,
so the answer comes back to you, and never pass `wait`: keep answering the user in this
turn with what you have. The reply reaches you as its own message after your current answer.
```

### Where you see it

The user sees both conversations, because both workers' conversations are the user's own. In the sender's, the call is a `sendMessage` tool call. In the recipient's, a landed message is a `workforce:received` data item, a structured record for the app to draw, and the recipient's model reads it as a line from the sender.

Shift Manager, the browser app a workforce is worked through, draws a sent message as *To teammates.researcher: …*, and a received one as a line under the sender's name. Its Messages screen lists that log: one row per message, never another user's.

## Slots it opens

None.

## Slots it fills and views it serves

A slot is an opening a kit leaves for other kits. Messaging uses one, the workforce kit's `workerFlows`, where an app adds worker flows beside `agent`. A flow you add there receives messages through an `onMessageReceived` action, built by the `messageReceivedEntry` function from `@flow-state-dev/workforce`. The startup refusal for one that cannot is in the [Reference](../../reference/worker-messaging.md).

Messaging keeps the message log, a resource collection an app's screens read, and adds a `workforce:received` data item to the receiving session's conversation. The item's fields, and the log's, are in the [Reference](../../reference/worker-messaging.md).

## Change it

`budget`, 6 by default, caps how many messages all workers together can send in answer to one line the user types. `perTurn`, 3 by default, is the most one turn sends. What each counts and the refusals are in the [Reference](../../reference/worker-messaging.md).

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";

export default createFlowState({
  kits: [workforce({ directory: "./workforce", messages: { budget: 10, perTurn: 5 } })],
});
```

## Next

- [Delegating work](./delegating-work.md): file a task when a result is owed.
- [Coordinators](./coordinators.md): workers that route messages to delegates.
- [Worker messaging reference](../../reference/worker-messaging.md): delivery states, every refusal, the log row, the option table.
- [Workers](../../concepts/workers.md): the file that briefs a worker.
