---
sidebar_position: 7
---

# Response Auditor

The Response Auditor is a post-generation quality audit pattern. It takes an AI response and runs it through one or more analyzers that detect problems — bias, hallucination, policy violations, whatever you configure. Each analyzer produces a structured result with a score, annotations, and a surface flag. The auditor collects results, computes an overall score, and filters to only surface findings above a configurable threshold.

Use it when:
- You need to detect and surface quality issues in AI-generated responses
- You want modular, pluggable analysis that can grow over time
- You want structured audit data (not just pass/fail) for downstream decisions

If you need to _rewrite_ the response based on findings, chain the auditor's output into a revision step. The auditor itself only analyzes — it doesn't modify.

## The factory

**Import:** `@flow-state-dev/patterns/response-auditor`

```ts
import { responseAuditor } from "@flow-state-dev/patterns/response-auditor";

const auditor = responseAuditor({
  analyzers: [biasAdapter, toneAnalyzer],
  threshold: 0.3,         // only surface results above this score (default 0.3)
  maxConcurrency: 2,      // parallel analyzer limit (default: all)
});
```

`responseAuditor()` returns a sequencer. Pass it an array of analyzer blocks and a threshold. The factory handles the rest: capturing context, fanning out to analyzers, catching failures, aggregating scores, and filtering results.

## Pipeline internals

```
input { userInput, response }
  → captureContext             (store input in sequencer state)
  → map to array               (one copy per analyzer)
  → forEach(safeAnalyzer)      (run analyzers concurrently, with .rescue() per analyzer)
  → filter nulls               (drop failed analyzers)
  → aggregateResults           (average score across all results)
  → applyThreshold             (split into results + surfacedResults)
```

Each analyzer is wrapped in a mini-sequencer with `.rescue()`, so individual failures don't crash the auditor. Failed analyzers produce `null` and are filtered out before aggregation.

**Output shape:**

```ts
{
  results: AnalyzerResult[],           // all analyzer results
  surfacedResults: AnalyzerResult[],   // filtered: score >= threshold OR shouldSurface
  overallScore: number,                // average of all analyzer scores
}
```

## Basic usage

Wire the auditor as a `.work()` sidechain so the primary response streams unblocked:

```ts
import { defineFlow, sequencer, generator } from "@flow-state-dev/core";
import { responseAuditor } from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";

const chat = generator({
  name: "chat",
  model: "preset/default",
  prompt: "You are a helpful assistant.",
  user: (input) => input.message,
});

const auditor = responseAuditor({
  analyzers: [myAnalyzer],
  threshold: 0.3,
});

const pipeline = sequencer({
  name: "chat-with-audit",
  inputSchema: z.object({ message: z.string() }),
})
  .then(chat)
  .work(
    (chatOutput, ctx) => ({
      userInput: String(ctx.parent?.input?.message ?? ""),
      response: typeof chatOutput === "string" ? chatOutput : JSON.stringify(chatOutput),
    }),
    auditor,
  );
```

The audit runs in the background while the user sees the chat response immediately. Downstream blocks or the client can check the audit result via `getBlockOutput(auditor)`.

## The AnalyzerResult contract

Every analyzer must accept `{ userInput: string, response: string }` and produce output conforming to this schema:

```ts
{
  analyzerId: string,          // unique identifier for the analyzer type
  category: string,            // domain: 'metacognition', 'compliance', 'tone', etc.
  score: number,               // 0-1 composite score
  shouldSurface: boolean,      // force-surface even if below threshold
  annotations: Array<{
    type: string,              // annotation category
    label: string,             // human-readable label
    severity: 'info' | 'warning' | 'critical',
    description: string,       // what was found
    evidence?: string,         // supporting text from the response
  }>,
  supplementary?: Record<string, unknown>,  // domain-specific extras
}
```

The `shouldSurface` flag lets an analyzer force its result into `surfacedResults` regardless of score. The `supplementary` field is a grab bag for domain-specific data that the UI can display (counter-arguments, sycophancy breakdowns, etc.).

## Shipped analyzers

### Bias & sycophancy detection

The `biasAnalyzer()` from `@thought-fabric/core/metacognition` detects agreement bias, cognitive biases, and sycophantic patterns. It outputs the thought-fabric `AnalyzerResult` schema, which is different from the patterns `AnalyzerResult`. You need an adapter to bridge the two.

The kitchen-sink example shows this pattern:

```ts
import { sequencer } from "@flow-state-dev/core";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { responseAuditor, auditorInputSchema } from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";

// Adapter: bridges biasAnalyzer output → patterns AnalyzerResult
const biasAdapter = sequencer({
  name: "bias-adapter",
  inputSchema: z.object({ userInput: z.string(), response: z.string() }),
})
  .map((input: { userInput: string; response: string }) => ({
    userInput: input.userInput,
    aiResponse: input.response,   // biasAnalyzer expects "aiResponse", not "response"
  }))
  .then(biasAnalyzer({ model: "preset/fast" }))
  .map((output: Record<string, unknown>) => {
    const annotations = (output.annotations as Array<Record<string, unknown>>) ?? [];
    const severity = output.severity as string;
    return {
      analyzerId: output.analyzerId as string,
      category: output.category as string,
      score: output.score as number,
      shouldSurface: (output.score as number) >= 0.3,
      annotations: annotations.map((a) => ({
        type: a.biasType as string,
        label: (a.biasType as string).replace(/_/g, " "),
        severity: severity as "info" | "warning" | "critical",
        description: a.description as string,
        evidence: a.evidence as string | undefined,
      })),
      supplementary: {
        summary: output.summary,
        label: output.label,
        sycophancyScore: output.sycophancyScore,
        counterArguments: output.counterArguments,
      },
    };
  });

const auditor = responseAuditor({
  analyzers: [biasAdapter],
  threshold: 0.3,
});
```

The bias analyzer pipeline: `biasDetectAgreement → biasClassify → biasScore → biasCounterpoint → biasFormat`. Three LLM calls (detect, classify, counterpoint) plus two deterministic handlers (score, format). Counter-argument generation is conditional — skipped below threshold.

Six bias types detected: sycophancy, confirmation bias, anchoring bias, authority deference, recency bias, false consensus.

See [Metacognition](/thought-fabric/metacognition) for the full guide.

## Building custom analyzers

Any block that accepts `{ userInput, response }` and returns an `AnalyzerResult` works. The simplest approach: wrap a generator with a formatting handler.

```ts
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { AnalyzerResultSchema, auditorInputSchema } from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";

const detect = generator({
  name: "tone/detect",
  model: "preset/fast",
  inputSchema: auditorInputSchema,
  outputSchema: z.object({
    tone: z.string(),
    confidence: z.number(),
    issues: z.array(z.string()),
  }),
  prompt: "Analyze the tone of the AI response. Flag condescending, dismissive, or unprofessional language.",
  user: (input) => `User: ${input.userInput}\n\nAI: ${input.response}`,
  // No `agentType` — the generator runs silently and returns its typed
  // `block_output` for the format handler to consume.
});

const format = handler({
  name: "tone/format",
  outputSchema: AnalyzerResultSchema,
  execute: (input) => ({
    analyzerId: "tone-audit",
    category: "communication",
    score: 1 - input.confidence,
    shouldSurface: input.issues.length > 0,
    annotations: input.issues.map((issue) => ({
      type: "tone",
      label: "Tone Issue",
      severity: input.issues.length > 2 ? "warning" as const : "info" as const,
      description: issue,
    })),
  }),
});

const toneAnalyzer = sequencer({ name: "tone", inputSchema: auditorInputSchema })
  .then(detect)
  .then(format);
```

Then compose it alongside the bias adapter:

```ts
const auditor = responseAuditor({
  analyzers: [biasAdapter, toneAnalyzer],
  threshold: 0.3,
});
```

## Exports

| Export | Kind | Purpose |
|--------|------|---------|
| `responseAuditor(config)` | factory | Creates the full auditor sequencer |
| `AnalyzerResultSchema` | schema | Zod schema for analyzer output |
| `AuditAnnotationSchema` | schema | Zod schema for individual annotations |
| `auditorInputSchema` | schema | `{ userInput: string, response: string }` |
| `responseAuditorStateSchema` | schema | Internal sequencer state |
| `captureContext` | handler | Stores input in sequencer state |
| `aggregateResults` | handler | Computes average score across results |
| `applyThreshold(n)` | factory | Creates threshold filter handler |

The internal blocks (`captureContext`, `aggregateResults`, `applyThreshold`) are exported for flow authors who want to remix the pipeline with custom steps.

## Composability

The response auditor is a sequencer, so it composes with the other patterns:

```ts
import { responseAuditor } from "@flow-state-dev/patterns/response-auditor";

const auditor = responseAuditor({ analyzers: [biasAdapter, toneAnalyzer] });

// Background sidechain — audit while user sees the response
pipeline.work(auditor);

// Chain audit into a conditional revision
const selfCorrectingChat = sequencer({ name: "self-correct", inputSchema: chatInput })
  .then(chat)
  .work(
    (output, ctx) => ({ userInput: ctx.parent?.input?.message, response: output }),
    auditor,
  )
  .thenIf(
    (_output, ctx) => {
      const audit = ctx.getBlockOutput(auditor);
      return audit?.overallScore >= 0.7;
    },
    revisionGenerator,
  );
```

## See also

- [Metacognition](/thought-fabric/metacognition) — full guide to the bias & sycophancy analyzer
- [Coordinator](./coordinator) — single-pass fan-out for independent tasks
- [Supervisor](./supervisor) — fan-out with quality review loop
- [Patterns Overview](./overview) — when to use which pattern
