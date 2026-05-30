---
sidebar_position: 9
---

# Round Robin

`roundRobin` coordinates a fixed roster of agents that take turns in a deterministic order. After every round, an optional *referee* can audit the round's contributions for argument quality and emit a critique that subsequent rounds incorporate. The loop exits when `maxRounds` is reached or your optional `terminateWhen` predicate returns true. A built-in synthesizer composes the transcript into a final deliverable; pass `synthesizer: false` to skip and return the raw shape.

Use it when the work calls for a known set of perspectives, in a known order, on a shared problem. Editorial review with a writer, a fact-checker, and a copy editor. A committee evaluating a decision. A risk panel critiquing a trade proposal.

It's not the right tool when the next speaker depends on what just happened — that's [Routed Specialists](./routed-specialists). It's also not the right tool when each contribution can be reviewed independently — that's [Supervisor](./supervisor).

## How it works

```
input { goal }
  → initContributions     (clear transcript resource)
  → stampGoal             (goal → outer state)
  → incrementRound        (round++)         ← loopBack target
  → roster[0] → record    (agent contributes; transcript appends)
  → ...
  → roster[N-1] → record
  → referee → stashRefereeCritique          (optional; runs when referee is provided)
  → loopBack(when: round < maxRounds && !terminateWhen(ctx))
  → buildOutput           ({ rounds, contributions, refereeCritiques })
  → synthesizer           (default; opt out with synthesizer: false)
```

Every roster agent runs every round. Every agent sees the full prior transcript — entries from earlier rounds and earlier turns of the same round. Order within a round matches roster declaration order; the same agent never speaks twice in one round.

The transcript is a session-scoped writable resource owned by the pattern. Each turn appends one entry: `{ round, agentName, text }`. A `TaskCollection` mirrors the same data as audit records, one per `(round, agent)` turn, which gives DevTool a structured timeline.

## Basic usage

```ts
import { roundRobin } from "@flow-state-dev/patterns";

const editorial = roundRobin({
  name: "editorial-review",
  roster: [
    { name: "writer", role: "writer responsible for the original draft" },
    { name: "fact-checker", role: "fact-checker verifying every claim" },
    { name: "copy-editor", role: "copy editor polishing prose and clarity" },
  ],
  maxRounds: 3,
});

// Use as a step in a flow:
//   .step(editorial)  // input: { goal: "Review draft X" }
```

The default roster agent is an LLM generator that reads the contributions resource and renders prior turns into its prompt. The default synthesizer composes the final deliverable from the transcript.

## The contributions transcript

A session resource holds the running transcript while the loop executes. Each roster turn appends an entry; the default roster agent reads the same resource to render prior turns into its prompt.

When the loop ends, the pattern produces a `RoundRobinFinalShape`:

```ts
{
  rounds: number;                       // rounds actually executed
  contributions: Array<{
    round: number;
    agentName: string;
    text: string;
  }>;
  refereeCritiques: Array<{             // empty when no referee is configured
    round: number;
    critique: string;
  }>;
}
```

If `synthesizer: false`, this shape is the pattern's output. Otherwise the synthesizer receives it and produces something matched to your `outputSchema`.

## Sharing the contributions resource

By default `roundRobin()` allocates its own internal transcript resource per call. That's fine for a single-instance use; pass `contributions` to opt into an external instance when a post-loop block needs to read the transcript without threading it through `RoundRobinFinalShape.contributions`. Register the same resource on the flow's `resources` map so external consumer blocks can declare it on their own `resources:` slot.

```ts
import {
  createRoundRobinContributions,
  roundRobin,
} from "@flow-state-dev/patterns/round-robin";

const debateContributions = createRoundRobinContributions();

const panel = roundRobin({
  name: "research-panel",
  roster,
  maxRounds: 2,
  contributions: debateContributions,
  // ...
});

// In your flow definition:
defineFlow({
  // ...
  resources: { debateContributions },
});

// Then a downstream block reads it directly:
const consolidate = generator({
  // ...
  resources: { debateContributions },
  user: (_input, ctx) =>
    formatTranscript(ctx.resources.debateContributions.state.entries),
});
```

The pattern's `init-contributions` tap clears the resource at the start of every run, so per-request isolation still holds.

## Customizing roster agents

Most consumers only need the `name` and `role` fields. The default agent will produce a contribution that builds on the prior transcript.

The default agent streams plain text as it generates — no `outputSchema` is set, so the framework's streaming gate fires and `message` items are emitted live. The roster entry's `name` is stamped on the underlying generator as `agentName`, so each emitted item carries identity — chat-style transcripts that scope to a known set of agents render the debate in real time without any extra wiring. The recorder (`record-contribution`) coerces strings via `coerceText`, so the contributions resource ends up with the same `{ round, agentName, text }` entries regardless.

If you need a roster agent to emit structured output instead — e.g. a "vote" roster where each agent emits `{ choice: "A" }` — supply your own `block` via the roster entry. Setting `outputSchema` directly on the default agent isn't a configuration option; it's a different shape of agent and belongs in an override.

For full control, supply a `block`:

```ts
roundRobin({
  name: "trade-debate",
  roster: [
    { name: "aggressive", block: aggressiveAnalyst },
    { name: "conservative", block: conservativeAnalyst },
    { name: "neutral", role: "neutral risk reviewer" },
  ],
  maxRounds: 4,
});
```

An override block can return either a string or `{ text: string }`. Anything else is coerced via `String()` and a one-time warning is emitted. The override can declare its own resources, prompts, and tools — the pattern doesn't inject anything into it.

Pattern-level `instructions`, `uses`, and `context` are forwarded to default blocks only. An override block owns its own configuration.

## The optional referee

The referee is a per-round auditor. After every roster round it reads the contributions and emits a single `{ critique: string }`. The pattern stashes that critique in outer state as `refereeCritiques: Array<{ round, critique }>` and the default roster agents render prior critiques into their user prompts on subsequent rounds, so debaters can respond to the feedback.

The referee never decides whether the loop should continue. Termination is controlled by `maxRounds` and `terminateWhen` — see below.

Use a referee when the roster is anchored to assigned stances (bull vs bear, aggressive vs conservative) and there's a real risk of contributors exaggerating to defend their stance, dismissing strong opposing points, or introducing claims not supported by the data. The default referee prompt is built around those failure modes plus rehashing prior-round arguments — the impasse signal you see when both sides start restating without engaging each other. The referee never redirects the debate or proposes new questions; that boundary is what keeps the role narrow.

A minimal custom referee:

```ts
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const strictReferee = generator({
  name: "strict-referee",
  outputSchema: z.object({ critique: z.string() }),
  // Declare the contributions resource so `ctx.resources.contributions`
  // is populated. Use the same accessor key the pattern is configured
  // with (default `"contributions"`).
  resources: { contributions: panelContributions },
  prompt: [
    "Audit the round for unsupported numeric claims and unhedged predictions.",
    "Return a short critique naming the contributor and quoting the passage.",
  ].join(" "),
  user: (_input, ctx) => {
    const entries = ctx.resources.contributions.state.entries;
    return entries
      .map((e) => `[Round ${e.round}] ${e.agentName}: ${e.text}`)
      .join("\n");
  },
});

roundRobin({
  name: "panel",
  roster: [...],
  contributions: panelContributions,
  maxRounds: 3,
  referee: strictReferee,
});
```

When `referee` is omitted, the entire referee step disappears from the pipeline. There is no default referee.

## Termination

Two knobs:

- **`maxRounds`** is the hard cap on cycling (default 5). Once the round counter reaches it, the loop exits regardless of anything else.
- **`terminateWhen?: (ctx) => boolean`** is an optional runtime predicate evaluated after each round. Returning `true` exits the loop early. The predicate reads from `ctx.sequencer.state` (round counter, accumulated referee critiques) and `ctx.session.state` (consumer-driven termination conditions).

```ts
roundRobin({
  name: "panel",
  roster: [...],
  maxRounds: 5,
  terminateWhen: (ctx) => {
    const session = ctx.session?.state as { maxDebateRounds?: number };
    const state = ctx.sequencer!.state as { round: number };
    return state.round >= (session?.maxDebateRounds ?? 1);
  },
});
```

`terminateWhen` should be a pure, total function. A throwing predicate surfaces as a loop runtime error.

## Synthesizer

The default synthesizer is a generator that composes the transcript into a unified deliverable, reading both the contributions and any referee critiques. Pass `synthesizer: false` to skip the step and return the raw `RoundRobinFinalShape`. Pass your own block to take full control. Setting `outputSchema` while `synthesizer: false` is an error — there's nothing to apply the schema to.

## Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Pattern instance name. Used as the audit collection id by default. |
| `roster` | `RosterEntry[]` | (required) | Ordered list of agents. Names must be unique; at least one required. |
| `maxRounds` | `number` | `5` | Hard cap on round cycling. |
| `terminateWhen` | `(ctx) => boolean` | — | Runtime early-exit predicate. |
| `contributions` | `DefinedResource` | auto-created | Optional shared transcript resource. See [Sharing the contributions resource](#sharing-the-contributions-resource). |
| `referee` | `BlockDefinition` | — | Optional per-round quality auditor. Returns `{ critique }`. Does not control termination. |
| `synthesizer` | `BlockDefinition \| false` | default LLM synthesizer | Terminal step. `false` returns the raw shape. |
| `outputSchema` | `ZodTypeAny` | — | Applied to the synthesizer's output. |
| `instructions` | `string \| (input, ctx) => string` | — | Injected into default blocks only. |
| `model` | `string` | `"intent/chat"` | Default model for built-in generators. |
| `uses` | `UsesSlot` | — | Capabilities forwarded to default blocks. |
| `tools` | `ToolsSlot` | — | Tools forwarded to default blocks. |
| `context` | `GeneratorSlot` | — | Generator context slot forwarded to default blocks. |
| `synthesizerAgentType` | `AgentType` | `"primary"` | Agent type for the default synthesizer. |
| `collectionId` | `string` | `name` | Stable id for the per-run `TaskCollection`. |
| `accessorKey` | `string` | `"contributions"` | Resource accessor key. Set distinct values when multiple round-robins coexist. |

`RosterEntry`:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Stable identifier; appears as `assignee` on audit tasks. |
| `role` | `string` | Role line in the default agent's prompt. Ignored when `block` is set. |
| `block` | `BlockDefinition` | Optional override agent. Must return string or `{ text }`. |

## Exported API

- `roundRobin(config)` — pattern factory.
- `createRoundRobinContributions()` — factory for the canonical session resource.
- `createRosterAgent(opts)` — default roster-agent generator.
- `createReferee(opts)` — default referee generator. (Re-exported as `createRoundRobinReferee` from the package root.)
- `createSynthesize(opts)` — default synthesizer generator. (Re-exported as `createRoundRobinSynthesize`.)
- `createInitContributions(opts)` — init-tap factory. (Re-exported as `createRoundRobinInitContributions`.)
- `createRecordContribution(opts)` — record-tap factory. (Re-exported as `createRoundRobinRecordContribution`.)
- `roundRobinInputSchema`, `roundRobinStateSchema`, `roundRobinContributionEntrySchema`, `roundRobinRefereeOutputSchema`, `roundRobinRefereeCritiqueSchema` — schemas.

## See also

- [Debate](./debate) — runs multiple agents arguing assigned stances with a final judge that always produces a verdict. Debate also accepts an optional `moderator` paralleling Round Robin's optional `referee`, but with broader scope: the moderator picks who speaks next, can inject a new angle to redirect the panel, and can end the debate early. Round Robin's referee audits argument quality without controlling order or termination. Reach for Debate when the desired output is "who won and why" and you may want non-deterministic dispatch; reach for Round Robin when you want fixed-order panel-style turn-taking with a synthesized deliverable.
- [Routed Specialists](./routed-specialists) — for when the next speaker depends on context.
- [Supervisor](./supervisor) — for per-task review with retry, not full-roster turn-taking.
- [Patterns overview](./overview).
