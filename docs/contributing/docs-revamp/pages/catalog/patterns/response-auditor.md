---
title: Response Auditor
type: catalog
description: Run a finished answer through analyzers that score and annotate it.
---

# Response Auditor

You want to know when an answer is sycophantic, off-policy or plain wrong, without holding it back from the user. The Response Auditor checks a finished answer after the user has it. You give it a list of analyzers, which are blocks that each score the answer from 0 to 1 and attach notes. It returns every analyzer's result, the ones worth showing, and an average score.

Reach for it when you want to add or remove checks without touching the chat flow. It only analyzes. It does not change the response. To rewrite an answer on a bad score, chain a revision step after it.

## Use it after a generator

Attach the auditor with `.sideChain()`, which runs a block in the background while the main pipeline carries on. The answer streams to the user first, and the audit arrives after. A failure inside a side chain does not abort the pipeline.

```ts title="src/flows/support/blocks/audit.ts"
import { responseAuditor } from "@flow-state-dev/patterns/response-auditor";
import { toneCheck } from "./tone-check";

export const audit = responseAuditor({
  analyzers: [toneCheck],
  threshold: 0.3,
  maxConcurrency: 2,
});
```

`toneCheck` is an analyzer, written in the next section. `threshold` (default 0.3) sets the score at which a result is shown. `maxConcurrency` caps how many analyzers run at once, and by default they all run together. Every other option is in the [patterns reference](../../reference/patterns.md).

```ts title="src/flows/support/blocks/reply.ts"
import { generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { audit } from "./audit";

const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6.1-sol",
  prompt: "You are a support agent for Acme.",
  user: (input: { message: string }) => input.message,
  // Stream the answer to the user and keep it in history; the audit runs beside it.
  itemVisibility: { client: true, history: true },
});

const auditReply = sequencer({ name: "audit-reply", inputSchema: z.unknown() })
  .map((answer: unknown, ctx) => ({
    userInput: (ctx.parent?.input as { message: string }).message,
    response: String(answer),
  }))
  .step(audit);

export const reply = sequencer({
  name: "reply",
  inputSchema: z.object({ message: z.string() }),
})
  .step(draftReply)
  .sideChain(auditReply);
```

`auditReply` builds the auditor's input, `{ userInput, response }`, from the user's message and the generator's answer. Both must be strings. It runs inside `reply`, so `ctx.parent.input` is the message `reply` was called with. A function passed straight to `.sideChain()` can't read it that way: it gets `reply`'s own context, and when `reply` is the action's block, `ctx.parent` is undefined.

## What comes back

```ts title="src/flows/support/audit-output.ts"
import type { AnalyzerResult } from "@flow-state-dev/patterns/response-auditor";

export interface AuditorOutput {
  results: AnalyzerResult[]; // one per analyzer that finished
  surfacedResults: AnalyzerResult[]; // the ones to show
  overallScore: number; // average score of results, 0 with none
}
```

A result is in `surfacedResults` when its score is at or above `threshold`, or when the analyzer set `shouldSurface`. If an analyzer throws, say its model call times out, the auditor carries on: that analyzer has no entry in `results`, and only the others count toward `overallScore`. Nothing in the output says which analyzer failed; the failure shows in the DevTool trace. Used with `.step()` instead of `.sideChain()`, the output is the next step's input.

The fields of an analyzer result, and the annotation fields inside it, are in the [patterns reference](../../reference/patterns.md).

## Add your own analyzer

An analyzer is any block that takes `{ userInput, response }` and returns an `AnalyzerResult`.

| Field | Type | Meaning |
| --- | --- | --- |
| `analyzerId` | string | Names the analyzer. Keep it unique: the audit card keys each result by this id, so two results with the same id can render wrongly ([Show the audit](#show-the-audit)). |
| `category` | string | The domain, such as `tone` or `compliance`. |
| `score` | number, 0 to 1 | Higher means more concern. |
| `shouldSurface` | boolean | Shows the result when its score is under the threshold. |
| `annotations` | array | Each has `type`, `label`, `description`, `severity` and optional `evidence`. |
| `supplementary` | object, optional | Extras shown on the audit card ([Show the audit](#show-the-audit)): `summary` and `counterArguments`. |

A model-backed analyzer is a generator that returns a typed object, followed by a handler that turns it into a result. Give the analyzer's outer block `outputSchema: AnalyzerResultSchema`, as `toneCheck` does below. Then a result that doesn't match fails only that analyzer, which is left out like one that throws. Without it, a bad result such as `score: 2`, or an annotation with no `label`, fails the whole auditor when the results are collected. In a side chain, the user's answer arrives regardless.

```ts title="src/flows/support/blocks/tone-check.ts"
import { generator, handler, sequencer } from "@flow-state-dev/core";
import {
  AnalyzerResultSchema,
  auditorInputSchema,
  type AnalyzerResult,
} from "@flow-state-dev/patterns/response-auditor";
import { z } from "zod";

const toneFindingSchema = z.object({
  severity: z.number(),
  issues: z.array(z.string()),
});

const detectTone = generator({
  name: "tone/detect",
  model: "openai/gpt-6-luna",
  inputSchema: auditorInputSchema,
  outputSchema: toneFindingSchema,
  prompt:
    "Rate how condescending, dismissive or unprofessional the reply is, 0 to 1. List each problem.",
  user: (input) => `User: ${input.userInput}\n\nReply: ${input.response}`,
});

const formatTone = handler({
  name: "tone/format",
  inputSchema: toneFindingSchema,
  outputSchema: AnalyzerResultSchema,
  execute: (finding): AnalyzerResult => ({
    analyzerId: "tone-audit",
    category: "tone",
    score: finding.severity,
    shouldSurface: finding.issues.length > 0,
    annotations: finding.issues.map((issue) => ({
      type: "tone",
      label: "Tone issue",
      severity: finding.issues.length > 2 ? "warning" : "info",
      description: issue,
    })),
  }),
});

export const toneCheck = sequencer({
  name: "tone",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
})
  .step(detectTone)
  .step(formatTone);
```

`auditorInputSchema` and `AnalyzerResultSchema` are exported by the auditor's entry point. The generator and the handler share one file here to keep the example short.

Every analyzer that calls a model is one more model call per answer, in the background. With no analyzers, `overallScore` is 0, which can look like a clean bill.

## Use an analyzer someone else wrote

`biasAnalyzer()` from `@thought-fabric/core/metacognition` detects sycophancy and other biases. Its output is not the auditor's `AnalyzerResult`, and it reads `aiResponse` where the auditor sends `response`. Here is an adapter that maps both ways.

```ts title="src/flows/support/blocks/bias-adapter.ts"
import { sequencer } from "@flow-state-dev/core";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";
import { AnalyzerResultSchema, auditorInputSchema } from "@flow-state-dev/patterns/response-auditor";

export const biasAdapter = sequencer({
  name: "bias-adapter",
  inputSchema: auditorInputSchema,
  outputSchema: AnalyzerResultSchema,
})
  .map((input: { userInput: string; response: string }) => ({
    userInput: input.userInput,
    aiResponse: input.response,
  }))
  .step(biasAnalyzer({ model: "openai/gpt-6-luna" }))
  .map((output: Record<string, unknown>) => {
    const annotations = (output.annotations as Array<Record<string, unknown>>) ?? [];
    const score = output.score as number;
    return {
      analyzerId: output.analyzerId as string,
      category: output.category as string,
      score,
      shouldSurface: score >= 0.3,
      annotations: annotations.map((a) => ({
        type: a.biasType as string,
        label: (a.biasType as string).replace(/_/g, " "),
        severity: output.severity as "info" | "warning" | "critical",
        description: a.description as string,
        evidence: a.evidence as string | undefined,
      })),
      supplementary: {
        summary: output.summary,
        counterArguments: output.counterArguments,
      },
    };
  });
```

Each bias audit makes two or three model calls. `biasAnalyzer` skips the counter-argument call when its score is below its own `counterpointThreshold` (default 0.4), which is separate from the auditor's `threshold`. Add `biasAdapter` to `analyzers` beside `toneCheck`.

## Show the audit

When at least one result surfaces, the auditor emits a data item (a structured record on the stream, drawn only by a renderer registered for its name) named `audit-annotation`, with the same `{ results, surfacedResults, overallScore }`. Each audit in a request renders its own card, and a card lists only the surfaced results. Nothing is emitted when nothing surfaces.

`chatAssistantRenderers` from `@flow-state-dev/ui` includes the card, so a chat built on it shows the audit with no extra code. Otherwise run `fsdev ui add audit-annotation` and register it under `renderers.data["audit-annotation"]`. The [UI reference](../../reference/ui-components.md) has the component's details.

The audit belongs to the request that produced it. It is not saved to session, user or org state.

## Change it

The blocks the auditor is built from, `captureContext`, `aggregateResults` and `applyThreshold(n)`, are exported for remixing. The [patterns reference](../../reference/patterns.md) lists them with the rest of the exports.

## Next

- [Parallel Tasks](./parallel-tasks.md): fan-out for independent tasks
- [Supervisor](./supervisor.md): fan-out with a quality review on each result
- [Patterns overview](./index.md): which pattern to use when
- [Patterns reference](../../reference/patterns.md): every option, field and export
