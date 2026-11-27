---
title: Round Robin
type: catalog
description: A fixed roster takes turns, and an optional referee critiques each round.
---

# Round Robin

Some reviews need the same few viewpoints, in the same order, every time. A writer drafts, a fact-checker verifies, a copy editor polishes, and then each of them sees what the others did and goes again.

`roundRobin` runs that. You give it a roster of agents. Each round, every agent speaks once, in the order you listed them, and sees everything said before it. An optional *referee* audits each round and writes a critique the next round can respond to. When the rounds end, a built-in *synthesizer* turns the transcript into one deliverable.

Use it when the set of perspectives and their order are known up front: an editorial review, a committee weighing a decision, a risk panel critiquing a trade. It is the wrong tool when the next speaker depends on what the last speaker said (use [Routed Specialists](./routed-specialists.md)), or when each contribution can be reviewed on its own (use [Supervisor](./supervisor.md)).

## How a run goes

```text
clear the transcript
  → each roster agent, in order
  → referee (only if you set one)
  → repeat until maxRounds or terminateWhen says stop
  → synthesizer (unless synthesizer: false)
```

The input is `{ goal: string }`. Every turn is recorded as `{ round, agentName, text }` in a transcript that the default roster agents read as they go. Each turn also appears on DevTool's Tasks tab as one task per round and agent, assigned to the agent's `name`.

## Install it

```bash
pnpm add @flow-state-dev/patterns
```

`roundRobin` comes from `@flow-state-dev/patterns`. The helper `createRoundRobinContributions` comes from `@flow-state-dev/patterns/round-robin`.

## Use it

The panel is a block, so it takes a file in the flow's `blocks/` folder.

```ts title="src/flows/editorial/blocks/editorial-review.ts"
import { roundRobin } from "@flow-state-dev/patterns";

export const editorialReview = roundRobin({
  name: "editorial-review",
  roster: [
    { name: "writer", role: "writer responsible for the original draft" },
    { name: "fact-checker", role: "fact-checker verifying every claim" },
    { name: "copy-editor", role: "copy editor polishing prose and clarity" },
  ],
  maxRounds: 3,
});
```

Add `editorialReview` as a step in the flow, with input like `{ goal: "Review the Q3 launch post" }`. Each roster entry becomes an LLM agent whose prompt carries its `role` and the transcript so far. The output is the synthesizer's text.

Pass `synthesizer: false` to skip the synthesizer and get `{ rounds, contributions, refereeCritiques }` back instead, where `refereeCritiques` is empty when no referee is set. Pass your own block as `synthesizer` to take over the last step, or set `outputSchema` to make the default synthesizer return structured output. `outputSchema` with `synthesizer: false` is an error. The [Patterns reference](../../reference/patterns.md) has the output shape and every config field with its default.

## Customize a roster agent

Most rosters need only `name` and `role`. The default agent streams plain text as it generates, and each `message` item carries the entry's `name` as `agentName`, so a chat UI can show the panel turn by turn.

To control an agent fully, give its roster entry a `block`. An override returns a string or `{ text }`, and brings its own prompt, tools and resources. Pattern-level `instructions`, `uses`, `tools` and `context` reach the default agents only.

```ts title="src/flows/editorial/blocks/legal-reviewer.ts"
import { generator } from "@flow-state-dev/core";
import { editorialContributions } from "../contributions";

export const legalReviewer = generator({
  name: "legal-reviewer",
  model: "openai/gpt-6-luna",
  resources: { contributions: editorialContributions },
  prompt: "Flag claims in the transcript that need legal sign-off. Reply in two sentences.",
  user: (_input, ctx) =>
    ctx.resources.contributions.state.entries
      .map((e: { round: number; agentName: string; text: string }) => `[Round ${e.round}] ${e.agentName}: ${e.text}`)
      .join("\n"),
});
```

An override sees only what it declares, so this one declares the transcript resource. `editorialContributions` is created under [Add a referee](#add-a-referee); pass it to the pattern as `contributions: editorialContributions` so the override and the pattern read the same transcript. In `editorialReview`, a roster entry of `{ name: "legal", block: legalReviewer }` takes the place of a default agent.

The pattern records only the `text`. An override that returns an object without a `text` string is stored as `String(value)` and logs a warning, so a structured result such as a vote does not reach the transcript.

## Add a referee

A referee reads the transcript after each round and returns a single `{ critique: string }`. Default roster agents see earlier critiques in their prompts, so the panel can answer them. A referee never ends the loop or changes who speaks.

Add one when your roster holds assigned stances, such as bull against bear, and contributors may exaggerate to defend a stance, wave away a strong opposing point, or claim things the data doesn't support. With no `referee`, the step is absent from the run. `createReferee({ name, contributions })` is a ready-made one you pass in yourself.

A referee that reads the transcript needs the transcript resource. Create it once, in a file both the referee and the panel import.

```ts title="src/flows/editorial/contributions.ts"
import { createRoundRobinContributions } from "@flow-state-dev/patterns/round-robin";

export const editorialContributions = createRoundRobinContributions();
```

```ts title="src/flows/editorial/blocks/strict-referee.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { editorialContributions } from "../contributions";

export const strictReferee = generator({
  name: "strict-referee",
  model: "openai/gpt-6-luna",
  outputSchema: z.object({ critique: z.string() }),
  resources: { contributions: editorialContributions },
  prompt: [
    "Audit the round for unsupported numeric claims and unhedged predictions.",
    "Return a short critique naming the contributor and quoting the passage.",
  ].join(" "),
  user: (_input, ctx) =>
    ctx.resources.contributions.state.entries
      .map((e: { round: number; agentName: string; text: string }) => `[Round ${e.round}] ${e.agentName}: ${e.text}`)
      .join("\n"),
});
```

In `editorialReview`, add `contributions: editorialContributions` and `referee: strictReferee`. `roundRobin` also takes `accessorKey` (default `"contributions"`), the key its own blocks declare the resource under. Your referee can use any key in its own `resources` map. Two round-robins in one sequencer need distinct keys, each with its own transcript:

```ts title="src/flows/editorial/blocks/legal-review.ts"
import { roundRobin } from "@flow-state-dev/patterns";
import { createRoundRobinContributions } from "@flow-state-dev/patterns/round-robin";

const legalContributions = createRoundRobinContributions();

export const legalReview = roundRobin({
  name: "legal-review",
  roster: [
    { name: "counsel", role: "Check claims for legal risk." },
    { name: "editor", role: "Rewrite flagged claims." },
  ],
  contributions: legalContributions,
  accessorKey: "legalContributions",
});
```

By default `roundRobin` keeps its own transcript, which is fine until a block outside the pattern needs to read it. Passing `contributions` is how you share it: register the same resource on the flow's `resources` map, and any block can declare it. The pattern clears the resource at the start of every run, so each run starts with an empty transcript. The resource is session-scoped, so after a second review in the same session it holds only the second review's turns, not a history. Browser clients can't read it; only blocks that declare it can. To keep a run's whole record after the loop, set `synthesizer: false` and take `{ rounds, contributions, refereeCritiques }` as the output. See the [Patterns reference](../../reference/patterns.md) for the rest.

## Decide when to stop

`maxRounds` caps the loop (default 5) and always wins. `terminateWhen(ctx)` runs after each round, after the referee, and returns `true` to stop early. It reads the round counter and critiques from `ctx.sequencer.state`, and your own conditions from `ctx.session.state`.

```ts title="src/flows/editorial/blocks/quick-review.ts"
import { roundRobin } from "@flow-state-dev/patterns";

export const quickReview = roundRobin({
  name: "quick-review",
  roster: [
    { name: "writer", role: "writer responsible for the original draft" },
    { name: "copy-editor", role: "copy editor polishing prose and clarity" },
  ],
  maxRounds: 5,
  terminateWhen: (ctx) => {
    const session = ctx.session?.state as { maxReviewRounds?: number } | undefined;
    const state = ctx.sequencer!.state as { round: number };
    return state.round >= (session?.maxReviewRounds ?? 1);
  },
});
```

Keep `terminateWhen` pure and total. A predicate that throws fails the run with a loop runtime error.

## What it won't do

- Skip or reorder speakers based on what was said. Use [Routed Specialists](./routed-specialists.md) for that.
- End the loop from a referee.
- Retry a roster agent that throws. The run fails.
- Give custom blocks the transcript. They see what they declare.
- Return structured output by default. The default synthesizer returns a string.

## See also

- [Debate](./debate.md) for when you want who-won-and-why and a moderator that picks the next speaker. Choose Round Robin for fixed order and a written-up deliverable.
- [Routed Specialists](./routed-specialists.md) for when the next speaker depends on context.
- [Supervisor](./supervisor.md) for per-task review with retry.
- [Patterns overview](./index.md).
- [Patterns reference](../../reference/patterns.md) for config fields, output shape and defaults.
