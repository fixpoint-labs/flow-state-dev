---
title: Routing with evaluators
description: Ask a model questions you already know the answers to, route on its answers with a tree that hands doubtful cases to a person, and let the skill activator pick skills the same way.
---

# Routing with evaluators

Most model calls in a workflow aren't asking for prose. They're asking a question whose possible
answers you already know: which team gets this ticket, is it urgent, which skill fits. An
`evaluator` block asks those questions and hands back typed answers your code can branch on.

**What we're building:** a support-ticket triage that classifies a ticket, routes it through a
two-level tree, and hands anything the model isn't sure about to a review queue. Then the same
idea applied to picking skills.

**Concepts we'll cover:** the `evaluator` block and its three question types, what confidence
is and when a model gives it, `cascadingRouter` and its `ambiguous` branch, and passing an
evaluator to the skill activator.

:::tip Full, runnable code
Every snippet here is trimmed from
[`examples/guides/routing-with-evaluators`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/routing-with-evaluators),
which has a passing test suite that needs no API key. To run it against a real model:

```bash
cd examples/guides/routing-with-evaluators
pnpm fsdev run routing-with-evaluators classify -i '{"message":"I was charged twice for March"}'
```

The `classify`, `route` and `activate` actions use Jev (an evaluation model that reports
confidence, served by Vercel's AI Gateway), so they need `AI_GATEWAY_API_KEY`. `routeWithoutConfidence` uses OpenAI's evaluation model: set
`OPENAI_API_KEY`, or it goes through the gateway with the same `AI_GATEWAY_API_KEY`.
:::

## Step 1: ask the questions

An evaluator takes some state (here, the ticket text) and a map of questions. There are three
kinds: `choice` picks one of your options, `score` places the answer on a scale you define, and
`boolean` estimates how likely a yes is.

```ts title="src/classify.ts"
import { evaluator, choice, score, boolean, type EvaluationModel } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketSchema = z.object({ message: z.string().min(1) });

export const team = choice("Which team should handle this?", {
  billing: "Payments, charges and refunds",
  technical: "Bugs, errors and outages",
});

export function classifyTicket(model: string | EvaluationModel) {
  return evaluator({
    name: "classify-ticket",
    model,
    inputSchema: ticketSchema,
    state: (input) => input.message,
    questions: {
      team,
      frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
      urgent: boolean("Does this need someone now?"),
    },
  });
}
```

The example takes the model as a parameter, so its flow can pass `"typesafe-ai/jev"` and its
tests can pass a scripted model. In your own code, `model: "typesafe-ai/jev"` inline works just
as well.

The output is `{ answers }`, keyed by your question ids and typed by them:
`answers.team.choice` is `"billing" | "technical"`, not `string`.

Any model that supports AI SDK evaluation works here. We use Jev because it reports how
confident it is, which matters in the next step. How you reach a model depends on the key you
have:

- **A gateway key** (`AI_GATEWAY_API_KEY`): name Jev with the string `"typesafe-ai/jev"`. The
  gateway serves Jev as an evaluation model, but not `openai/...` strings.
- **An OpenAI key** (`OPENAI_API_KEY`): pass the instance,
  `openai.evaluationModel("gpt-5.4-mini")`. The example's `src/models.ts` also shows the same
  adapter pointed at the gateway's OpenAI-compatible endpoint, for when you only have a gateway
  key.
- **Your own Jev key**: install Jev's provider library and pass its evaluation model directly.
  flow-state.dev doesn't install it for you.

See [Evaluation models](/docs/fundamentals/models#evaluation-models).

A model that can only generate text is refused before the block makes any call. Pass
`openai("gpt-5.4-mini")` and building the block throws:

```text
Evaluator "classify-ticket": the model can generate but not evaluate.
Pass an evaluation model, e.g. openai.evaluationModel("gpt-5.4-mini"), or a model string.
```

## Confidence is only there when the model gives it

Jev attaches a `confidence` to its choice and score answers. OpenAI's and Anthropic's
evaluation models don't report one at all. When a model gives none, the key is simply absent. The
evaluator never fills the gap with a number, and nothing downstream should either.

## Step 2: route on the answers

When one answer decides which question to ask next, write the tree with `cascadingRouter`.
Each level asks one evaluator a choice question, and each branch names the option that opens it
and, optionally, the minimum confidence it needs. Anything that doesn't clear an edge goes to
your `ambiguous` branch instead of a guess.

```ts title="src/route.ts"
import { evaluator, choice, handler, utility, type EvaluationModel } from "@flow-state-dev/core";
import { z } from "zod";
import { team, ticketSchema } from "./classify";

export type Routed = { queue: "billing-urgent" | "billing" | "technical" | "review" };

const queue = (name: string, to: Routed["queue"]) =>
  handler({
    name,
    inputSchema: ticketSchema,
    outputSchema: z.object({ queue: z.enum(["billing-urgent", "billing", "technical", "review"]) }),
    execute: (): Routed => ({ queue: to }),
  });

const urgentBilling = queue("urgent-billing", "billing-urgent");
const billingQueue = queue("billing-queue", "billing");
const techQueue = queue("tech-queue", "technical");
const review = queue("review", "review");

const urgency = choice("How urgent is this billing issue?", {
  urgent: "Needs someone now",
  routine: "Can wait in the queue",
});

export function triage(model: string | EvaluationModel) {
  const department = evaluator({
    name: "department",
    model,
    inputSchema: ticketSchema,
    state: (input) => input.message,
    questions: { team },
  });
  const billingUrgency = evaluator({
    name: "billing-urgency",
    model,
    inputSchema: ticketSchema,
    state: (input) => input.message,
    questions: { urgency },
  });

  return utility.cascadingRouter({
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
}
```

Each level is `{ ask, on, branches }`: the evaluator to ask, the id of the choice question to
route on, and one branch per option. A branch is `{ block }` or `{ next }`, plus an optional
`minConfidence`. Branch keys are checked against the question's options, so a typo is a compile
error. The router itself never takes a model. The evaluators carry it, which is why `triage`
takes the model and builds them, reusing Step 1's `team` question for the first level.
`ambiguous` is required.

The leaves (`urgentBilling`, `review` and the rest) are ordinary blocks. Here they're handlers
that return the queue's name, like `{ queue: "billing-urgent" }`; in your app they could be
anything.

Run it on Jev with a clear, urgent billing complaint and it lands on `urgentBilling`:

```bash
pnpm fsdev run routing-with-evaluators route -i '{"message":"I was charged twice for March and need it reversed today"}'
```

Ask it something that isn't a support ticket, like your holiday schedule, and Jev's pick doesn't
clear the edge's floor, so the ticket lands on `review`.

**On a model that reports no confidence, every edge goes to `ambiguous`.** That holds whether or
not the edge sets a minimum. The example runs the same tree on OpenAI's evaluation model so you
can watch it:

```bash
pnpm fsdev run routing-with-evaluators routeWithoutConfidence -i '{"message":"I was charged twice for March"}'
```

Every ticket goes to review. The trace shows why: the model chose `billing`, and the verdict at
the first level is `ambiguous` with the reason `no-confidence`. If you're on one of those models
and want to branch on the bare answer, run an evaluator and follow it with a plain
[`router`](/docs/fundamentals/blocks#router--runtime-dispatch) that reads `answers.team.choice`.
[`cascadingRouter`](/docs/patterns/utility-blocks/core#cascadingrouter) shows that shape.

## Step 3: let the skill activator use an evaluator

The skill activator picks which skills apply to a turn. It tries a slash command first, then
keywords, then, if neither matched, a classifier over your skill descriptions. Pass an
evaluator and it does that third step with an evaluation model instead.

The example's catalog is three small `SKILL.md` folders. The evaluator picks by the
`description` and `when_to_use` lines, so write them for the model:

```md title="src/skills/outage-status/SKILL.md"
---
description: Tell a customer whether the service is down right now, what is affected and when it is expected back.
when_to_use: The customer reports that the product won't load or is erroring for everyone, or asks whether something is down.
keywords: [outage]
---
```

```ts title="src/activate.ts"
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvaluationModel } from "@flow-state-dev/core";
import {
  createSkillActivator,
  readSkillsDirectory,
  skillEvaluator,
} from "@flow-state-dev/orchestration";

const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "skills");

const { skills: initialSkills, errors } = await readSkillsDirectory(skillsDir);

export function skillActivator(model?: string | EvaluationModel) {
  if (model === undefined) return createSkillActivator({ initialSkills });
  return createSkillActivator({
    initialSkills,
    evaluator: skillEvaluator(model),
  });
}
```

`skillEvaluator(model)` builds an evaluator with one choice question: which of these skills
fits the message, or none? If you'd rather build the evaluator yourself, give it
`skillQuestions`.

Slash commands and keywords win when they match. Otherwise the model's pick is final. A
skill it picks activates, and "no skill" activates nothing. The activator doesn't compare the
pick's confidence to a threshold, so the same code works on a model that reports none. An
evaluator error fails the activator, the same way a failed default classifier does, and it
doesn't fall back to that classifier. If you'd rather the turn go on without a skill, wrap the
activator in [`.rescue`](/docs/sequencers/composing-blocks#rescue--catch-errors-route-to-recovery).
Leave `evaluator` out and the third step uses the default classifier. The example's `skillActivator()`
with no model does that. See
[Activation paths](/docs/skills/activation#tier-3-with-an-evaluator).

```bash
pnpm fsdev run routing-with-evaluators activate -i '{"message":"Nothing will load for anyone on our team since this morning, is something broken on your side?"}'
```

That message names no keyword, so the evaluator picks `outage-status` by its description.

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
