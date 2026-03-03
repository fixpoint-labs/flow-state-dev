---
sidebar_position: 8
---

# Macro Blocks

Macro blocks are pre-built helper factories that wrap the core block primitives into specialized, high-level capabilities. Instead of configuring a generator from scratch every time you need summarization or task decomposition, you call a macro that returns a fully configured block — composable in sequencers, routers, and flows like any other block.

This guide covers all nine macros with realistic examples showing how they solve real problems in AI workflows.

## Quick overview

All macros live in the `helper` namespace:

```ts
import { helper } from "@flow-state-dev/core";

const block = helper.summarizer({ name: "my-summarizer", granularity: "brief" });
```

| Macro | Kind | What it does |
|-------|------|--------------|
| `contextReducer` | generator | Reduce context via distill, denoise, or compress strategies |
| `memoryExtractor` | generator | Extract durable memory candidates from conversations |
| `decomposer` | generator | Break broad requests into structured subtasks |
| `composer` | generator | Assemble coherent output from discrete parts |
| `summarizer` | generator | Summarize at brief, detailed, or executive granularity |
| `combiner` | handler | Deterministically merge artifacts (no LLM call) |
| `synthesizer` | generator | Reconcile overlapping or conflicting inputs into one artifact |
| `analyzer` | generator | Evaluate artifacts against structured criteria |
| `intentClassifier` | generator | Classify input into a bounded category set for routing |

Every generator-based macro defaults to `"gpt-5-mini"` and accepts a `model` override. All macros accept an optional `outputSchema` to replace the default output shape with full type inference.

---

## Context & Memory

### contextReducer — shrink context intelligently

Long conversations and documents eat up context windows fast. `contextReducer` gives you three reduction strategies, each with a tailored system prompt and default output schema.

```ts
import { helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

// Distill: extract the core ideas, discard the wording
const distill = helper.contextReducer({
  name: "distill-context",
  mode: "distill",
});
// Default output: { distilled: string, keyPoints: string[] }

// Denoise: strip filler, keep structure
const denoise = helper.contextReducer({
  name: "denoise-context",
  mode: "denoise",
});
// Default output: { cleaned: string, removedCategories?: string[] }

// Compress: lossy reduction under a token budget
const compress = helper.contextReducer({
  name: "compress-context",
  mode: "compress",
});
// Default output: { compressed: string, compressionRatio?: number, dropped?: string[] }
```

**When to reach for each mode:**

- **distill** — You have a long design discussion and need only the decisions and constraints for the next LLM call. Original wording doesn't matter.
- **denoise** — A user transcript has good structure but lots of tangents and repetition. You want to clean it up without reorganizing.
- **compress** — You're hitting a token limit and need to fit context into a strict budget. The `dropped` array tells you what was sacrificed.

#### Realistic example: context window management

When a session's conversation history grows too large, compress it before the next generator call:

```ts title="src/flows/agent/blocks/manage-context.ts"
import { helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const compressHistory = helper.contextReducer({
  name: "compress-history",
  mode: "compress",
});

const manageContext = sequencer({
  name: "context-manager",
  inputSchema: z.object({
    history: z.string(),
    maxTokens: z.number(),
  }),
})
  .map((input) => input.history)
  .then(compressHistory)
  .tap(async (result, ctx) => {
    // Store the compressed version for the next request
    await ctx.session.setState("compressedHistory", result.compressed);
  });
```

---

### memoryExtractor — remember what matters

Conversations contain durable facts, preferences, and decisions that should persist beyond the current request. `memoryExtractor` identifies these candidates without performing persistence — downstream blocks or flow actions handle storage.

```ts
import { helper } from "@flow-state-dev/core";

const extract = helper.memoryExtractor({
  name: "extract-memories",
});
// Default output: { memories: MemoryCandidate[] }
```

Each `MemoryCandidate` has:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"fact" \| "preference" \| "constraint" \| "decision"` | What kind of memory this is |
| `content` | `string` | The extracted memory |
| `confidence` | `number` (0–1) | How confident the extraction is |
| `source` | `string` | Where in the conversation this came from |

#### Realistic example: building a user profile over time

Extract memories from each conversation turn and accumulate them in session state. Over multiple interactions, the system builds an understanding of who the user is and what they need:

```ts title="src/flows/assistant/blocks/learn-user.ts"
import { handler, helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const extract = helper.memoryExtractor({ name: "learn" });

const persist = handler({
  name: "persist-memories",
  sessionStateSchema: z.object({
    memories: z.array(z.object({
      type: z.string(),
      content: z.string(),
      confidence: z.number().optional(),
    })).default([]),
  }),
  execute: async (input, ctx) => {
    // Only persist high-confidence memories
    const strong = input.memories.filter(
      (m) => (m.confidence ?? 0) >= 0.7
    );
    for (const memory of strong) {
      await ctx.session.pushState("memories", {
        type: memory.type,
        content: memory.content,
        confidence: memory.confidence,
      });
    }
    return input;
  },
});

export const learnUser = sequencer({
  name: "learn-user",
  inputSchema: z.object({ transcript: z.string() }),
})
  .map((input) => input.transcript)
  .then(extract)
  .then(persist);
```

---

## Planning & Decomposition

### decomposer — break big tasks into small ones

When users make broad requests like "build me a landing page", an LLM needs structure before it can execute. `decomposer` converts open-ended instructions into a dependency graph of subtasks.

```ts
import { helper } from "@flow-state-dev/core";

const decompose = helper.decomposer({
  name: "plan-tasks",
});
// Default output: { tasks: SubTask[] }
```

Each `SubTask` has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable unique identifier |
| `goal` | `string` | What the task accomplishes |
| `deps` | `string[]` | IDs of tasks this depends on |
| `priority` | `"high" \| "medium" \| "low"` | Execution priority hint |

#### Realistic example: project planning agent

An agent that takes a project brief, decomposes it into tasks, and schedules independent tasks in parallel:

```ts title="src/flows/project-planner/blocks/plan.ts"
import { helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const decompose = helper.decomposer({ name: "decompose-project" });

const summarizeTask = helper.summarizer({
  name: "task-summary",
  granularity: "brief",
});

export const planProject = sequencer({
  name: "plan-and-summarize",
  inputSchema: z.object({ brief: z.string() }),
})
  // Decompose the brief into tasks
  .map((input) => input.brief)
  .then(decompose)

  // Summarize each task for a quick overview
  .map((output) => output.tasks.map((t) => `Task ${t.id}: ${t.goal}`))
  .forEach(summarizeTask);
```

---

### composer — assemble parts into a whole

When you have discrete sections — an intro, body, and conclusion from different blocks — `composer` joins them into a coherent document respecting ordering and structural constraints.

**How it differs from `synthesizer`:** Composer rebuilds from discrete parts. Synthesizer reconciles overlap and conflict across independent inputs that may cover the same ground.

```ts
import { helper } from "@flow-state-dev/core";

const compose = helper.composer({
  name: "assemble-report",
  objectives: ["Maintain chronological order", "Use consistent tone"],
});
// Default output: { composed: string, structure?: string[] }
```

#### Realistic example: multi-section report builder

Different blocks produce different report sections. Composer assembles them into a single document:

```ts title="src/flows/reports/blocks/build-report.ts"
import { handler, helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const summarizeFindings = helper.summarizer({
  name: "findings-summary",
  granularity: "detailed",
});

const summarizeRisks = helper.summarizer({
  name: "risk-summary",
  granularity: "executive",
});

const compose = helper.composer({
  name: "final-report",
  objectives: ["Lead with executive summary", "End with action items"],
});

export const buildReport = sequencer({
  name: "report-builder",
  inputSchema: z.object({
    findings: z.string(),
    risks: z.string(),
  }),
})
  .parallel({
    findings: {
      connector: (input) => input.findings,
      block: summarizeFindings,
    },
    risks: {
      connector: (input) => input.risks,
      block: summarizeRisks,
    },
  })
  .map((results) => ({
    parts: [
      { id: "findings", content: results.findings.summary },
      { id: "risks", content: results.risks.summary },
    ],
    constraints: { ordering: ["findings", "risks"] },
  }))
  .then(compose);
```

---

## Synthesis & Output

### summarizer — condense with control

`summarizer` reduces input to a summary at one of three granularity levels. Optional `objectives` focus the summary on specific concerns — useful when you need a summary that highlights risks rather than features, for example.

```ts
import { helper } from "@flow-state-dev/core";

const brief = helper.summarizer({
  name: "brief",
  granularity: "brief",
});
// 1-2 sentence core takeaway

const detailed = helper.summarizer({
  name: "detailed",
  granularity: "detailed",
});
// Paragraph-level with context and nuance

const executive = helper.summarizer({
  name: "exec",
  granularity: "executive",
  objectives: ["Focus on budget impact", "Highlight blockers"],
});
// Decisions and actionable recommendations
```

Default output: `{ summary: string, keyPoints?: string[] }`

#### Realistic example: daily standup digest

Summarize a team's daily standup notes into an executive brief for stakeholders:

```ts title="src/flows/standups/blocks/digest.ts"
import { helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = helper.summarizer({
  name: "standup-digest",
  granularity: "executive",
  objectives: [
    "Highlight blockers and risks",
    "Surface cross-team dependencies",
    "Flag items that need leadership attention",
  ],
});

export const standupDigest = sequencer({
  name: "digest-pipeline",
  inputSchema: z.object({
    updates: z.array(z.object({
      author: z.string(),
      content: z.string(),
    })),
  }),
})
  .map((input) =>
    input.updates
      .map((u) => `**${u.author}:**\n${u.content}`)
      .join("\n\n")
  )
  .then(summarize);
```

---

### combiner — deterministic merge without an LLM

`combiner` is the only macro that uses a **handler** — no model call, no LLM, fully deterministic. It merges multiple artifacts using structural rules with auditable merge notes.

```ts
import { helper } from "@flow-state-dev/core";

const merge = helper.combiner({ name: "merge-results" });
// Default output: { combined: unknown, mergeNotes?: string[] }
```

**Merge strategy:**

| Input shapes | What happens |
|-------------|-------------|
| All arrays | Concatenate and deduplicate by value |
| All objects | Deep-merge keys; conflicting scalars resolved by later artifact |
| Mixed types | Preserve order, deduplicate exact matches |

Deduplication uses stable serialization (sorted object keys) — not reference equality. Merge notes document every resolution decision so the merge is auditable.

**When to prefer combiner over synthesizer:** Use combiner when you need deterministic, predictable merging. Use synthesizer when inputs have semantic overlap that needs interpretive reasoning.

#### Realistic example: merging parallel search results

After searching multiple sources in parallel, combine the results into a single deduplicated set:

```ts title="src/flows/search/blocks/merge-search.ts"
import { handler, helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const searchWeb = handler({
  name: "search-web",
  execute: async (input) => ({
    results: [
      { title: "Result A", url: "https://example.com/a", score: 0.9 },
      { title: "Result B", url: "https://example.com/b", score: 0.7 },
    ],
  }),
});

const searchDocs = handler({
  name: "search-docs",
  execute: async (input) => ({
    results: [
      { title: "Result B", url: "https://example.com/b", score: 0.8 },
      { title: "Result C", url: "https://example.com/c", score: 0.6 },
    ],
  }),
});

const merge = helper.combiner({ name: "merge-search-results" });

export const searchAndMerge = sequencer({
  name: "search-and-merge",
  inputSchema: z.object({ query: z.string() }),
})
  .parallel({ web: searchWeb, docs: searchDocs })
  .map((results) => [results.web, results.docs])
  .then(merge);
// combined: deep-merged with deduplication
// mergeNotes: explains what was deduplicated or resolved
```

---

### synthesizer — reconcile conflict and overlap

When multiple sources cover the same ground with different perspectives or conflicting claims, `synthesizer` produces a unified artifact. It deduplicates overlapping content while explicitly resolving disagreements — unlike combiner, which uses structural rules, synthesizer uses interpretive reasoning.

```ts
import { helper } from "@flow-state-dev/core";

const synthesize = helper.synthesizer({
  name: "reconcile",
  objectives: ["Prefer sources with direct evidence", "Flag unresolvable conflicts"],
});
// Default output: { synthesis: string, rationale: string[] }
```

The `rationale` array explains every synthesis decision — which sources agreed, how conflicts were resolved, and what was deduplicated. This makes the output auditable even though an LLM made the decisions.

#### Realistic example: reconciling analyst reports

Two analysts independently review the same product. Their reports overlap and sometimes disagree. Synthesizer produces one unified assessment:

```ts title="src/flows/analysis/blocks/reconcile.ts"
import { helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const synthesize = helper.synthesizer({
  name: "reconcile-reviews",
  objectives: [
    "Surface areas of agreement first",
    "For disagreements, present both positions with evidence",
    "Assign higher weight to claims backed by data",
  ],
});

export const reconcileReviews = sequencer({
  name: "reconcile-pipeline",
  inputSchema: z.object({
    reviews: z.array(z.object({
      analyst: z.string(),
      report: z.string(),
    })),
  }),
})
  .map((input) =>
    input.reviews.map((r) => `## ${r.analyst}\n${r.report}`).join("\n\n")
  )
  .then(synthesize);
// output.synthesis: unified assessment
// output.rationale: ["Both analysts agree on X...", "Conflict on Y: analyst A says... analyst B says..."]
```

---

## Evaluation

### analyzer — structured critique with routing

`analyzer` evaluates an artifact against a list of criteria and returns structured findings. The default criteria are `quality`, `risk`, `coverage`, and `confidence`, but you can supply any list relevant to your domain. The output is designed to drive downstream decisions — wire it into a router to automatically route critical findings to human review.

```ts
import { helper } from "@flow-state-dev/core";

const analyze = helper.analyzer({
  name: "code-review",
  criteria: ["correctness", "security", "performance", "maintainability"],
});
// Default output: { findings: Finding[], score?: number, recommendation?: string }
```

Each `Finding` has:

| Field | Type | Description |
|-------|------|-------------|
| `criterion` | `string` | Which criterion was evaluated |
| `assessment` | `string` | The evaluation result |
| `severity` | `"critical" \| "warning" \| "info"` | Priority level |
| `evidence` | `string` | Supporting evidence |

#### Realistic example: automated code review with routing

Analyze a pull request for quality and security. If anything critical is found, route to human review. Otherwise, auto-approve:

```ts title="src/flows/code-review/blocks/review.ts"
import { handler, helper, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const analyze = helper.analyzer({
  name: "pr-analysis",
  criteria: ["correctness", "security", "test-coverage", "breaking-changes"],
});

const autoApprove = handler({
  name: "auto-approve",
  execute: (input) => ({
    decision: "approved",
    summary: input.recommendation ?? "All checks passed.",
  }),
});

const flagForReview = handler({
  name: "flag-for-review",
  execute: (input) => ({
    decision: "needs-review",
    criticalFindings: input.findings
      .filter((f) => f.severity === "critical")
      .map((f) => `${f.criterion}: ${f.assessment}`),
  }),
});

const decisionRouter = router({
  name: "review-decision",
  routes: [autoApprove, flagForReview],
  execute: (input) => {
    const hasCritical = input.findings.some(
      (f) => f.severity === "critical"
    );
    return hasCritical ? flagForReview : autoApprove;
  },
});

export const codeReview = sequencer({
  name: "code-review-pipeline",
  inputSchema: z.object({ diff: z.string() }),
})
  .map((input) => input.diff)
  .then(analyze)
  .then(decisionRouter);
```

---

## Routing

### intentClassifier — categorize input for dispatch

When your flow needs to handle different kinds of user input differently — billing questions vs. technical support vs. sales inquiries — `intentClassifier` categorizes the input into one of a bounded set of categories. Each category has a human-readable description so the model understands the semantics, not just the label.

The output schema includes built-in Zod validation that rejects categories not in the declared set, so it's safe to wire directly into a router without defensive checks.

```ts
import { helper } from "@flow-state-dev/core";

const classify = helper.intentClassifier({
  name: "support-triage",
  categories: {
    billing: "Questions about invoices, charges, or subscription payments.",
    "technical-support": "Requests about bugs, outages, or broken product behavior.",
    "general-inquiry": "General product questions and feature clarifications.",
  },
});
// Default output: { category: string, confidence: number, reasoning?: string }
```

The `categories` map requires at least 2 entries. Each key becomes a valid output category; each value becomes the description injected into the model prompt.

#### Realistic example: customer support triage

Classify incoming support messages and route them to the right team. High-confidence classifications go straight to the team handler; low-confidence ones are escalated for human triage:

```ts title="src/flows/support/blocks/triage.ts"
import { handler, helper, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const classify = helper.intentClassifier({
  name: "classify-ticket",
  categories: {
    billing: "Invoice disputes, refund requests, subscription changes, payment failures.",
    technical: "Bug reports, error messages, product not working as expected.",
    account: "Password resets, account access, profile changes, permissions.",
    feature: "Feature requests, product suggestions, enhancement ideas.",
  },
});

const billingTeam = handler({
  name: "billing-team",
  execute: (input) => ({ team: "billing", ticket: input }),
});

const techTeam = handler({
  name: "tech-team",
  execute: (input) => ({ team: "engineering", ticket: input }),
});

const accountTeam = handler({
  name: "account-team",
  execute: (input) => ({ team: "account-services", ticket: input }),
});

const featureTeam = handler({
  name: "feature-team",
  execute: (input) => ({ team: "product", ticket: input }),
});

const humanTriage = handler({
  name: "human-triage",
  execute: (input) => ({ team: "triage-queue", ticket: input, reason: "low confidence" }),
});

const teamRouter = router({
  name: "team-router",
  routes: [billingTeam, techTeam, accountTeam, featureTeam, humanTriage],
  execute: (input) => {
    // Low confidence? Send to human triage
    if (input.confidence < 0.7) return humanTriage;

    switch (input.category) {
      case "billing": return billingTeam;
      case "technical": return techTeam;
      case "account": return accountTeam;
      case "feature": return featureTeam;
      default: return humanTriage;
    }
  },
});

export const supportTriage = sequencer({
  name: "support-triage-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .map((input) => input.message)
  .then(classify)
  .then(teamRouter);
```

---

## End-to-end examples

These examples show how multiple macros compose into complete workflows.

### Research pipeline

A user asks a broad research question. The system decomposes it into subtasks, summarizes each one, checks quality, then synthesizes a final answer:

```ts title="src/flows/research/flow.ts"
import { defineFlow, helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ question: z.string() });

// Step 1: Break the question into research subtasks
const decompose = helper.decomposer({ name: "plan-research" });

// Step 2: Summarize each subtask's scope
const summarize = helper.summarizer({
  name: "summarize-subtask",
  granularity: "detailed",
});

// Step 3: Check quality of the collected research
const qualityGate = helper.analyzer({
  name: "quality-gate",
  criteria: ["coverage", "accuracy", "evidence-quality"],
});

// Step 4: Synthesize into one coherent answer
const synthesize = helper.synthesizer({
  name: "final-answer",
  objectives: [
    "Produce a coherent narrative, not bullet points",
    "Cite evidence for every major claim",
  ],
});

const researchPipeline = sequencer({
  name: "research-pipeline",
  inputSchema,
})
  // Decompose
  .map((input) => input.question)
  .then(decompose)

  // Summarize each subtask in parallel
  .map((plan) => plan.tasks.map((task) => task.goal))
  .forEach(summarize)

  // Quality check the collected summaries
  .map((summaries) =>
    summaries.map((s) => s.summary).join("\n\n")
  )
  .then(qualityGate)

  // Synthesize the final answer
  .map((analysis) => ({
    findings: analysis.findings,
    recommendation: analysis.recommendation,
  }))
  .then(synthesize);

const researchFlow = defineFlow({
  kind: "research",
  requireUser: true,
  actions: {
    research: {
      inputSchema,
      block: researchPipeline,
      userMessage: (input) => input.question,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
});

export default researchFlow({ id: "default" });
```

**Data flow:** `question` &rarr; `decomposer` &rarr; `forEach(summarizer)` &rarr; `analyzer` &rarr; `synthesizer` &rarr; final answer

---

### Conversation memory pipeline

After each conversation turn, extract durable memories and compress the conversation history for efficient storage. Both operations run in parallel since they're independent:

```ts title="src/flows/assistant/blocks/memory-pipeline.ts"
import { handler, helper, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const extract = helper.memoryExtractor({ name: "extract-memories" });

const compress = helper.contextReducer({
  name: "compress-history",
  mode: "compress",
});

const persist = handler({
  name: "persist-results",
  sessionStateSchema: z.object({
    memories: z.array(z.object({
      type: z.string(),
      content: z.string(),
    })).default([]),
    compressedHistory: z.string().default(""),
  }),
  execute: async (input, ctx) => {
    const [extracted, compressed] = input;

    for (const memory of extracted.memories) {
      await ctx.session.pushState("memories", {
        type: memory.type,
        content: memory.content,
      });
    }

    await ctx.session.setState("compressedHistory", compressed.compressed);
    return input;
  },
});

export const memoryPipeline = sequencer({
  name: "memory-pipeline",
  inputSchema: z.object({ transcript: z.string() }),
})
  .map((input) => input.transcript)
  .parallel(extract, compress)
  .then(persist);
```

**Data flow:** `transcript` &rarr; `parallel(memoryExtractor, contextReducer)` &rarr; `persist to session` &rarr; done

---

## Overriding the output schema

Every macro accepts an `outputSchema` parameter that replaces the default with full generic type inference. This is useful when you need the LLM to produce additional fields or a different shape:

```ts
import { helper } from "@flow-state-dev/core";
import { z } from "zod";

const customAnalyzer = helper.analyzer({
  name: "routing-analysis",
  criteria: ["risk"],
  outputSchema: z.object({
    findings: z.array(z.object({
      criterion: z.string(),
      assessment: z.string(),
    })),
    route: z.enum(["proceed", "escalate", "reject"]),
  }),
});

// TypeScript knows the output includes `.route`
// and it's "proceed" | "escalate" | "reject"
```

## Next steps

- See the [Sequencer Patterns](/docs/guides/sequencer-patterns) guide for more composition techniques
- Read about [Blocks](/docs/concepts/blocks) to understand how macros fit into the four-primitive model
- Check [Testing Flows](/docs/guides/testing-flows) for how to test macro-based pipelines with mocked generators
