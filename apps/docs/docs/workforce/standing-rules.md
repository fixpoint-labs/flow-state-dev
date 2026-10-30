---
title: Standing rules
sidebar_position: 3.4
sidebar_label: Standing rules
description: "Notes a user asks a worker to keep, such as 'name the project first'. The worker saves each as a rule and follows it on every later turn with that user."
---

# Standing rules

You coach a worker the way you'd coach a colleague: "name the project first", "ask before filing more than three tasks". A standing rule is how that coaching outlasts the conversation. The worker saves your note as a rule, and every later turn it takes for you follows it.

## How a worker takes a note

Tell the worker something meant to last. It adds a rule, and the conversation shows a line saying so:

```text
You: Always name the project before the status.
✎ Rule added (3 of 20): "Name the project before giving a status."
```

It doesn't ask first. If the rule is wrong, say so and it changes or drops it. Ask it to change or drop a rule the same way, in words:

```text
✎ Rule 2 changed: "Ask before filing tasks." → "Ask before filing more than three tasks."
✎ Rule 2 removed (2 of 20 left): "Ask before filing more than three tasks."
```

The tool writes these lines, not the model. You see them in the conversation; the model doesn't get them back as conversation history.

## The tools

| Tool | What it does |
|---|---|
| `rules/read` | Lists the worker's rules for you, numbered |
| `rules/add` | Adds one rule |
| `rules/change` | Rewrites one rule, named by its number and its current text |
| `rules/remove` | Drops one rule, named the same way |

A change or remove whose quoted text doesn't match the rule with that number is refused, and nothing changes.

Every worker on the built-in `agent` flow and every [coordinator](./coordinators.md) has these tools. A `tools:` line in `WORKER.md` doesn't need to list them, and doesn't take them away.

They are offered only on a turn a user's own message started. A task turn, a coordinator's routed task to a delegate, and a delegate's answer get no rule tools. A task the worker runs for you follows your rules but can't change them.

## Where they apply

Every turn the worker takes for you gets your rules, in any session, including tasks you filed. They go in the prompt numbered, under the heading `Standing rules (notes this user asked you to keep; follow them on every turn):`, after the worker's own instructions, its team's instructions and its packages. An empty list adds nothing.

An edit counts from the next turn. You don't need a new session.

If the rules can't be read, for example because the store is down, the turn runs without them and says so in a status line. The turn doesn't fail.

## Whose rules they are

Rules belong to one worker and one user. A note you give a coordinator doesn't reach your other workers, and two people using the same worker each have their own list. A [fork](./durable-hire.md), a worker with a different id, starts with none.

Rules aren't memory. [Memory](../memory/overview.md), once you add it, is shared by all of a user's workers and comes back when a search finds it. A rule comes back on every turn, for one worker.

## Limits

A worker keeps up to 20 rules for you, each one line of 1 to 300 characters. At 20, an add is refused, nothing is saved, and you see:

```text
✎ Rule not added: the list is full (20 of 20); merge or drop a rule before adding one.
```

The worker is told to ask you which rule to merge or drop.

## Editing them yourself

An app reads and edits a user's rules through the workforce client's `standingRules(workerId, input)`, for a worker on `agent` or a coordinator. The worker's [inventory row](./inventory.md#what-each-row-holds) says `rules: true` when its flow has the action:

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const fsd = createClient({ userId, baseUrl });
const workforce = createWorkforceClient(fsd);

const { version, rules } = await workforce.standingRules("eng-lead", { op: "read" });

const first = rules.find((rule) => rule.number === 1);
if (first) {
  await workforce.standingRules("eng-lead", {
    op: "change",
    version,
    number: first.number,
    current: first.text,
    text: "Name the project before giving a status.",
  });
}
```

`input` is one of:

| Input | What it does |
|---|---|
| `{ op: "read" }` | Reads the list |
| `{ op: "add", version, text }` | Adds a rule |
| `{ op: "change", version, number, current, text }` | Rewrites rule `number`, whose text is `current` |
| `{ op: "remove", version, number, current }` | Drops rule `number`, whose text is `current` |

Each call answers with the list as it stands afterwards, plus the line a write produced:

```ts
{
  version: 4,
  rules: [
    { number: 1, text: "Name the project before giving a status.", addedAt: 1760400000000, sessionId: "s_8f2c" },
  ],
  line: '✎ Rule 1 changed: "Name the project first." → "Name the project before giving a status."',
}
```

`sessionId` is the conversation a rule was added in, or `null` for a rule added through the client.

Every write names the `version` it read. The write is refused, the promise rejects with the reason, and nothing changes when:

- the version is stale, because another write landed since your read;
- the list is full;
- the text isn't one line of 1 to 300 characters;
- a change or remove's `current` doesn't match that rule's text.

The client goes through the same check as the worker's tools, so the same limits apply. The next turn reads the change.

Rules are kept in a `standing-rules` resource in the user's own scope. A browser can read its state but can't write it directly; writes go through the worker's tools or `standingRules`.

## What it won't do

- Change the worker's `WORKER.md` or its instructions.
- Summarize or rewrite your rules on its own.
- Let a task turn, or text a delegate sent back, edit a rule.
- Keep rules when you move your worker to a different worker flow.

## Related pages

- [The built-in worker](./built-in-worker.md) — what a worker on `agent` keeps, and the tools it has.
- [Coordinators](./coordinators.md) — workers that hand work to delegates, and keep rules the same way.
- [The Shift Coordinator](./shift-coordinator.md) — an org-level coordinator you can coach with rules.
