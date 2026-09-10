---
title: Hiring a workforce
sidebar_position: 8
sidebar_label: Hiring a workforce
description: Turn worker records into configured, addressable copies of the flows your app defined — one seat per worker, each carrying the settings its own record declared.
---

# Hiring a workforce

Say your app runs three AI workers who collaborate: an intake desk, an engineering lead, an analyst. Each needs an address you can open a session against, and each needs its own settings — its model, its tools, the instructions that make it that worker and not another one.

You could write that by hand, three times. `hireWorkforce` does it in one call: you hand it a list of worker records and the flow kinds your app defined, and it hands back one running copy of a flow per worker. A **seat** is what comes back — one flow copy with its own address and its own settings.

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { workerAgentFlow, intakeFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "worker-agent": workerAgentFlow, intake: intakeFlow },
});

flowRegistry.registerMany(seats);
```

Two things it deliberately leaves to you. It does not build a flow — the record says *which* flow a worker runs and *how it is configured*, never what the flow does step by step. And it does not register anything: you register what comes back, so a workforce read from files and one written by hand arrive at the registry through the same door.

## A worker record

One record per worker. Nothing here is interpreted except the flow kind:

```ts
interface WorkerManifest {
  id: string;                          // "engineering.lead" — the whole identity, and the address
  declared: Record<string, unknown>;   // what the worker declared about itself
  body: string;                        // the worker's instructions, or "" for a seat with none
  codePath?: string;                   // set when the worker's folder holds a TypeScript file
}
```

The `id` is used exactly as written. It is the seat's flow instance id, so it is also the address you talk to it on: `POST /api/flows/engineering.lead/sessions`. Dots, not slashes — a `/` inside an id survives registration and then fails to route, which is a failure you would not find until somebody tried to use the worker.

Two keys inside `declared` mean something to the hire. `flow` names the kind, and `description` is a label for the roster. Everything else is that worker's settings, handed to its flow exactly as written.

## The flow decides what a worker may say about itself

A flow kind declares its settings with `configSchema`, and that schema is closed: a key it never declared is refused by name, at the hire, before anything runs.

```ts
export const workerAgentFlow = defineFlow({
  kind: "worker-agent",
  cardinality: "collection",
  configSchema: z.object({
    persona: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([]),
  }),
  // ...its graph builds a generator from `ctx.flow.config`.
});
```

So the flow's author, not the framework, decides what a worker of that kind may declare. A worker that asks for a `temperature` its flow never offered does not quietly run without one:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "engineering.lead" — Flow "worker-agent" instance "engineering.lead"
    has an invalid config bag: "temperature" is not a declared setting.
```

Settings are written the way the flow declares them. There is no translation between how a record spells a setting's name and how the code spells it, on purpose — one such rule is how a convention picks up a dialect.

Copies, ids, and settings bags are covered in [Flows](../fundamentals/flows.md#copies-that-differ-by-settings); addressing is in [How an instance is addressed](../fundamentals/flows.md#how-an-instance-is-addressed).

## A worker's instructions are one setting

A record's `body` is the worker's instructions. It reaches the flow as a setting named `persona`, alongside everything the record declared:

```ts
seats[1].config;
// { model: "openai/gpt-5.4-mini", tools: ["board", "search"],
//   persona: "You are the engineering lead. …" }
```

`persona` is the one name the hire imposes — a body has no name of its own until something gives it one. Routing it through the settings bag is what makes the next part free.

A worker with no body is a **thin seat**: a fully addressable worker that carries no persona at all, because none was written. It is not a lesser kind of worker; it is a copy of a flow that was not written to take instructions.

```ts
seats[0].config; // {} — this record declared no settings and has no body
```

And a flow that never declared `persona` refuses a body by name, the same way it refuses any other undeclared setting:

```
hireWorkforce refused 1 of 2 workers; nothing was hired:
  - worker "engineering.intake" — Flow "intake" instance "engineering.intake"
    has an invalid config bag: "persona" is not a declared setting.
```

That is the whole reason the body travels as a setting: no worker flow has to check for one. Prose written under a seat whose flow does not want it is an error at startup rather than something the flow silently ignores.

Two other rules follow from the same place. A body that is only whitespace contributes no `persona` at all — whitespace is not instructions, and an empty string handed to a flow that requires a persona would be a worse lie than sending nothing. And a record that declares `persona:` *and* carries a body is refused, naming both sources: there is no precedence rule, because picking a winner would mean a worker's instructions live in two places.

## What refusal looks like

Every problem here is a startup misconfiguration, so every problem throws. They are collected first, so one run names all of them and you fix them in one pass — and nothing is returned, so a bad record cannot leave you with a half-hired roster:

- a record with no `flow`, so there is no kind to hire it into;
- a record naming a kind that was not passed to `kinds`, with the kinds that were;
- a flow passed under a key that is not its own kind, since the seat would otherwise run a different worker's graph;
- a setting the flow never declared, or a required one the record omits, in the flow's own words;
- a body handed to a flow kind with no `persona`;
- two records claiming one id, which is two workers claiming one address;
- a record that carries a `codePath` and no `flow`. Pointing a seat at a TypeScript file is not wired up, so such a record is refused by name rather than dropped — the message says the code path is recorded and not yet in use, which is different from saying you forgot something.

## What a hired worker is

A seat is a flow copy and nothing else. There is no second species and no separate registry of workers: an intake desk is a seat, a coordinator is a seat, and a worker with a personality is a seat whose flow was written to take one. What separates them is what their flow accepts, not what kind of thing they are.

That also means a seat is a **dispatch target** — an address you open a session against. It is not the same list as the in-process workers a [task board](./task-board.md) drains. Same idea, different mechanism, and keeping the two apart is deliberate.
