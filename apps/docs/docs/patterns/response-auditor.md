---
sidebar_position: 7
---

# Response Auditor

The Response Auditor is a post-generation quality audit pattern. It takes an AI response and runs it through one or more analyzers that detect problems — bias, hallucination, policy violations, whatever you configure. Each analyzer produces a structured result with a score, severity, annotations, and optional suggestions. The auditor collects results and surfaces them as audit metadata alongside the response.

Use it when:
- You need to detect and surface quality issues in AI-generated responses
- You want modular, pluggable analysis that can grow over time
- You want structured audit data (not just pass/fail) for downstream decisions

If you need to _rewrite_ the response based on findings, chain the auditor's output into a revision step. The auditor itself only analyzes — it doesn't modify.

## Block composition

```
response
  → .parallel({ analyzers })    (run all analyzers concurrently)
  → collectResults              (merge analyzer outputs)
  → formatAudit                 (produce unified audit report)
```

Each analyzer is a self-contained block (typically a sequencer) that conforms to the `AnalyzerResult` contract. The auditor fans out to all analyzers in parallel and collects their structured results.

## Basic usage

The first shipped analyzer is the **bias & sycophancy detector** from `@thought-fabric/core/metacognition`. You can wire it into a response auditor today:

```ts
import { sequencer, handler } from "@flow-state-dev/core";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { z } from "zod";

const audit = biasAnalyzer({ model: "preset/fast" });

const chatInput = z.object({ userInput: z.string(), aiResponse: z.string() });

const responseAuditor = sequencer({ name: "response-auditor", inputSchema: chatInput })
  .parallel({
    bias: audit,
    // future: hallucination, policy, tone, ...
  })
  .map((results) => ({
    analyzers: Object.entries(results).map(([key, result]) => ({
      name: key,
      ...result,
    })),
    overallSeverity: results.bias.severity,
    needsRevision: results.bias.score >= 0.7,
  }));
```

Use it in a flow as a background audit step:

```ts
import { defineFlow, sequencer, generator } from "@flow-state-dev/core";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { z } from "zod";

const chat = generator({
  name: "chat",
  model: "preset/default",
  prompt: "You are a helpful assistant.",
  user: (input) => input.message,
});

const audit = biasAnalyzer({ model: "preset/fast" });

const pipeline = sequencer({
  name: "chat-with-audit",
  inputSchema: z.object({ message: z.string() }),
})
  .then(chat)
  .work(
    (chatOutput, ctx) => ({
      userInput: ctx.parent?.input?.message ?? "",
      aiResponse: typeof chatOutput === "string" ? chatOutput : JSON.stringify(chatOutput),
    }),
    audit,
  );
```

The audit runs in the background while the user sees the chat response immediately. Downstream blocks or the client can check the audit result via `getBlockOutput(audit)`.

## The AnalyzerResult contract

Every analyzer must produce output conforming to this schema:

```ts
{
  analyzerId: string,          // unique identifier for the analyzer type
  category: string,            // domain: 'metacognition', 'factuality', 'policy', etc.
  severity: 'info' | 'warning' | 'critical',
  score: number,               // 0-1 composite score
  label: string,               // human-readable score label
  summary: string,             // brief description of findings
  annotations: Array<{
    type: string,
    content: string,
    confidence: number,
    evidence?: string,
  }>,
  suggestions?: string[],
  metadata?: Record<string, unknown>,
}
```

The bias analyzer extends this with `sycophancyScore`, `counterArguments`, and typed `BiasAnnotation` entries. Other analyzers can add their own domain-specific fields while still conforming to the base contract.

## Shipped analyzers

### Bias & sycophancy detection

Detects agreement bias, cognitive biases, and sycophantic patterns. Produces a composite sycophancy score with labeled thresholds, and generates counter-arguments when the score exceeds a configurable threshold.

```ts
import { biasAnalyzer } from "@thought-fabric/core/metacognition";

const bias = biasAnalyzer({
  model: "preset/fast",
  counterpointThreshold: 0.4,
});
```

The pipeline: `biasDetectAgreement → biasClassify → biasScore → biasCounterpoint → biasFormat`. Three LLM calls (detect, classify, counterpoint) plus two deterministic handlers (score, format). Counter-argument generation is conditional — skipped below threshold.

Six bias types detected: sycophancy, confirmation bias, anchoring bias, authority deference, recency bias, false consensus.

See [Metacognition](/thought-fabric/metacognition) for the full guide.

## Building custom analyzers

Any block that produces `AnalyzerResult`-compatible output works as an analyzer. The simplest approach: wrap a generator with a formatting handler.

```ts
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { analyzerResultSchema } from "@thought-fabric/core/metacognition";
import { z } from "zod";

const detectInput = z.object({ userInput: z.string(), aiResponse: z.string() });

const detect = generator({
  name: "tone/detect",
  model: "preset/fast",
  inputSchema: detectInput,
  outputSchema: z.object({
    tone: z.string(),
    confidence: z.number(),
    issues: z.array(z.string()),
  }),
  prompt: "Analyze the tone of the AI response. Flag condescending, dismissive, or unprofessional language.",
  user: (input) => `User: ${input.userInput}\n\nAI: ${input.aiResponse}`,
  emit: { messages: false, reasoning: false, toolCalls: false },
});

const format = handler({
  name: "tone/format",
  outputSchema: analyzerResultSchema,
  execute: (input) => ({
    analyzerId: "tone-audit",
    category: "communication",
    severity: input.issues.length > 2 ? "warning" : "info",
    score: 1 - input.confidence,
    label: input.tone,
    summary: input.issues.length
      ? `Tone issues: ${input.issues.join(", ")}`
      : "Tone is appropriate.",
    annotations: input.issues.map((issue) => ({
      type: "tone",
      content: issue,
      confidence: input.confidence,
    })),
  }),
});

const toneAnalyzer = sequencer({ name: "tone", inputSchema: detectInput })
  .then(detect)
  .then(format);
```

Then compose it alongside the bias analyzer:

```ts
const auditor = sequencer({ name: "full-audit", inputSchema: detectInput })
  .parallel({
    bias: biasAnalyzer({ model: "preset/fast" }),
    tone: toneAnalyzer,
  });
```

## Composability

The response auditor is a sequencer, so it composes with the other patterns:

```ts
// Audit inside a supervisor's review step
const reviewedPipeline = supervisor({
  name: "reviewed-chat",
  worker: chatWorker,
  reviewer: responseAuditor,  // use audit results as review input
});

// Chain audit into a revision loop
const selfCorrectingChat = sequencer({ name: "self-correct", inputSchema: chatInput })
  .then(chat)
  .then(audit)
  .thenIf(
    (result) => result.bias.score >= 0.7,
    revisionGenerator,
  );
```

## See also

- [Metacognition](/thought-fabric/metacognition) — full guide to the bias & sycophancy analyzer
- [Coordinator](./coordinator) — single-pass fan-out for independent tasks
- [Supervisor](./supervisor) — fan-out with quality review loop
- [Patterns Overview](./overview) — when to use which pattern
