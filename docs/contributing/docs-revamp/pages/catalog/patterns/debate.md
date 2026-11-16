---
title: Debate
type: catalog
description: Agents argue assigned positions, and a judge reads the transcript and decides.
---

# Debate

Some decisions have real tradeoffs, and asking one model tends to give you a blend of both sides. Should the team ship the feature this week or hold it? You want the case for each side made at full strength, and then a ruling.

`debate` runs that. You give it two or more debaters, each with a name and an assigned position, called its *stance*. They argue across rounds and see each other's arguments. Then one *judge* reads the whole transcript and returns `{ verdict, winner, reasoning }`. `winner` is the stance the judge sided with, or `null` when it combined points from several stances.

By default a built-in *synthesizer* then turns that result into the final answer, shaped by the `outputSchema` you pass.

## When to use it

Reach for it when the question has genuine tradeoffs, when you want a result you can route or display rather than an essay, and when you can spend more tokens than a single call.

Skip it for factual lookups, for questions with an uncontroversial answer, and for flows where one model call is the whole budget. If you want a written-up deliverable shaped by panel feedback rather than a winner, use [Round Robin](./round-robin.md).

| | Debate | Round Robin |
| --- | --- | --- |
| Defining output | `{ verdict, winner, reasoning }` | A synthesized deliverable |
| Speaking order | Declared order, or chosen per round by a `moderator` | Declared order |
| Optional third role | `moderator`: picks speakers, briefs the debaters, can end the debate | `referee`: critiques each round, never controls order or ending |
| Stops on | `maxRounds`, moderator `done`, or `terminateWhen` | `maxRounds` or `terminateWhen` |
| Stances | Required per debater | Roles only |

## How a run goes

```text
question
  → [moderator picks speakers and briefs them]   only if you set one
  → each debater argues, seeing everything said before it
  → repeat until the debate stops
  → judge returns { verdict, winner, reasoning }
  → synthesizer writes the final answer           unless synthesizer: false
```

The input is `{ question: string }`. Each turn adds one entry to the transcript: `{ round, agentName, stance, text }`. DevTool shows each turn as a task assigned to the debater. `@flow-state-dev/ui` ships a `debate` renderer that draws the turns, the moderator's decisions and the verdict in a chat UI.

## Install it

```bash
pnpm add @flow-state-dev/patterns
```

`debate` comes from `@flow-state-dev/patterns`. The helpers `createDebateTranscript` and `createModerator` come from `@flow-state-dev/patterns/debate`.

## Use it

The debate is a block, so it takes a file in the flow's `blocks/` folder.

```ts title="src/flows/decide/blocks/feature-debate.ts"
import { debate } from "@flow-state-dev/patterns";
import { z } from "zod";

export const featureDebate = debate({
  name: "feature-debate",
  debaters: [
    { name: "advocate", stance: "ship now" },
    { name: "skeptic", stance: "do not ship now" },
  ],
  maxRounds: 2,
  outputSchema: z.object({
    decision: z.string(),
    rationale: z.string(),
  }),
});
```

Add `featureDebate` as a step in the flow, with input like `{ question: "Should we ship the new billing page this week?" }`. Every debater speaks in each round, in the order listed. Each turn's prompt carries the debater's stance and every earlier argument, tagged by stance, as in `[ship now] ...`. Debaters see stances, not names. The default prompt tells each debater to defend its stance without conceding.

The output matches `outputSchema`. Pass `synthesizer: false` to skip the synthesizer and get the raw result back: `{ rounds, question, transcript, verdict, moderatorDecisions }`. Setting `outputSchema` together with `synthesizer: false` is an error. The [Patterns reference](../../reference/patterns.md) has the full shape and every config field with its default.

You supply the stances. Debate does not derive positions from the question, so a debater with an empty `stance` is not given one by the model. The block throws when it is built, with a message starting `[debate]`. Dropping a debater until only one is left throws the same way, because a debate needs at least two. With three or more debaters you can argue more than two sides, such as aggressive, conservative and neutral readings of a risk.

## Let a moderator run the rounds

Without a moderator, everyone speaks every round. A *moderator* is a block that opens each round, including the first, and decides who speaks in it. The default one is `createModerator`. It must share the debate's transcript, so create one with `createDebateTranscript` and pass it to both.

```ts title="src/flows/decide/blocks/moderated-debate.ts"
import {
  createDebateTranscript,
  createModerator,
  debate,
} from "@flow-state-dev/patterns/debate";
import { z } from "zod";

const transcript = createDebateTranscript();

export const moderatedDebate = debate({
  name: "moderated-debate",
  transcript,
  debaters: [
    { name: "advocate", stance: "ship now" },
    { name: "skeptic", stance: "do not ship now" },
  ],
  maxRounds: 4,
  moderator: createModerator({
    name: "moderated-debate",
    rosterNames: ["advocate", "skeptic"],
    transcript,
  }),
  outputSchema: z.object({ decision: z.string(), rationale: z.string() }),
});
```

Each round the moderator returns:

- `nextSpeakers`: the debaters who speak this round, in order. They run one at a time, so later speakers see earlier ones.
- `briefing`: facts for this round's debaters, or `null`.
- `newAngle`: a question to focus this round on, or `null`.
- `done`: when `true`, this round runs as planned and the debate ends after it.

Give the moderator `tools` or `uses` and it can research before it briefs, so every debater argues from the same facts. Its tool calls stream as ordinary items. The default debater adds a `briefing` and a `newAngle` to its prompt when they are set, and a debater block you write reads them from `ctx.sequencer.state.moderatorDecisions`, taking the entry whose `round` matches `ctx.sequencer.state.round`.

A moderator naming a debater who is not in the roster fails the run. The error lists the available names. With a moderator, `moderatorDecisions` on the raw result has one entry per round.

## When it stops

A debate ends after a round when any of these holds:

- The round count reaches `maxRounds`, which defaults to 2.
- The moderator's decision had `done: true`.
- Your `terminateWhen(ctx)` returned `true`.

`terminateWhen` works with or without a moderator. Use it for early exits driven by session state, such as a spent budget. Keep it pure and total: an error it throws fails the run. A debater or moderator that throws fails the run too. Nothing is skipped.

## Change a debater

Most debaters need only `name` and `stance`. A `role` adds a persona line. To take over a debater, give its entry a `block`.

A block you write replaces the default debater whole, so debate passes it none of what the default gets. Its input is not the question, and its stance is not handed to it. It reads the rest from two places:

- The question and the round number are on the debate's state. Declare `sequencerStateSchema: debateStateSchema` and read `ctx.sequencer.state`.
- Earlier turns are in the transcript resource. Create it with `createDebateTranscript`, declare it in the block's `resources`, and pass the same one to `debate` as `transcript`. Its `entries` hold `{ round, agentName, stance, text }` in turn order.

Write the stance into the block's prompt yourself.

```ts title="src/flows/decide/blocks/transcript.ts"
import { createDebateTranscript } from "@flow-state-dev/patterns/debate";

export const transcript = createDebateTranscript();
```

```ts title="src/flows/decide/blocks/security-reviewer.ts"
import { generator } from "@flow-state-dev/core";
import {
  debateStateSchema,
  type DebateTranscriptState,
} from "@flow-state-dev/patterns/debate";
import { transcript } from "./transcript";

const stance = "do not ship now";

export const securityReviewer = generator({
  name: "security-reviewer",
  model: "openai/gpt-6-luna",
  resources: { transcript },
  sequencerStateSchema: debateStateSchema,
  prompt: `Argue "${stance}" from a security point of view. Do not concede. Reply in two paragraphs.`,
  user: (_input, ctx) => {
    const { question, round } = ctx.sequencer!.state;
    const { entries } = ctx.resources.transcript.state as DebateTranscriptState;
    const prior = entries.map((e) => `[${e.stance}] ${e.text}`).join("\n");
    return `Question: ${question}\nRound ${round}.\nEarlier arguments:\n${prior || "none"}`;
  },
});
```

```ts title="src/flows/decide/blocks/reviewed-debate.ts"
import { debate } from "@flow-state-dev/patterns/debate";
import { securityReviewer } from "./security-reviewer";
import { transcript } from "./transcript";

export const reviewedDebate = debate({
  name: "reviewed-debate",
  transcript,
  debaters: [
    { name: "advocate", stance: "ship now" },
    { name: "skeptic", stance: "do not ship now", block: securityReviewer },
  ],
});
```

The block returns a string or `{ text }`. It brings its own prompt, tools and resources, so pattern-level `instructions`, `uses`, `tools` and `context` do not reach it.

You can also replace the `judge` with a block that takes `{ question }`, reads the transcript and returns `{ verdict, winner, reasoning }`. A judge always runs. To run without a moderator, leave `moderator` out; `moderator: false` is rejected. The Patterns reference has the override contracts.

## What it won't do

- Pick stances for you. A missing or empty stance, fewer than two debaters, duplicate debater names or `maxRounds` of 0 or less are rejected when the block is built. The [Patterns reference](../../reference/patterns.md) lists every check.
- Guarantee a better answer. Debate adds cost and adversarial pressure, and what you get from that depends on the question.
- Recover from a failed turn. The run fails.
- Let you force a winner or a synthesis through config. Steer the judge with `instructions`, or write your own.

## Where it goes wrong

- **Sycophantic convergence.** Across rounds, models tend to give up positions when pushed. Keep `maxRounds` small. `debate` logs a warning when `maxRounds` is above 4.
- **Identity self-bias.** A judge on the same model as a debater can favour its own side when it sees names. `anonymizeTranscript` hides them from the judge and is on by default.
- **Judge position bias.** A judge can favour the first or last argument it reads. `shuffleForJudge` randomizes the order within each round and is on by default.
- **A weak moderator.** It can repeat the same speakers, miss a plateau or drift off topic. `maxRounds` and `terminateWhen` are the safety net.
- **Token growth.** Every turn re-sends the whole transcript, and cost grows with debaters times rounds, plus the judge, the synthesizer and one moderator call per round.

## See also

- [Round Robin](./round-robin.md) for a synthesized deliverable shaped by panel feedback rather than a winner.
- [Routed Specialists](./routed-specialists.md) for when the next speaker depends on context but the output is not a verdict.
- [Patterns overview](./index.md).
- [Patterns reference](../../reference/patterns.md) for config fields, the output shape, the moderator's validation and the override contracts.
