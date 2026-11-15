---
title: Route with an evaluator
type: recipe
description: Ask a model questions you already know the answers to, route on its answers with a tree that sends doubtful cases to one fallback block, and let the skill activator pick skills the same way.
---

# Route with an evaluator

Most model calls in a workflow aren't asking for prose. They're asking a question whose possible
answers you already know: which team gets this ticket, is it urgent, which skill fits. An
`evaluator` block asks those questions and hands back typed answers your code can branch on.

**What we're building:** a support-ticket triage that classifies a ticket, routes it through a
two-level tree, and sends anything the model isn't sure about to a review block. Then the same
idea applied to picking skills.

:::tip Full, runnable code
Every snippet here is trimmed from
[`examples/guides/routing-with-evaluators`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/routing-with-evaluators),
which has a passing test suite that needs no API key. The example uses Jev, an evaluation model
(one that answers fixed questions with typed answers rather than generating text) served by
Vercel's AI Gateway, so running it against a real model needs `AI_GATEWAY_API_KEY`:

```bash
cd examples/guides/routing-with-evaluators
pnpm fsdev run routing-with-evaluators classify -i '{"message":"I was charged twice for March"}'
```
:::

## Step 1: ask the questions

An evaluator takes some state (here, the ticket text) and a map of questions. `choice` picks one
of your options, `score` places the answer on a scale you define, and
`boolean` estimates how likely a yes is.

```ts title="src/flows/support/blocks/classify-ticket.ts"
import { evaluator, choice, score, boolean } from "@flow-state-dev/core";
import { z } from "zod";

export const classifyTicket = evaluator({
  name: "classify-ticket",
  model: "typesafe-ai/jev",
  inputSchema: z.object({ message: z.string().min(1) }),
  state: (input) => input.message,
  questions: {
    team: choice("Which team should handle this?", {
      billing: "Payments, charges and refunds",
      technical: "Bugs, errors and outages",
    }),
    frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
    urgent: boolean("Does this need someone now?"),
  },
});
```

The output is `{ answers }`, keyed by your question ids and typed by them:
`answers.team.choice` is `"billing" | "technical"`, not `string`.

Any model that supports AI SDK evaluation works. `"typesafe-ai/jev"` goes through the gateway;
with an OpenAI key, pass `openai.evaluationModel("gpt-6-luna")` instead. See
[Models](../concepts/models.md). A model that can only generate
text is refused when the block is built.

Jev reports a `confidence` with its choice answers. OpenAI's evaluation model reports none, and
the `confidence` key is then absent.

## Step 2: route on the answers

When one answer decides which question to ask next, write the tree with `cascadingRouter`.
Each level asks one evaluator a choice question, and each branch names the option that opens it
and, optionally, the minimum confidence it needs. A branch opens only when the model chose its
option, reported a confidence, and that confidence reaches the branch's `minConfidence` if one is
set. The floor is inclusive: at `0.6`, a confidence of 0.6 opens the branch and 0.59 does not.
Anything else, at any level, goes to your required `ambiguous` block instead of a guess. On a
model that reports no confidence, that is every ticket.

```ts title="src/flows/support/blocks/triage.ts"
import { evaluator, choice, utility } from "@flow-state-dev/core";
import { z } from "zod";
import { urgentBilling } from "./urgent-billing";
import { billingQueue } from "./billing-queue";
import { techQueue } from "./tech-queue";
import { review } from "./review";

const inputSchema = z.object({ message: z.string().min(1) });

const department = evaluator({
  name: "department",
  model: "typesafe-ai/jev",
  inputSchema,
  state: (input) => input.message,
  questions: {
    team: choice("Which team should handle this?", {
      billing: "Payments, charges and refunds",
      technical: "Bugs, errors and outages",
    }),
  },
});

const billingUrgency = evaluator({
  name: "billing-urgency",
  model: "typesafe-ai/jev",
  inputSchema,
  state: (input) => input.message,
  questions: {
    urgency: choice("How urgent is this billing issue?", {
      urgent: "Needs someone now",
      routine: "Can wait in the queue",
    }),
  },
});

export const triage = utility.cascadingRouter({
  name: "triage",
  ambiguous: review,
  root: {
    ask: department,
    on: "team",
    branches: {
      billing: {
        minConfidence: 0.6,
        next: {
          ask: billingUrgency,
          on: "urgency",
          branches: {
            urgent: { minConfidence: 0.6, block: urgentBilling },
            routine: { minConfidence: 0.5, block: billingQueue },
          },
        },
      },
      technical: { minConfidence: 0.6, block: techQueue },
    },
  },
});
```

`urgentBilling`, `billingQueue`, `techQueue` and `review` are your own blocks, each in its own
file beside this one. In the example each is a handler that returns a queue name:

```ts title="src/flows/support/blocks/review.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const review = handler({
  name: "review",
  inputSchema: z.object({ message: z.string().min(1) }),
  execute: () => ({ queue: "review" }),
});
```

Every leaf and `ambiguous` receive the router's own input, the ticket. `review` is not told why
it got the ticket. The reason (`no-confidence`, `below-floor` or `no-branch`) and the model's
choice are on that level's verdict in the trace.

Branch keys are checked against the question's options, so a typo is a compile error. Only the
levels on the chosen path run.

With `strict: true` in `tsconfig.json`, `ask` rejects an evaluator that has typed questions with
a `strictFunctionTypes` error. Keep `strict` and add `strictFunctionTypes: false`.

Run it with a clear, urgent billing complaint and it lands on `urgentBilling`:

```bash
pnpm fsdev run routing-with-evaluators route -i '{"message":"I was charged twice for March and need it reversed today"}'
```

To branch on the bare answer from a model that reports no confidence, run an evaluator and follow
it with a plain [`router`](../concepts/blocks.md) that reads `answers.team.choice`.

A failed evaluation, such as a provider error, is not an answer. It fails the router with that
error and never reaches `ambiguous`. To keep the action going, put the router in a sequencer
with a rescue: `sequencer({ name: "safe-triage", inputSchema }).step(triage).rescue([{ block: fallback }])`.

`ambiguous` runs your block and hands nothing to a person on its own. To have someone look first,
call `ctx.suspendForUser({ kind: "review", prompt })` inside it. The request stops until the user
answers and resumes with `{ cancelled: false, answer }`, without asking the evaluators again. It
needs durable execution, which `fsdev run` and `fsdev dev` have. Only the user who sent the request
can answer it, not a second agent on their own account. See [Human in the loop](./human-in-the-loop.md).

## Step 3: let the skill activator use an evaluator

The skill activator picks which skills apply to a turn: a slash command first, then keywords,
then a classifier over your skill descriptions. Pass an evaluator and it does that third step with
an evaluation model instead. The evaluator picks by each skill's `description` and `when_to_use`
lines, so write them for the model.

```ts title="src/flows/support/blocks/skill-activator.ts"
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillActivator, readSkillsDirectory, skillEvaluator } from "@flow-state-dev/orchestration";

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills");

const { skills: initialSkills } = await readSkillsDirectory(skillsDir);

export const skillActivator = createSkillActivator({
  initialSkills,
  evaluator: skillEvaluator("typesafe-ai/jev"),
});
```

Slash commands and keywords win when they match. Otherwise the skills the evaluator picks
are the ones that activate. A model that reports no confidence works here too. See
[Skills](../catalog/skills.md).

## Where to go next

- [Blocks](../reference/blocks.md) for every evaluator option and the full answer shape.
- [Utility blocks](../reference/utility-blocks.md) for how an `ambiguous` result shows up in the
  trace, and when to reach for `intentRouter` instead.
- [Find by facets](./find-by-facets.md) to run an evaluator once when a document is written,
  then search its answers with no model call.
- [Memory](../reference/memory.md) to put an evaluator in front of memory capture.
