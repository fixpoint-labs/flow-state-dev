---
title: Standing rules
type: catalog
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

It doesn't ask first. If a rule is wrong, or you want one changed or dropped, say so:

```text
You: Only ask when it's more than three tasks.
✎ Rule 2 changed: "Ask before filing tasks." → "Ask before filing more than three tasks."

You: Forget the rule about asking.
✎ Rule 2 removed (2 of 20 left): "Ask before filing more than three tasks."
```

The worker does this with four tools, one each to read, add, change and remove a rule. The tools and their refusals are in the [workforce reference](../../reference/workforce.md).

## Where they apply

A worker follows your rules on every turn it takes for you, in any session, including tasks you filed. An edit counts from the next turn, with no new session. A task can follow your rules but can't change them.

## Whose rules they are

Rules belong to one worker and one user. A note you give a coordinator doesn't reach your other workers, and two people using the same worker each have their own list. A [fork](./durable-hire.md) starts with no rules, because it gets its own id. So does a worker you move to a different flow: its rules stay behind on the old one.

Rules aren't memory. [Memory](../memory/overview.md), once you add it, is shared by all of a user's workers and comes back when a search finds it. A rule comes back on every turn, for one worker.

A worker keeps up to 20 one-line rules. What you see when the list is full is on the [reference](../../reference/workforce.md).

## Editing them yourself

An app reads and edits a user's rules through the workforce client's `standingRules(workerId, input)`. The worker's [inventory row](./inventory.md#what-each-row-holds) says `rules: true` when `standingRules` works for that worker.

```ts title="src/lib/rename-rule.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function renameFirstRule(userId: string, baseUrl: string) {
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
}
```

Every write passes the `version` it read, and a change or remove also passes the rule's `current` text. If either differs from what is stored, the write is refused and the list stays as it was. The four inputs, what a call returns, and every refusal are on the [workforce reference](../../reference/workforce.md).

## Related pages

- [The built-in worker](./built-in-worker.md): what a worker on `agent` keeps, and the tools it has.
- [Coordinators](./coordinators.md): workers that hand work to delegates, and keep rules the same way.
- [The Shift Coordinator](./shift-coordinator.md): an org-level coordinator you can coach with rules.
- [The workforce reference](../../reference/workforce.md): the rule tools, limits, refusals and the client call.
