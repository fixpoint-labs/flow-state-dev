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
served by Vercel's AI Gateway, so running it against a real model needs `AI_GATEWAY_API_KEY`:

```bash
cd examples/guides/routing-with-evaluators
pnpm fsdev run routing-with-evaluators classify -i '{"message":"I was charged twice for March"}'
```
:::

## Step 1: ask the questions

An evaluator takes some state (here, the ticket text) and a map of questions. There are three
kinds: `choice` picks one of your options, `score` places the answer on a scale you define, and
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
[Evaluation models](/docs/fundamentals/models#evaluation-models). A model that can only generate
text is refused when the block is built.

Jev reports a `confidence` with its choice answers. OpenAI's evaluation model reports none, and
the `confidence` key is then absent. Step 2 depends on that.

## Step 2: route on the answers

When one answer decides which question to ask next, write the tree with `cascadingRouter`.
Each level asks one evaluator a choice question, and each branch names the option that opens it
and, optionally, the minimum confidence it needs. Anything that doesn't open an edge goes to your
required `ambiguous` block instead of a guess.

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

`urgentBilling`, `billingQueue`, `techQueue` and `review` are ordinary blocks, each in its own
file beside this one. In the example they're handlers that return a queue name like
`{ queue: "billing-urgent" }`. In your app they could be anything.

Branch keys are checked against the question's options, so a typo is a compile error. The router
takes no model of its own; the evaluators carry it. Only the levels on the chosen path run.

Run it with a clear, urgent billing complaint and it lands on `urgentBilling`:

```bash
pnpm fsdev run routing-with-evaluators route -i '{"message":"I was charged twice for March and need it reversed today"}'
```

A ticket where the model's confidence falls below a branch's `minConfidence` lands on `review`.

**On a model that reports no confidence, every edge goes to `ambiguous`,** whether or not the
edge sets a minimum. To branch on the bare answer from such a model, run an evaluator and follow
it with a plain [`router`](/docs/fundamentals/blocks#router--runtime-dispatch) that reads
`answers.team.choice`.

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

Slash commands and keywords win when they match. Otherwise the model's pick is final, and
it works on a model that reports no confidence. See
[Activation paths](/docs/skills/activation#tier-3-with-an-evaluator).

## Where to go next

- [Blocks: Evaluator](/docs/fundamentals/blocks#evaluator) for
  every option and the full answer shape.
- [`cascadingRouter`](/docs/patterns/utility-blocks/core#cascadingrouter) for how an
  `ambiguous` result shows up in the trace, and when to reach for `intentRouter` instead.
- [Adding skills to your app](/guides/adding-skills-to-your-app) to build the catalog the
  activator picks from.
- [Find by facets](/docs/resources/searching#find-by-facets) to run an evaluator once when a
  document is written, then search its answers with no model call.
- [Deciding which turns to observe](/docs/memory/configuration#deciding-which-turns-to-observe)
  to put an evaluator in front of memory capture.
