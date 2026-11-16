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

There's nothing to turn on. Once an app installs the workforce kit, a worker on its built-in `agent` or `coordinator` flow has the rule tools, and the kit has no rules option.

The worker doesn't ask first. The `✎` line comes from the tool, not the model: you see it, and the model doesn't get it back as history. If a rule is wrong, or you want one changed or dropped, say so:

```text
You: Only ask when it's more than three tasks.
✎ Rule 2 changed: "Ask before filing tasks." → "Ask before filing more than three tasks."

You: Forget the rule about asking.
✎ Rule 2 removed (2 of 20 left): "Ask before filing more than three tasks."
```

The worker does this with four tools, one each to read, add, change and remove a rule. The tools and their refusals are in the [workforce reference](../../reference/workforce.md).

## Where they apply

A worker follows your rules on every turn it takes for you, in any session, including tasks you filed. An edit counts from the next turn, with no new session. On a store that persists, such as SQLite or Postgres, rules survive a restart. A task can follow your rules but can't change them.

If the rules can't be read, say the store is down, the turn runs without them and posts a status line saying so. The turn doesn't fail.

## Whose rules they are

Rules belong to one worker and one user. A note you give a coordinator doesn't reach your other workers, and two people using the same worker each have their own list. A [fork](./index.md) starts with no rules, because it gets its own id. So does a worker you move to a different flow: its rules stay behind on the old one.

Rules aren't memory. [Memory](../memory/index.md), once you add it, is shared by all of a user's workers and comes back when a search finds it. A rule comes back on every turn, for one worker.

A worker keeps up to 20 one-line rules. When the list is full, an add is refused, nothing is saved, and you see this, with the worker asking which rule to merge or drop:

```text
✎ Rule not added: the list is full (20 of 20); merge or drop a rule before adding one.
```

A write the store can't save posts no line, and no existing rule is lost.

## Rule or brief

Say the team wants eng-lead to always answer in French. If every user of the worker should get French, put it in the brief, the `WORKER.md` body, which is the same for every user. If only one user wants it, it's a rule: read only on that user's turns, and it can't change the worker's instructions or anyone else's turns. A rule is text the model reads after the worker's own instructions, not a setting, so don't count on it overriding the file.

## Editing them yourself

An app reads and edits a user's rules through the workforce client's `standingRules(workerId, input)`. The worker's [inventory row](../../reference/workforce.md) says `rules: true` when `standingRules` works for that worker.

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

- [The built-in worker](./index.md): what a worker on `agent` keeps, and the tools it has.
- [Coordinators](./coordinators.md): workers that hand work to delegates, and keep rules the same way.
- [The Shift Coordinator](../starters/shift-manager.md): an org-level coordinator you can coach with rules.
- [The workforce reference](../../reference/workforce.md): the rule tools, limits, refusals and the client call.
