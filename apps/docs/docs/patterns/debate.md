---
sidebar_position: 10
---

# Debate

`debate` coordinates two or more agents arguing assigned positions across a fixed number of rounds. After the final round a single judge reads the full transcript and produces a structured verdict — either picking the strongest stance or synthesizing a position from the strongest points of multiple stances.

Use it when the question has a real tradeoff and you want that tradeoff surfaced rather than averaged away. Fact verification with conflicting evidence. Decisions where two reasonable readings of the data point in different directions. Scalable-oversight setups where the judge is a smaller or cheaper model than the debaters.

It's not the right tool for discrete-answer tasks where independent samples and a majority vote would do, and it's not the right tool when one round of generation is enough. Debate is more expensive than either: token cost grows roughly linearly in `agents × rounds`, and every turn re-sends the prior transcript.

## When to use it

- The question has genuine tradeoffs you want surfaced, not collapsed.
- Adversarial pressure on the answer plausibly improves quality (controversial claims, ambiguous evidence, policy decisions).
- You want a structured `{ verdict, winner, reasoning }` you can route or display, not a free-form essay.
- You're comfortable spending more tokens than a single-pass generation.

When NOT to use it: discrete-answer factual lookup (use a single-pass generator); tasks where the right answer is uncontroversial; cost-sensitive flows where one model call is the budget.

## How it works

```
input { question }
  → initTranscript        (clear transcript resource)
  → stampQuestion         (question → outer state)
  → incrementRound        (round++)            ← loopBack target
  → debater[0] → record   (debater argues; transcript appends)
  → ...
  → debater[N-1] → record
  → loopBack(when: round < maxRounds, maxIterations: maxRounds - 1)
  → judge                 (reads full transcript, returns verdict)
  → buildOutput           ({ rounds, question, transcript, verdict })
  → synthesizer           (optional)
```

Every debater speaks every round, in declared order. Each debater's prompt includes all prior arguments — entries from earlier rounds and entries from earlier-speaking debaters in the current round. Order within a round matches the declared `debaters` array.

The judge is the verdict-producer, not the loop terminator. It runs once, after the loop has exhausted its rounds. This is the structural difference from [Round Robin](./round-robin), which has no verdict-style judge — termination there is driven by `maxRounds` and an optional `terminateWhen` predicate, and an optional per-round referee audits argument quality without picking a winner.

The transcript lives in a session-scoped writable resource owned by the pattern. Each turn appends one entry: `{ round, agentName, stance, text }`. A `TaskCollection` mirrors the same data for DevTool, one task per `(round, debater)` turn.

## Basic usage

```ts
import { debate } from "@flow-state-dev/patterns";
import { z } from "zod";

const proCon = debate({
  name: "feature-debate",
  debaters: [
    { name: "advocate", stance: "ship now" },
    { name: "skeptic", stance: "do not ship now" },
  ],
  maxRounds: 2,
  // synthesizer: false would return the raw shape with the judge's verdict.
  outputSchema: z.object({
    decision: z.string(),
    rationale: z.string(),
  }),
});

// Use as a step in a flow:
//   .then(proCon)  // input: { question: "Should we ship feature X this week?" }
```

The default debater is an LLM generator that reads the transcript resource and renders prior arguments as a stance-tagged list. The default judge reads the full transcript and returns `{ verdict, winner, reasoning }`. The default synthesizer projects the raw shape into your `outputSchema`.

## Stances

Stances are required input. Debate does not derive positions from the question — that's the caller's job, and stating positions explicitly is part of the pattern's value. You decide what gets argued. With three or more debaters you can run more than two-sided debates: aggressive vs. conservative vs. neutral risk perspectives, three competing interpretations of a piece of evidence, etc.

A debater's prompt includes its assigned stance and instructs it to defend that stance without conceding. The non-concession language is intentional. Debate models tend toward sycophantic convergence — they progressively abandon correct positions across rounds when pushed. Forbidding concession in the default prompt keeps the debate adversarial.

## The transcript

Two views of the same data exist:

- **What debaters see.** A stance-tagged transcript: `[for] ...`, `[against] ...`. Names are not rendered. This contains the natural anchor for rebuttal without leaking debater identity into the rebuttal context.
- **What the judge sees.** Configurable via two toggles, both on by default:
  - `anonymizeTranscript` (default `true`) strips debater names; only stances are rendered. Mitigates identity-driven self-bias when the judge model is the same as a debater model. Set to `false` if you want the judge to see who said what.
  - `shuffleForJudge` (default `true`) randomizes per-round argument order in the judge's prompt. Mitigates LLM-judge position bias toward the first or last argument. Tests that need determinism can call the exported `formatDebateTranscriptForJudge` helper directly with an injected RNG, or supply a custom `judge` block.

When the loop ends, the pattern produces a `DebateRawOutput`:

```ts
{
  rounds: number;
  question: string;
  transcript: Array<{
    round: number;
    agentName: string;
    stance: string;
    text: string;
  }>;
  verdict: {
    verdict: string;
    winner: string | null;
    reasoning: string;
  };
}
```

If `synthesizer: false`, this shape is the pattern's output. Otherwise the synthesizer receives it and produces something matched to your `outputSchema`.

## Customizing the debater

Most consumers only need `name`, `stance`, and optionally `role`. The default debater will produce an argument that builds on the prior transcript and defends the assigned stance.

```ts
const reviewer = handler({
  name: "custom-reviewer",
  inputSchema: z.any(),
  outputSchema: z.object({ text: z.string() }),
  execute: () => ({ text: "..." }),
});

debate({
  name: "...",
  debaters: [
    { name: "a", stance: "for", block: reviewer },
    { name: "b", stance: "against" },
  ],
});
```

Override blocks must produce a string or `{ text: string }`; other shapes are coerced via `String()` and a one-time warning is logged.

The "do not concede" language in the default prompt is a guardrail against sycophantic convergence. If you want to relax it — e.g. for a synthesis-friendly debate — supply your own `block` per debater.

## Customizing the judge

The judge override receives the same `{ question }` input and reads the transcript resource. It must return `{ verdict: string, winner: string | null, reasoning: string }`. `winner: null` is supported and signals a synthesis verdict where the judge combined points from multiple stances rather than picking one.

`winner` is free-form. The judge may name a synthesized position rather than echoing one of the configured stances. Consumers wanting strict membership validation can layer their own check downstream.

## Choosing maxRounds

The default is 2 rounds, which matches the empirical baseline used in the debate literature. Three rounds is reasonable when convergence is slow. Anything beyond four is unusual; the factory logs a warning. The cost grows with `agents × rounds`, and the sycophancy failure mode gets worse the longer the debate runs.

## Synthesizer and outputSchema

The default synthesizer is a generator that projects the raw debate shape into a structured deliverable. Pass `synthesizer: false` to skip the step and return the raw shape directly. Pass your own block to take full control. Setting `outputSchema` while `synthesizer: false` is an error — there's nothing to apply the schema to.

## Limitations and known failure modes

Debate is sharper than a single-pass generator when the question has tradeoffs. It is also more failure-prone in specific, predictable ways. The pattern ships mitigations for the well-documented ones; they're listed here so you know what's being mitigated and what's left to you.

- **Sycophantic convergence.** Across rounds, models tend to abandon correct positions when pushed. Mitigation: the default debater prompt forbids concession; the recommended `maxRounds` is small (2–3); the factory warns above 4.
- **Identity-driven self-bias.** When the judge model is the same as a debater model, labeling responses with agent identity creates a self-bias channel. Mitigation: `anonymizeTranscript: true` by default, which strips names from the judge's view. Disable it explicitly if you want the judge to see authorship.
- **Judge position bias.** LLM judges favor the first or last argument they see. Mitigation: `shuffleForJudge: true` by default, randomizing per-round argument order in the judge's prompt.
- **Token blowup.** Transcript size grows in `agents × rounds`, and the prior transcript is re-sent every turn. Mitigation: the default `maxRounds` is small; consider whether your debate could be one round shorter before adding another.

## Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Pattern instance name. Used as the audit collection id by default. |
| `debaters` | `DebaterConfig[]` | (required) | Ordered list of debaters. At least 2; names must be unique. |
| `maxRounds` | `number` | `2` | Hard cap on round cycling. Above 4 logs a warning. |
| `judge` | `BlockDefinition` | default LLM judge | Returns `{ verdict, winner, reasoning }`. Cannot be `false`. |
| `synthesizer` | `BlockDefinition \| false` | default LLM synthesizer | Final transformation. `false` returns the raw shape. |
| `outputSchema` | `ZodTypeAny` | — | Applied to the synthesizer's output. |
| `instructions` | `string \| (input, ctx) => string` | — | Injected into default blocks only. |
| `model` | `string` | `"preset/fast"` | Default model for built-in generators. |
| `uses` | `UsesSlot` | — | Capabilities forwarded to default blocks. |
| `tools` | `ToolsSlot` | — | Tools forwarded to default blocks. |
| `context` | `GeneratorSlot` | — | Generator context slot forwarded to default blocks. |
| `anonymizeTranscript` | `boolean` | `true` | Strip debater names from the judge's view. Mitigates identity-self-bias. |
| `shuffleForJudge` | `boolean` | `true` | Shuffle per-round argument order in the judge's prompt. Mitigates position bias. |
| `judgeAgentType` | `AgentType` | `"primary"` | Agent type for the default judge. |
| `synthesizerAgentType` | `AgentType` | `"primary"` | Agent type for the default synthesizer. |
| `debaterAgentType` | `AgentType` | `"sub"` | Agent type for default debaters. |
| `collectionId` | `string` | `name` | Stable id for the per-run `TaskCollection`. |

`DebaterConfig`:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Stable identifier; appears as `assignee` on audit tasks. |
| `stance` | `string` | Required. The position this debater argues. |
| `role` | `string` | Optional persona description. Ignored when `block` is set. |
| `block` | `BlockDefinition` | Optional override debater. Must return string or `{ text }`. |

## Exported API

- `debate(config)` — pattern factory.
- `createDebateTranscript()` — factory for the canonical session resource.
- `createDebater(opts)` — default debater generator.
- `createDebateJudge(opts)` — default judge generator. (Re-exported as `createJudge` from the subpath.)
- `createDebateSynthesize(opts)` — default synthesizer generator.
- `createDebateInitTranscript(opts)` — init-tap factory.
- `createDebateRecordArgument(opts)` — record-tap factory.
- `formatDebateTranscriptForJudge(entries, opts)` — pure transcript renderer used by the default judge; useful when building a custom judge that wants the same anonymization and shuffling behavior.
- `debateInputSchema`, `debateStateSchema`, `debateContributionEntrySchema`, `debateVerdictSchema`, `debateTranscriptStateSchema` — schemas.

## See also

- [Round Robin](./round-robin) — chassis Debate is built on. Round Robin uses an optional per-round referee for argument-quality auditing rather than a verdict-style judge, and termination is driven by `maxRounds` plus an optional `terminateWhen` predicate. Reach for it when the desired output is a synthesized deliverable shaped by panel feedback, not a winner.
- [Routed Specialists](./routed-specialists) — for when the next speaker depends on context.
- [Patterns overview](./overview).
