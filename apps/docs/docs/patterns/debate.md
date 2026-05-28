---
sidebar_position: 10
---

# Debate

`debate` coordinates two or more agents arguing assigned positions across rounds. After the rounds end, a single judge reads the full transcript and produces a structured verdict — either picking the strongest stance or synthesizing a position from the strongest points of multiple stances.

An optional `moderator` block can drive turn order across rounds and decide when to end the debate. When configured, the moderator opens every round: it picks who speaks, can supply a briefing, can shift the focus, and can flag the round as the last. Without a moderator, every debater speaks every round in declared order.

Debate is the verdict pattern. If you want a synthesized deliverable shaped by panel feedback rather than a winner, reach for [Round Robin](./round-robin) instead.

## When to use it

- The question has genuine tradeoffs you want surfaced, not collapsed.
- You want a structured `{ verdict, winner, reasoning }` you can route or display, not a free-form essay.
- Adversarial pressure on the answer plausibly improves quality (controversial claims, ambiguous evidence, policy decisions).
- You're comfortable spending more tokens than a single-pass generation.

When NOT to use it: discrete-answer factual lookup, tasks where the right answer is uncontroversial, cost-sensitive flows where one model call is the budget. If you want a deliverable rather than a winner, use Round Robin.

### Debate vs. Round Robin

| | Debate | Round Robin |
|---|---|---|
| Defining output | `{ verdict, winner, reasoning }` | A synthesized deliverable |
| Turn order | Declared order without a moderator; moderator-chosen per round when a moderator is configured | Always declared order |
| Optional auditor | `moderator` — opens each round, picks speakers, can issue a briefing or focus angle, can end the debate | `referee` — audits argument quality, never controls order or termination |
| Tools | Moderator can call tools (search, fetch) and pass findings to debaters via `briefing` | No tool integration at the pattern level |
| Termination | `maxRounds`, moderator `done`, or `terminateWhen` predicate | `maxRounds` or `terminateWhen` predicate |
| Stances | Required per debater | Roles only; no assigned stance |

## How it works

Without a moderator, the pipeline is straightforward:

```
input { question }
  → initTranscript        (clear transcript resource)
  → stampQuestion         (question → outer state)
  → incrementRound        (round++)              ← loopBack target
  → debater[0] → record   (debater argues; transcript appends)
  → ...
  → debater[N-1] → record
  → loopBack(when: round < maxRounds && !terminateWhen)
  → judge                 (reads full transcript, returns verdict)
  → buildOutput           ({ rounds, question, transcript, verdict, moderatorDecisions })
  → synthesizer           (optional)
```

With a moderator, the moderator runs at the top of each round and dispatches only the speakers it picks:

```
input { question }
  → initTranscript
  → stampQuestion
  → incrementRound                              ← loopBack target
  → moderator → stashModeratorDecision         (opens the round: { nextSpeakers, briefing, newAngle, done })
  → forEach(speakersForRound, dispatchByName, maxConcurrency: 1)
        speakersForRound: most recent decision's nextSpeakers (for this round)
  → loopBack(when: round < maxRounds && !done && !terminateWhen)
  → judge
  → buildOutput
  → synthesizer (optional)
```

Each turn's prompt includes the full prior transcript — entries from earlier rounds and entries from earlier-speaking debaters in the current round. Within a round, debaters run sequentially so later speakers can react to earlier ones.

The transcript lives in a session-scoped writable resource owned by the pattern. Each turn appends one entry: `{ round, agentName, stance, text }`. A `TaskCollection` mirrors the same data for DevTool, one task per `(round, debater)` turn.

## Basic usage

Without a moderator (every debater speaks every round):

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
  outputSchema: z.object({
    decision: z.string(),
    rationale: z.string(),
  }),
});
```

With a moderator (non-deterministic dispatch in rounds 2+):

```ts
import {
  debate,
  createDebateTranscript,
  createModerator,
} from "@flow-state-dev/patterns/debate";

const transcript = createDebateTranscript();

const proCon = debate({
  name: "feature-debate",
  transcript,
  debaters: [
    { name: "advocate", stance: "ship now" },
    { name: "skeptic", stance: "do not ship now" },
  ],
  maxRounds: 4,
  moderator: createModerator({
    name: "feature-debate",
    rosterNames: ["advocate", "skeptic"],
    transcript,
  }),
  // terminateWhen: (ctx) => ctx.session.state.budgetExhausted === true,
  outputSchema: z.object({ decision: z.string(), rationale: z.string() }),
});
```

When passing a custom moderator that needs to read the transcript, share the same resource reference via the optional `transcript` config. Without that, `debate()` creates its own internal transcript and the framework's resource-merge rejects the duplicate declaration.

## The moderator

The moderator **opens each round**. It picks the speakers for that round, can supply a briefing and a focus angle that the debaters see, and may flag the round as the last one. Because it runs at the top, every decision drives a real round — there are no orphan decisions before the judge.

```ts
{
  nextSpeakers: string[];   // ordered list of debater names for THIS round
  briefing: string | null;  // optional context for THIS round's debaters
  newAngle: string | null;  // optional focus question for THIS round
  done: boolean;            // true: this round still runs, then loop exits
}
```

A length-1 `nextSpeakers` is a single-speaker round; a longer list is an ordered batch. Earlier speakers' arguments are visible to later speakers within the same round (`.forEach` runs with `maxConcurrency: 1`). When `done: true`, the round still runs — useful for "give one closing round and stop" semantics — and the loop exits afterward.

### Research and tool use

Pass `tools` or `uses` to `createModerator` (or your own custom moderator block) to give the moderator research capabilities. Tool calls stream as ordinary `tool_output` items in the request, and the moderator should summarize what it learned in `briefing` so every debater in the round argues from the same factual base.

```ts
moderator: createModerator({
  name: "feature-debate",
  rosterNames: ["advocate", "skeptic"],
  transcript,
  uses: [webSearchCapability],
})
```

The default moderator's prompt nudges it to use available tools and to fold any findings into `briefing`. Without tools, it falls back to reasoning over the transcript and its own prior decisions.

### What the debaters see

The default debater prompt finds the decision whose `round` matches the current round and renders the `briefing` and `newAngle` for that round. The fields are independent — a briefing without an angle is fine ("here are the facts, debate freely"), and an angle without a briefing is fine ("focus on latency under load"). Both null is fine too.

### Round 1 with a moderator

Round 1 has no transcript yet. The default prompt asks the moderator to open with the full roster (or a balanced subset), use tools to gather facts if available, and fold those into `briefing`. The result is more like a classical debate: the moderator frames the question before the debaters speak rather than the first debater making up its own frame.

### Validation

The default moderator (`createModerator`) is a generator that sees the full, ordered, name-tagged transcript so far plus its own prior decisions. It is NOT subject to the judge's `anonymizeTranscript` toggle — knowing who said what is necessary for dispatch.

Empty `nextSpeakers` with `done: false` is rejected by the output schema — that would cause an empty round and an infinite loop. Names not in the roster throw at dispatch time with the available-names list in the error. Duplicate names in `nextSpeakers` are allowed and produce a turn for each occurrence.

The moderator's decision history is stashed on outer state and surfaced as `moderatorDecisions` on the raw output. With a moderator configured, length equals `rounds`; without a moderator, it's an empty array.

## Termination

A debate exits its loop when any of these become true after a round completes:

- `round >= maxRounds` — hard cap.
- The moderator's last decision had `done: true`.
- `terminateWhen(ctx)` returned true.

The three exit conditions short-circuit in that order. `terminateWhen` is independent of the moderator and works on both the no-moderator and moderated paths. Use it for session-state-driven early exits — e.g. a budget guard, a wall-clock cap, or a flag set by an earlier step. It should be a pure, total function; if it throws, the error propagates.

## Stances

Stances are required input. Debate does not derive positions from the question — that's the caller's job, and stating positions explicitly is part of the pattern's value. You decide what gets argued. With three or more debaters you can run more than two-sided debates: aggressive vs. conservative vs. neutral risk perspectives, three competing interpretations of a piece of evidence, etc.

A debater's prompt includes its assigned stance and instructs it to defend that stance without conceding. The non-concession language is intentional. Debate models tend toward sycophantic convergence — they progressively abandon correct positions across rounds when pushed. Forbidding concession in the default prompt keeps the debate adversarial.

When the moderator injects a `newAngle`, the default debater's prompt for the next round adds a "The moderator has asked the next round to focus on" section. Custom debater blocks that want the same treatment can read `state.moderatorDecisions` directly.

## The transcript

Two views of the same data exist:

- **What debaters see.** A stance-tagged transcript: `[for] ...`, `[against] ...`. Names are not rendered. This contains the natural anchor for rebuttal without leaking debater identity into the rebuttal context.
- **What the judge sees.** Configurable via two toggles, both on by default:
  - `anonymizeTranscript` (default `true`) strips debater names; only stances are rendered. Mitigates identity-driven self-bias when the judge model is the same as a debater model.
  - `shuffleForJudge` (default `true`) randomizes per-round argument order in the judge's prompt. Mitigates LLM-judge position bias toward the first or last argument.

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
  moderatorDecisions: Array<{
    round: number;
    nextSpeakers: string[];
    newAngle: string | null;
    done: boolean;
  }>;
}
```

If `synthesizer: false`, this shape is the pattern's output. Otherwise the synthesizer receives it and produces something matched to your `outputSchema`. `moderatorDecisions` is always present; it's an empty array when no moderator was configured.

## Customizing the debater

Most consumers only need `name`, `stance`, and optionally `role`. The default debater will produce an argument that builds on the prior transcript and defends the assigned stance.

```ts
debate({
  name: "...",
  debaters: [
    { name: "a", stance: "for", block: customReviewer },
    { name: "b", stance: "against" },
  ],
});
```

Override blocks must produce a string or `{ text: string }`; other shapes are coerced via `String()` and a one-time warning is logged.

## Customizing the judge

The judge override receives the same `{ question }` input and reads the transcript resource. It must return `{ verdict: string, winner: string | null, reasoning: string }`. `winner: null` is supported and signals a synthesis verdict where the judge combined points from multiple stances rather than picking one.

## Customizing the moderator

Most consumers should reach for `createModerator` and customize via `instructions`. When the default prompt isn't enough — e.g. you want the moderator to consult an external policy resource, or you have a domain-specific heuristic for round termination — pass a custom block whose output matches `debateModeratorOutputSchema`. Hand-rolled moderators should declare the same `transcript` resource the pattern uses; share the reference via `transcript:` on the `debate()` config.

## Choosing maxRounds

The default is 2 rounds. Three is reasonable when convergence is slow. Anything beyond four is unusual; the factory logs a warning. The cost grows with `agents × rounds`, and the sycophancy failure mode gets worse the longer the debate runs.

## Synthesizer and outputSchema

The default synthesizer is a generator that projects the raw debate shape — including the moderator's framing across rounds, when present — into a structured deliverable. Pass `synthesizer: false` to skip the step and return the raw shape directly. Setting `outputSchema` while `synthesizer: false` is an error — there's nothing to apply the schema to.

## Limitations and known failure modes

- **Sycophantic convergence.** Across rounds, models tend to abandon correct positions when pushed. Mitigation: the default debater prompt forbids concession; the recommended `maxRounds` is small (2–3); the factory warns above 4.
- **Identity-driven self-bias.** When the judge model is the same as a debater model, labeling responses with agent identity creates a self-bias channel. Mitigation: `anonymizeTranscript: true` by default.
- **Judge position bias.** LLM judges favor the first or last argument they see. Mitigation: `shuffleForJudge: true` by default.
- **Moderator hallucination.** A weak moderator can keep asking for the same speakers, ignore obvious plateaus, or propose newAngles that drift off-topic. The `maxRounds` cap and `terminateWhen` are the safety net; consider tightening either if you can't trust the moderator unattended.
- **Token blowup.** Transcript size grows with `agents × rounds`, and the prior transcript is re-sent every turn.

## Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | (required) | Pattern instance name. Used as the audit collection id by default. |
| `debaters` | `DebaterConfig[]` | (required) | Ordered list of debaters. At least 2; names must be unique. |
| `maxRounds` | `number` | `2` | Hard cap on round cycling. Above 4 logs a warning. |
| `judge` | `BlockDefinition` | default LLM judge | Returns `{ verdict, winner, reasoning }`. Cannot be `false`. |
| `synthesizer` | `BlockDefinition \| false` | default LLM synthesizer | Final transformation. `false` returns the raw shape. |
| `moderator` | `BlockDefinition` | — | Optional. Opens each round and picks its speakers; can supply a briefing and angle; can end the loop. Cannot be `false`. |
| `terminateWhen` | `(ctx) => boolean` | — | Optional runtime predicate; return true to exit before `maxRounds`. |
| `transcript` | `DefinedResource` | internal | Optional shared transcript resource. Pass when a custom moderator/judge/synthesizer reads the same resource. |
| `outputSchema` | `ZodTypeAny` | — | Applied to the synthesizer's output. |
| `instructions` | `string \| (input, ctx) => string` | — | Injected into default blocks only. |
| `model` | `string` | `"intent/chat"` | Default model for built-in generators. |
| `uses` | `UsesSlot` | — | Capabilities forwarded to default blocks. |
| `tools` | `ToolsSlot` | — | Tools forwarded to default blocks. |
| `context` | `GeneratorSlot` | — | Generator context slot forwarded to default blocks. |
| `anonymizeTranscript` | `boolean` | `true` | Strip debater names from the judge's view. |
| `shuffleForJudge` | `boolean` | `true` | Shuffle per-round argument order in the judge's prompt. |
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
- `createJudge(opts)` — default judge generator.
- `createModerator(opts)` — default moderator generator.
- `createSynthesize(opts)` — default synthesizer generator.
- `createInitTranscript(opts)`, `createRecordArgument(opts)` — internal init/record taps, exported for advanced consumers.
- `formatTranscriptForJudge(entries, opts)` — pure transcript renderer used by the default judge.
- `debateInputSchema`, `debateStateSchema`, `debateContributionEntrySchema`, `debateVerdictSchema`, `debateTranscriptStateSchema`, `debateModeratorOutputSchema`, `debateModeratorDecisionSchema` — schemas.

## See also

- [Round Robin](./round-robin) — chassis Debate is built on. Round Robin uses an optional per-round referee for argument-quality auditing rather than a verdict-style judge, and its termination is driven by `maxRounds` plus an optional `terminateWhen` predicate. Reach for it when the desired output is a synthesized deliverable shaped by panel feedback, not a winner.
- [Routed Specialists](./routed-specialists) — for when the next speaker depends on context but the output isn't a verdict.
- [Patterns overview](./overview).
