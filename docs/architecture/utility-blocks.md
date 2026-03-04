# Utility Blocks

Utility blocks are pre-built factories that wrap the core block primitives (generator, handler) into specialized, high-level capabilities. Each utility returns a standard `BlockDefinition` — composable in sequencers, routers, and flows like any other block.

## The idea in 30 seconds

```ts
import { utility, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = utility.summarizer({
  name: "brief-summary",
  granularity: "brief",
});

const analyze = utility.analyzer({
  name: "quality-check",
  criteria: ["accuracy", "completeness"],
});

const pipeline = sequencer({
  name: "review-pipeline",
  inputSchema: z.object({ document: z.string() }),
})
  .map((input) => input.document)
  .then(summarize)
  .then(analyze);
```

Every utility factory accepts a `name` (required) and returns a block that can be chained via `.then()`, composed in `.parallel()`, or used as a router route. Generator-based utilities accept an optional `model` (defaults to `"gpt-5-mini"`) and an optional `outputSchema` to override the default output shape.

## Utility catalog

| Utility | Kind | Category | Purpose |
|-------|------|----------|---------|
| `contextReducer` | generator | Context & Memory | Reduce context via distill, denoise, or compress strategies |
| `memoryExtractor` | generator | Context & Memory | Extract durable memory candidates from interactions |
| `decomposer` | generator | Planning & Decomposition | Break broad requests into executable subtasks |
| `composer` | generator | Planning & Decomposition | Assemble coherent output from structured parts |
| `summarizer` | generator | Synthesis & Output | Summarize input at configurable granularity levels |
| `combiner` | handler | Synthesis & Output | Deterministically merge artifacts (no LLM) |
| `synthesizer` | generator | Synthesis & Output | Reconcile multiple inputs into one coherent artifact |
| `analyzer` | generator | Evaluation | Evaluate artifacts against structured criteria |
| `intentClassifier` | generator | Routing | Classify input into a bounded category set for downstream routing |
| `intentRouter` | sequencer | Routing | Pre-wired classifier + router for classification-driven branching |

---

## Context & Memory

### `contextReducer`

Reduces context using one of three strategies. Each mode selects a tailored system prompt and a mode-specific default output schema.

```ts
const reduce = utility.contextReducer({
  name: "compress-history",
  mode: "compress",
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `mode` | `"distill" \| "denoise" \| "compress"` | `"distill"` | Reduction strategy |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `outputSchema` | `ZodTypeAny` | mode-specific | Override the default output schema |

**Modes and default output schemas:**

**`distill`** — Extract highest-signal ideas; prioritize meaning over wording fidelity.

```ts
// Default output: contextReducerDistillOutputSchema
{
  distilled: string;
  keyPoints: string[];
}
```

**`denoise`** — Remove irrelevant or repetitive content while preserving intent and structure.

```ts
// Default output: contextReducerDenoiseOutputSchema
{
  cleaned: string;
  removedCategories?: string[];
}
```

**`compress`** — Reduce source to fit strict token or length budgets with controlled lossiness.

```ts
// Default output: contextReducerCompressOutputSchema
{
  compressed: string;
  compressionRatio?: number;
  dropped?: string[];
}
```

**When to reach for each mode:**

- Use **distill** when you need the core ideas from a long context and original wording doesn't matter.
- Use **denoise** when the source has good structure but contains noise (repetition, tangents, filler).
- Use **compress** when you have a hard token budget and need lossy reduction with visibility into what was dropped.

**Usage in a sequencer:**

```ts
const pipeline = sequencer({
  name: "context-pipeline",
  inputSchema: z.object({ source: z.string() }),
})
  .map((input) => input.source)
  .then(utility.contextReducer({ name: "distill", mode: "distill" }));
```

---

### `memoryExtractor`

Extracts durable memory candidates from user and assistant interactions. The extraction is stateless — the block identifies candidates but does not perform persistence. Downstream blocks or flow actions handle storage (e.g., writing to session resources).

```ts
const extract = utility.memoryExtractor({
  name: "extract-memories",
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `outputSchema` | `ZodTypeAny` | `memoryExtractorOutputSchema` | Override the default output schema |

**Default output schema:**

```ts
// memoryExtractorOutputSchema
{
  memories: MemoryCandidate[];
}
```

See [MemoryCandidate](#memorycandidate) in the shared types reference below.

**Memory types:** `"fact"`, `"preference"`, `"constraint"`, `"decision"`

- **fact** — Stable factual information ("User is based in Berlin")
- **preference** — User preferences ("Prefers concise answers")
- **constraint** — Limitations or restrictions ("Cannot use Docker")
- **decision** — Committed decisions ("Ship on Friday")

**Integration pattern — flowing candidates into session resources:**

```ts
const extract = utility.memoryExtractor({ name: "extract" });

const pipeline = sequencer({
  name: "memory-pipeline",
  inputSchema: z.object({ transcript: z.string() }),
})
  .map((input) => input.transcript)
  .then(extract)
  .tap(async (output, ctx) => {
    // Write extracted memories to session resources
    for (const memory of output.memories) {
      await ctx.session?.pushState("memories", memory);
    }
  });
```

---

## Planning & Decomposition

### `decomposer`

Breaks broad requests into executable subtasks with optional dependency references and priority levels.

```ts
const decompose = utility.decomposer({
  name: "break-down-request",
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `outputSchema` | `ZodTypeAny` | `decomposerOutputSchema` | Override the default output schema |

**Default output schema:**

```ts
// decomposerOutputSchema
{
  tasks: SubTask[];
}
```

See [SubTask](#subtask) in the shared types reference below.

**Using the dependency graph in a sequencer:**

The `deps` array on each task references other task IDs, expressing execution ordering constraints. Use this output to drive parallel or sequential execution downstream:

```ts
const decompose = utility.decomposer({ name: "plan" });

const pipeline = sequencer({
  name: "task-pipeline",
  inputSchema: z.object({ request: z.string() }),
})
  .map((input) => input.request)
  .then(decompose);

// Downstream logic can read tasks[].deps to schedule
// independent tasks in parallel and dependent tasks sequentially.
```

**Custom output schema with owner assignment:**

```ts
const decompose = utility.decomposer({
  name: "assigned-tasks",
  outputSchema: z.object({
    tasks: z.array(z.object({
      id: z.string(),
      goal: z.string(),
      owner: z.string(),
    })),
  }),
});
```

---

### `composer`

Assembles a coherent artifact from structured parts. Use composer when you have separate pieces that need to be joined into a unified document while respecting ordering and structural constraints.

**How it differs from `synthesizer`:** Composer rebuilds from discrete parts (sections, fragments, chunks). Synthesizer reconciles overlap and conflict across independent inputs that may cover the same ground.

```ts
const compose = utility.composer({
  name: "assemble-report",
  objectives: ["Preserve chronology", "Keep section headings"],
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `objectives` | `string \| string[]` | — | Focus areas for composition |
| `outputSchema` | `ZodTypeAny` | `composerOutputSchema` | Override the default output schema |

**Default output schema:**

```ts
// composerOutputSchema
{
  composed: string;
  structure?: string[];  // ordered list of assembled sections
}
```

**Usage in a sequencer:**

```ts
const compose = utility.composer({ name: "build-doc" });

const pipeline = sequencer({
  name: "composition-pipeline",
  inputSchema: z.object({ parts: z.array(z.string()) }),
})
  .map((input) => ({ parts: input.parts }))
  .then(compose);
```

---

## Synthesis & Output

### `summarizer`

Summarizes input at one of three granularity levels. Optionally accepts objectives to focus the summary on specific concerns.

```ts
const summarize = utility.summarizer({
  name: "exec-summary",
  granularity: "executive",
  objectives: ["Highlight risks", "Capture decisions"],
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `granularity` | `"brief" \| "detailed" \| "executive"` | `"brief"` | Summary depth |
| `objectives` | `string \| string[]` | — | Focus areas for the summary |
| `outputSchema` | `ZodTypeAny` | `summarizerOutputSchema` | Override the default output schema |

**Granularity levels:**

| Level | Behavior |
|-------|----------|
| `brief` | Concise 1-2 sentence summary capturing only the core takeaway |
| `detailed` | Paragraph-level summary preserving important context and nuance |
| `executive` | Key decisions and actionable recommendations |

**Default output schema:**

```ts
// summarizerOutputSchema
{
  summary: string;
  keyPoints?: string[];
}
```

**Output schema override:**

```ts
const summarize = utility.summarizer({
  name: "scored-summary",
  outputSchema: z.object({
    summary: z.string(),
    confidence: z.number(),
  }),
});
```

---

### `combiner`

Deterministically merges multiple artifacts using structural rules. Uses a **handler** block — no LLM call is involved. Merge behavior is fully predictable.

```ts
const combine = utility.combiner({
  name: "merge-results",
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `outputSchema` | `ZodTypeAny` | `combinerOutputSchema` | Override the default output schema |

No `model` parameter — combiner runs pure logic.

**Input:** An array of artifacts, or an object with `{ artifacts: unknown[] }`.

**Default output schema:**

```ts
// combinerOutputSchema
{
  combined: unknown;
  mergeNotes?: string[];
}
```

**Merge rules:**

| Input shape | Strategy |
|-------------|----------|
| All arrays | Concatenate and deduplicate by value |
| All objects | Deep-merge keys; conflicting scalars resolved by taking the later artifact |
| Mixed types | Preserve order and deduplicate exact matches |

**Deterministic behavior guarantees:**
- Deduplication uses stable serialization (sorted object keys, canonical format) — not reference equality.
- Merge notes document every resolution decision (deduplication, conflict resolution, normalization).
- Empty input returns `{ combined: [], mergeNotes: ["No artifacts provided; returned an empty combined array."] }`.

**When to prefer combiner over synthesizer:**
Use combiner when you need deterministic, auditable merging without LLM interpretation. Use synthesizer when inputs have semantic overlap or conflict that requires interpretive reasoning.

**Usage in a sequencer:**

```ts
const pipeline = sequencer({
  name: "merge-pipeline",
  inputSchema: z.object({
    primary: z.object({ tags: z.array(z.string()) }),
    secondary: z.object({ tags: z.array(z.string()) }),
  }),
})
  .map((input) => [input.primary, input.secondary])
  .then(utility.combiner({ name: "merge" }));
```

---

### `synthesizer`

Reconciles multiple intermediate artifacts into one coherent, non-redundant output. When inputs overlap, the synthesizer deduplicates while preserving the strongest signal. When inputs conflict, it explicitly resolves disagreements through interpretive reasoning rather than ignoring them.

**How it differs from `combiner`:** Combiner performs deterministic structural merging. Synthesizer uses an LLM to reconcile semantic overlap and conflict across independent inputs.

```ts
const synthesize = utility.synthesizer({
  name: "reconcile-sources",
  objectives: ["Prefer sources with direct evidence"],
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `objectives` | `string \| string[]` | — | Priorities for synthesis decisions |
| `outputSchema` | `ZodTypeAny` | `synthesizerOutputSchema` | Override the default output schema |

**Default output schema:**

```ts
// synthesizerOutputSchema
{
  synthesis: string;
  rationale: string[];  // explanation of synthesis decisions
}
```

**Multi-input pattern:**

```ts
const synthesize = utility.synthesizer({ name: "unify" });

const pipeline = sequencer({
  name: "synthesis-chain",
  inputSchema: z.object({ artifacts: z.array(z.string()) }),
})
  .map((input) => input.artifacts)
  .then(synthesize);
```

---

## Evaluation

### `analyzer`

Evaluates an artifact against structured criteria and returns findings with severity levels. Use analyzer output to drive downstream routing decisions (e.g., proceed vs. review).

```ts
const analyze = utility.analyzer({
  name: "security-review",
  criteria: ["authentication", "authorization", "data-leak-prevention"],
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `criteria` | `string[]` | `["quality", "risk", "coverage", "confidence"]` | Evaluation criteria |
| `outputSchema` | `ZodTypeAny` | `analyzerOutputSchema` | Override the default output schema |

**Default criteria:** `quality`, `risk`, `coverage`, `confidence`

**Default output schema:**

```ts
// analyzerOutputSchema
{
  findings: Finding[];
  score?: number;
  recommendation?: string;
}
```

See [Finding](#finding) in the shared types reference below.

**Wiring analyzer output into routing decisions:**

```ts
import { handler, utility, router, sequencer } from "@flow-state-dev/core";

const analyze = utility.analyzer({ name: "risk-check", criteria: ["risk"] });
const proceed = handler({ name: "proceed", execute: () => ({ path: "proceed" }) });
const review = handler({ name: "review", execute: () => ({ path: "review" }) });

const route = router({
  name: "risk-router",
  routes: [proceed, review],
  execute: (input) => {
    const hasCritical = input.findings.some((f) => f.severity === "critical");
    return hasCritical ? review : proceed;
  },
});

const pipeline = sequencer({
  name: "analysis-pipeline",
  inputSchema: z.object({ artifact: z.string() }),
})
  .map((input) => input.artifact)
  .then(analyze)
  .then(route);
```

---

## Routing

### `intentClassifier`

Classifies input into exactly one category from a bounded set. Each category is declared as a key–description pair — the descriptions are injected into the LLM prompt so the model understands the semantics of each category, not just the label. The output includes a `confidence` score and optional `reasoning`.

The output schema enforces category validation: if the model returns a category not in the declared set, a Zod refinement error is thrown. This makes it safe to wire directly into a router without defensive checks.

```ts
const classify = utility.intentClassifier({
  name: "support-triage",
  categories: {
    billing: "Questions about invoices, charges, or subscription payments.",
    "technical-support": "Requests about bugs, outages, or broken product behavior.",
    "general-inquiry": "General product questions and feature clarifications.",
  },
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `categories` | `Record<string, string>` | — | Category name → description map (minimum 2 categories, required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier |
| `outputSchema` | `ZodTypeAny` | auto-generated | Override the default output schema |

**Default output schema:**

```ts
// IntentClassifierOutput
{
  category: string;    // one of the declared category keys
  confidence: number;  // 0–1
  reasoning?: string;  // why this category was chosen
}
```

The default schema includes a `superRefine` validator that rejects any `category` value not in the declared keys. Custom output schemas also receive this validation automatically.

**Wiring into a router for intent-based dispatch:**

```ts
import { handler, utility, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const classify = utility.intentClassifier({
  name: "classify-intent",
  categories: {
    billing: "Invoice, payment, or subscription issues.",
    support: "Bugs, outages, or technical problems.",
    sales: "Pricing, plans, or purchase inquiries.",
  },
});

const billingHandler = handler({ name: "billing", execute: (input) => ({ team: "billing", input }) });
const supportHandler = handler({ name: "support", execute: (input) => ({ team: "support", input }) });
const salesHandler = handler({ name: "sales", execute: (input) => ({ team: "sales", input }) });

const intentRouter = router({
  name: "intent-router",
  routes: [billingHandler, supportHandler, salesHandler],
  execute: (input) => {
    switch (input.category) {
      case "billing": return billingHandler;
      case "support": return supportHandler;
      case "sales": return salesHandler;
      default: return supportHandler;
    }
  },
});

const pipeline = sequencer({
  name: "triage-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .map((input) => input.message)
  .then(classify)
  .then(intentRouter);
```

For most use cases, prefer `intentRouter` (below) which eliminates this boilerplate entirely.

---

### `intentRouter`

A sequencer-level convenience that combines `intentClassifier` + `router` into a single declaration. The caller declares categories with descriptions and a branch handler per category — the utility compiles this into a sequencer that runs the classifier then routes to the matching branch.

This is the idiomatic pattern for classification-driven branching. Use `intentClassifier` directly only when you need to inspect or transform the classification result mid-flow.

```ts
const triage = utility.intentRouter({
  name: "support-triage",
  categories: {
    billing: {
      description: "Questions or disputes about invoices, payments, or subscriptions.",
      handler: billingHandler,
    },
    "technical-support": {
      description: "Requests for help with product errors, bugs, or unexpected behavior.",
      handler: techSupportSequencer,
    },
    "general-inquiry": {
      description: "General questions about features, availability, or how the product works.",
      handler: generalHandler,
    },
  },
  fallback: unknownHandler,
  confidenceThreshold: 0.7,
});
```

**Config:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Block name (required) |
| `categories` | `Record<string, { description: string; handler: BlockDefinition }>` | — | Category name → description + handler map (minimum 2, required) |
| `model` | `string` | `"gpt-5-mini"` | Model identifier for the internal classifier |
| `fallback` | `BlockDefinition` | — | Block to execute for low-confidence or unmatched results |
| `confidenceThreshold` | `number` (0–1) | — | Below this confidence, route to fallback |

**Returns:** A `sequencer` block definition.

**Compilation target:**

The utility compiles to a sequencer containing:
1. An internal `intentClassifier` generator — receives category keys and descriptions extracted from the config
2. A `router` — reads the classifier output and dispatches to the matching branch handler

The caller never manually constructs either primitive.

**Behavior:**
- Descriptions are extracted from each category entry and passed to the internal `intentClassifier` to guide classification
- Handlers are extracted and registered as router routes
- When `confidenceThreshold` is set, results below the threshold route to `fallback`
- When `fallback` is omitted and confidence falls below threshold, an error is thrown with a descriptive message
- All branch handlers accept any valid block definition (handler, generator, sequencer, router)

**Usage in a sequencer:**

```ts
const pipeline = sequencer({
  name: "support-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .map((input) => input.message)
  .then(triage);
```

**Comparison with manual `intentClassifier` + `router`:**

| Approach | When to use |
|----------|-------------|
| `intentRouter` | Standard classification → dispatch; no need to inspect classification mid-flow |
| `intentClassifier` + `router` | Need to transform, log, or branch on the classification result before routing |

---

## Shared Types Reference

### `Finding`

Represents a single evaluation finding produced by the analyzer.

```ts
// analyzerFindingSchema
{
  criterion: string;     // which criterion was evaluated
  assessment: string;    // evaluation result description
  severity?: "critical" | "warning" | "info";  // priority level
  evidence?: string;     // supporting evidence
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `criterion` | `string` | yes | The criterion that was evaluated |
| `assessment` | `string` | yes | The evaluation result |
| `severity` | `"critical" \| "warning" \| "info"` | no | Priority level for the finding |
| `evidence` | `string` | no | Concise supporting evidence |

### `MemoryCandidate`

Represents a durable memory candidate extracted by the memoryExtractor.

```ts
// memoryCandidateSchema
{
  type: "fact" | "preference" | "constraint" | "decision";
  content: string;
  confidence?: number;  // 0–1
  source?: string;
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"fact" \| "preference" \| "constraint" \| "decision"` | yes | Classification of the memory |
| `content` | `string` | yes | The extracted memory content |
| `confidence` | `number` (0–1) | no | Extraction confidence score |
| `source` | `string` | no | Origin of the memory for audit trail |

### `SubTask`

Represents an executable subtask produced by the decomposer.

```ts
// decomposerTaskSchema
{
  id: string;
  goal: string;
  deps?: string[];
  priority?: "high" | "medium" | "low";
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | yes | Stable unique identifier for the task |
| `goal` | `string` | yes | Clear description of what the task accomplishes |
| `deps` | `string[]` | no | IDs of tasks this task depends on |
| `priority` | `"high" \| "medium" \| "low"` | no | Execution priority hint |

---

## End-to-end Flow Examples

### Example A — Research pipeline

A research pipeline that decomposes a broad question into subtasks, summarizes each one in parallel, analyzes the combined summaries for quality, then synthesizes a final answer.

```ts
import { z } from "zod";
import { handler, utility, sequencer } from "@flow-state-dev/core";

// Step 1: Break down the research question
const decompose = utility.decomposer({ name: "plan-research" });

// Step 2: Summarize each subtask result
const summarize = utility.summarizer({
  name: "summarize-finding",
  granularity: "detailed",
});

// Step 3: Analyze the combined summaries
const analyze = utility.analyzer({
  name: "quality-gate",
  criteria: ["coverage", "accuracy", "confidence"],
});

// Step 4: Synthesize into a final answer
const synthesize = utility.synthesizer({
  name: "final-synthesis",
  objectives: ["Produce a coherent narrative", "Cite evidence for claims"],
});

// Wire the pipeline
const research = sequencer({
  name: "research-pipeline",
  inputSchema: z.object({ question: z.string() }),
})
  // Decompose the question into subtasks
  .map((input) => input.question)
  .then(decompose)

  // Summarize each subtask in parallel
  .map((output) => output.tasks.map((task) => task.goal))
  .forEach(summarize)

  // Analyze the collected summaries
  .then(analyze)

  // Synthesize into a unified answer
  .map((analysis) => ({
    findings: analysis.findings,
    recommendation: analysis.recommendation,
  }))
  .then(synthesize);
```

**Data flow:** `question` → `decomposer` → `[subtasks]` → `forEach(summarizer)` → `analyzer` → `synthesizer` → final output

---

### Example B — Conversation memory

A memory pipeline that extracts durable memories from a conversation transcript and compresses the context for efficient storage.

```ts
import { z } from "zod";
import { utility, sequencer } from "@flow-state-dev/core";

// Step 1: Extract memory candidates
const extract = utility.memoryExtractor({ name: "extract-memories" });

// Step 2: Compress the context for storage
const compress = utility.contextReducer({
  name: "compress-context",
  mode: "compress",
});

// Wire the pipeline
const memoryPipeline = sequencer({
  name: "memory-pipeline",
  inputSchema: z.object({ transcript: z.string() }),
})
  .map((input) => input.transcript)

  // Extract memories and compress in parallel
  .parallel(extract, compress)

  // Write results to session resources
  .tap(async (results, ctx) => {
    const [extracted, compressed] = results;

    // Persist extracted memories
    for (const memory of extracted.memories) {
      await ctx.session?.pushState("memories", memory);
    }

    // Store compressed context
    await ctx.session?.setState("compressedContext", compressed.compressed);
  });
```

**Data flow:** `transcript` → `parallel(memoryExtractor, contextReducer)` → `tap(write to session)` → done

### `IntentClassifierOutput`

Represents the classification result produced by the intentClassifier.

```ts
// IntentClassifierOutput
{
  category: string;    // one of the declared category keys
  confidence: number;  // 0–1
  reasoning?: string;  // explanation of the classification decision
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | `string` | yes | The selected category (validated against declared keys) |
| `confidence` | `number` (0–1) | yes | Classification confidence score |
| `reasoning` | `string` | no | Why this category was chosen |

---

## Key properties

- All generator-based utilities default to `"gpt-5-mini"` and accept a `model` override.
- All utilities export their default output schema as a named Zod object (e.g., `summarizerOutputSchema`) for reference or reuse.
- The `outputSchema` parameter on every utility accepts a generic type, providing full type inference on the block's output.
- Combiner is handler-based — it runs deterministic logic with no LLM call.
- Every utility returns a standard `BlockDefinition` and is immediately composable via sequencer methods (`.then()`, `.parallel()`, `.forEach()`, etc.), router routes, or flow definitions.
- Non-string inputs are automatically serialized to JSON with 2-space indentation before being sent to the model.

## Imports

All utilities are accessible via the `utility` namespace:

```ts
import { utility } from "@flow-state-dev/core";

const block = utility.summarizer({ name: "summary" });
```

Individual utilities and schemas can also be imported directly:

```ts
import {
  summarizer,
  summarizerOutputSchema,
  analyzer,
  analyzerFindingSchema,
  analyzerOutputSchema,
  memoryCandidateSchema,
  decomposerTaskSchema,
  intentClassifier,
  intentRouter,
} from "@flow-state-dev/core";
```

Type imports:

```ts
import type {
  SummarizerConfig,
  SummarizerGranularity,
  AnalyzerConfig,
  ContextReducerConfig,
  ContextReducerMode,
  MemoryExtractorConfig,
  DecomposerConfig,
  ComposerConfig,
  CombinerConfig,
  SynthesizerConfig,
  IntentClassifierConfig,
  IntentCategories,
  IntentClassifierOutput,
  IntentRouterConfig,
} from "@flow-state-dev/core";
```
