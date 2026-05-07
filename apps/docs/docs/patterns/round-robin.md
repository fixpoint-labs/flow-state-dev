---
sidebar_position: 9
---

# Round Robin

`roundRobin` coordinates a fixed roster of agents that take turns in a deterministic order. After every full round a judge inspects the transcript and decides whether another round will help; the loop exits the moment the judge says it's done, or when the round cap is reached.

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
  → judge                 (returns { done, summary })
  → stashJudgeVerdict     (verdict → outer state)
  → loopBack(when: !done, maxIterations: maxRounds - 1)
  → buildOutput           ({ rounds, done, summary, contributions })
  → synthesizer           (optional)
```

Every roster agent runs every round. Every agent sees the full prior transcript — entries from earlier rounds and earlier turns of the same round. Order within a round matches roster declaration order; the same agent never speaks twice in one round.

The loop terminator is the judge, not the roster. The judge returns `{ done, summary }`. When `done` is `true`, the loop exits; the summary lands on the outer state. `maxRounds` (default 5) is a hard cap — if the judge never signals done, the loop exits anyway with `done: false`.

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
//   .then(editorial)  // input: { goal: "Review draft X" }
```

The default roster agent is an LLM generator that reads the contributions resource and renders prior turns into its prompt. The default judge is another generator that decides when the panel has converged. The default synthesizer composes the final deliverable from the transcript.

## The contributions transcript

A session resource holds the running transcript while the loop executes. Each roster turn appends an entry; the default agent and default judge read the same resource to render prior turns into their prompts.

When the loop ends, the pattern produces a `RoundRobinFinalShape`:

```ts
{
  rounds: number;                       // rounds actually executed
  done: boolean;                        // last judge verdict
  summary: string;                      // last judge summary
  contributions: Array<{
    round: number;
    agentName: string;
    text: string;
  }>;
}
```

If `synthesizer: false`, this shape is the pattern's output. Otherwise the synthesizer receives it and produces something matched to your `outputSchema`.

## Customizing roster agents

Most consumers only need the `name` and `role` fields. The default agent will produce a contribution that builds on the prior transcript.

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

## Customizing the judge

```ts
const strictJudge = generator({
  name: "strict-judge",
  outputSchema: z.object({ done: z.boolean(), summary: z.string() }),
  prompt: "Only return done=true when every agent has converged on the same recommendation.",
  // ...
});

roundRobin({
  name: "strict-panel",
  roster: [...],
  judge: strictJudge,
});
```

The judge must return `{ done, summary }`. The pattern always runs the judge after every round — there is no judge-less mode. If you want fixed-rounds-only behavior, use a stub judge that always returns `{ done: false }` and rely on `maxRounds`.

## Synthesizer

The default synthesizer is a generator that composes the transcript into a unified deliverable. Pass `synthesizer: false` to skip the step and return the raw `RoundRobinFinalShape`. Pass your own block to take full control. Setting `outputSchema` while `synthesizer: false` is an error — there's nothing to apply the schema to.

## Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Pattern instance name. Used as the audit collection id by default. |
| `roster` | `RosterEntry[]` | (required) | Ordered list of agents. Names must be unique; at least one required. |
| `maxRounds` | `number` | `5` | Hard cap on round cycling. |
| `judge` | `BlockDefinition` | default LLM judge | Returns `{ done, summary }` after every round. |
| `synthesizer` | `BlockDefinition \| false` | default LLM synthesizer | Final transformation step. `false` returns the raw shape. |
| `outputSchema` | `ZodTypeAny` | — | Applied to the synthesizer's output. |
| `instructions` | `string \| (input, ctx) => string` | — | Injected into default blocks only. |
| `model` | `string` | `"preset/fast"` | Default model for built-in generators. |
| `uses` | `UsesSlot` | — | Capabilities forwarded to default blocks. |
| `tools` | `ToolsSlot` | — | Tools forwarded to default blocks. |
| `context` | `GeneratorSlot` | — | Generator context slot forwarded to default blocks. |
| `judgeAgentType` | `AgentType` | `"sub"` | Agent type for the default judge. |
| `synthesizerAgentType` | `AgentType` | `"primary"` | Agent type for the default synthesizer. |
| `collectionId` | `string` | `name` | Stable id for the per-run `TaskCollection`. |

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
- `createRoundRobinJudge(opts)` — default judge generator. (Re-exported as `createJudge` from the subpath.)
- `createRoundRobinSynthesize(opts)` — default synthesizer generator.
- `createRoundRobinInitContributions(opts)` — init-tap factory.
- `createRoundRobinRecordContribution(opts)` — record-tap factory.
- `roundRobinInputSchema`, `roundRobinStateSchema`, `roundRobinContributionEntrySchema`, `roundRobinJudgeOutputSchema` — schemas.

## See also

- [Debate](./debate) — same chassis, but the judge runs once at the end with a verdict instead of per-round as a terminator. Use it when you want adversarial argumentation across assigned positions rather than collaborative turn-taking.
- [Routed Specialists](./routed-specialists) — for when the next speaker depends on context.
- [Supervisor](./supervisor) — for per-task review with retry, not full-roster turn-taking.
- [Patterns overview](./overview).
