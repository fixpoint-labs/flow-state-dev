---
sidebar_position: 8
---

# Macro Blocks

Macro blocks are pre-built factories that wrap the core block primitives into specialized, high-level capabilities. Instead of configuring a generator from scratch every time you need summarization or task decomposition, you call a macro that returns a fully configured block — composable in sequencers, routers, and flows like any other block.

This guide covers all ten macros with realistic examples showing how they solve real problems in AI workflows.

## Quick overview

All macros live in the `macro` namespace:

```ts
import { macro } from "@flow-state-dev/core";

const block = macro.summarizer({ name: "my-summarizer", granularity: "brief" });
```

| Macro | Kind | What it does |
|-------|------|--------------|
| [`contextReducer`](#contextreducer) | generator | Reduce context via distill, denoise, or compress strategies |
| [`memoryExtractor`](#memoryextractor) | generator | Extract durable memory candidates from conversations |
| [`decomposer`](#decomposer) | generator | Break broad requests into structured subtasks |
| [`composer`](#composer) | generator | Assemble coherent output from discrete parts |
| [`summarizer`](#summarizer) | generator | Summarize at brief, detailed, or executive granularity |
| [`combiner`](#combiner) | handler | Deterministically merge artifacts (no LLM call) |
| [`synthesizer`](#synthesizer) | generator | Reconcile overlapping or conflicting inputs into one artifact |
| [`analyzer`](#analyzer) | generator | Evaluate artifacts against structured criteria |
| [`intentClassifier`](#intentclassifier) | generator | Classify input into a bounded category set for routing |
| [`intentRouter`](#intentrouter) | sequencer | Pre-wired classifier + router for classification-driven branching |

Every generator-based macro defaults to `"gpt-5-mini"` and accepts a `model` override. All macros accept an optional `outputSchema` to replace the default output shape with full type inference.

---

## Context & Memory

### contextReducer — shrink context intelligently {#contextreducer}

Long conversations and documents eat up context windows fast. `contextReducer` gives you three reduction strategies, each with a tailored system prompt and default output schema.

**Common use cases:**
- Managing conversation history that exceeds token limits between requests
- Distilling long design discussions down to just the decisions and constraints
- Cleaning noisy user transcripts before passing to another LLM
- Compressing session context to fit within a strict token budget

```ts
import { macro } from "@flow-state-dev/core";

// Distill: extract the core ideas, discard the wording
const distill = macro.contextReducer({
  name: "distill-context",
  mode: "distill",
});

// Denoise: strip filler, keep structure
const denoise = macro.contextReducer({
  name: "denoise-context",
  mode: "denoise",
});

// Compress: lossy reduction under a token budget
const compress = macro.contextReducer({
  name: "compress-context",
  mode: "compress",
});
```

**Example output (distill mode):**

```json
{
  "distilled": "The team agreed to use TypeScript for the backend, deploy on a weekly cadence, and use PostgreSQL as the primary database. Authentication will use OAuth2 with JWT tokens.",
  "keyPoints": [
    "TypeScript backend",
    "Weekly deployment cadence",
    "PostgreSQL primary database",
    "OAuth2 + JWT authentication"
  ]
}
```

**Example output (denoise mode):**

```json
{
  "cleaned": "User wants to reset their password. They tried the email link but it expired after 24 hours. They need a new reset link sent to their current email address.",
  "removedCategories": ["filler phrases", "repeated questions", "off-topic tangents"]
}
```

**Example output (compress mode):**

```json
{
  "compressed": "Project kickoff: TypeScript backend, React frontend. Sprint 1 targets auth and user profiles. Sprint 2 targets billing integration. Team raised concerns about third-party rate limits.",
  "compressionRatio": 0.35,
  "dropped": ["casual greetings", "scheduling logistics", "off-topic sidebar about lunch plans"]
}
```

**When to reach for each mode:**

- **distill** — You have a long design discussion and need only the decisions and constraints for the next LLM call. Original wording doesn't matter.
- **denoise** — A user transcript has good structure but lots of tangents and repetition. You want to clean it up without reorganizing.
- **compress** — You're hitting a token limit and need to fit context into a strict budget. The `dropped` array tells you what was sacrificed.

#### Realistic example: context window management

When a session's conversation history grows too large, compress it before the next generator call:

```ts title="src/flows/agent/blocks/manage-context.ts"
import { macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const compressHistory = macro.contextReducer({
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
    await ctx.session.setState("compressedHistory", result.compressed);
  });
```

---

### memoryExtractor — remember what matters {#memoryextractor}

Conversations contain durable facts, preferences, and decisions that should persist beyond the current request. `memoryExtractor` identifies these candidates without performing persistence — downstream blocks or flow actions handle storage.

**Common use cases:**
- Building user profiles over multiple conversations
- Capturing preferences during onboarding flows
- Extracting decisions and constraints from planning sessions
- Learning tool and workflow preferences for personalization

```ts
import { macro } from "@flow-state-dev/core";

const extract = macro.memoryExtractor({
  name: "extract-memories",
});
```

Each `MemoryCandidate` has:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"fact" \| "preference" \| "constraint" \| "decision"` | What kind of memory this is |
| `content` | `string` | The extracted memory |
| `confidence` | `number` (0–1) | How confident the extraction is |
| `source` | `string` | Where in the conversation this came from |

**Example output:**

```json
{
  "memories": [
    {
      "type": "preference",
      "content": "User prefers dark mode interfaces",
      "confidence": 0.92,
      "source": "Turn 3: 'I always use dark mode everywhere'"
    },
    {
      "type": "fact",
      "content": "User is a senior frontend developer at Acme Corp",
      "confidence": 0.88,
      "source": "Turn 1: 'I'm a senior frontend dev at Acme'"
    },
    {
      "type": "decision",
      "content": "Project will use React with TypeScript",
      "confidence": 0.95,
      "source": "Turn 5: 'Let's go with React and TypeScript for this'"
    }
  ]
}
```

#### Realistic example: building a user profile over time

Extract memories from each conversation turn and accumulate them in session state:

```ts title="src/flows/assistant/blocks/learn-user.ts"
import { handler, macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const extract = macro.memoryExtractor({ name: "learn" });

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

### decomposer — break big tasks into small ones {#decomposer}

When users make broad requests like "build me a landing page", an LLM needs structure before it can execute. `decomposer` converts open-ended instructions into a dependency graph of subtasks.

**Common use cases:**
- Breaking complex user requests into parallelizable work items
- Creating project plans with dependency ordering
- Generating step-by-step implementation guides from high-level briefs
- Feeding a task scheduler that dispatches work to specialized agents

```ts
import { macro } from "@flow-state-dev/core";

const decompose = macro.decomposer({
  name: "plan-tasks",
});
```

Each `SubTask` has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Stable unique identifier |
| `goal` | `string` | What the task accomplishes |
| `deps` | `string[]` | IDs of tasks this depends on |
| `priority` | `"high" \| "medium" \| "low"` | Execution priority hint |

**Example output:**

```json
{
  "tasks": [
    {
      "id": "task-1",
      "goal": "Design the database schema for user accounts and sessions",
      "deps": [],
      "priority": "high"
    },
    {
      "id": "task-2",
      "goal": "Implement authentication endpoints (signup, login, logout)",
      "deps": ["task-1"],
      "priority": "high"
    },
    {
      "id": "task-3",
      "goal": "Build the password reset flow with email verification",
      "deps": ["task-2"],
      "priority": "medium"
    },
    {
      "id": "task-4",
      "goal": "Add OAuth2 integration for Google and GitHub providers",
      "deps": ["task-2"],
      "priority": "low"
    }
  ]
}
```

#### Realistic example: project planning agent

An agent that takes a project brief, decomposes it, and summarizes each task for a quick overview:

```ts title="src/flows/project-planner/blocks/plan.ts"
import { macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const decompose = macro.decomposer({ name: "decompose-project" });

const summarizeTask = macro.summarizer({
  name: "task-summary",
  granularity: "brief",
});

export const planProject = sequencer({
  name: "plan-and-summarize",
  inputSchema: z.object({ brief: z.string() }),
})
  .map((input) => input.brief)
  .then(decompose)
  .map((output) => output.tasks.map((t) => `Task ${t.id}: ${t.goal}`))
  .forEach(summarizeTask);
```

---

### composer — assemble parts into a whole {#composer}

When you have discrete sections — an intro, body, and conclusion from different blocks — `composer` joins them into a coherent document respecting ordering and structural constraints.

**How it differs from `synthesizer`:** Composer rebuilds from discrete parts. Synthesizer reconciles overlap and conflict across independent inputs that may cover the same ground.

**Common use cases:**
- Assembling multi-section reports from parallel analysis blocks
- Joining independently generated document sections into a coherent whole
- Combining research findings with recommendations into a single deliverable
- Building structured outputs from discrete pipeline stages

```ts
import { macro } from "@flow-state-dev/core";

const compose = macro.composer({
  name: "assemble-report",
  objectives: ["Maintain chronological order", "Use consistent tone"],
});
```

**Example output:**

```json
{
  "composed": "# Q3 Product Review\n\nThe quarter saw significant progress across all product lines. Revenue grew 18% quarter-over-quarter, driven primarily by enterprise adoption.\n\n## Key Findings\n\nCustomer retention improved to 94%, up from 89% in Q2. The new onboarding flow reduced time-to-value by 40%.\n\n## Risk Assessment\n\nTwo critical risks require immediate attention: the pending API deprecation affects 12% of integrations, and the mobile team is understaffed for the offline sync milestone.\n\n## Recommendations\n\n1. Accelerate migration tooling for deprecated APIs\n2. Expand enterprise onboarding team by 2 headcount",
  "structure": ["executive-summary", "key-findings", "risk-assessment", "recommendations"]
}
```

#### Realistic example: multi-section report builder

Different blocks produce different report sections. Composer assembles them into a single document:

```ts title="src/flows/reports/blocks/build-report.ts"
import { macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const summarizeFindings = macro.summarizer({
  name: "findings-summary",
  granularity: "detailed",
});

const summarizeRisks = macro.summarizer({
  name: "risk-summary",
  granularity: "executive",
});

const compose = macro.composer({
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

### summarizer — condense with control {#summarizer}

`summarizer` reduces input to a summary at one of three granularity levels. Optional `objectives` focus the summary on specific concerns — useful when you need a summary that highlights risks rather than features, for example.

**Common use cases:**
- Daily standup digests for stakeholders
- Conversation recaps before handoff between agents
- Document previews in search results
- Executive briefings from detailed technical reports

```ts
import { macro } from "@flow-state-dev/core";

const brief = macro.summarizer({
  name: "brief",
  granularity: "brief",
});
// 1-2 sentence core takeaway

const detailed = macro.summarizer({
  name: "detailed",
  granularity: "detailed",
});
// Paragraph-level with context and nuance

const executive = macro.summarizer({
  name: "exec",
  granularity: "executive",
  objectives: ["Focus on budget impact", "Highlight blockers"],
});
// Decisions and actionable recommendations
```

**Example output (brief):**

```json
{
  "summary": "The API migration completed on schedule with zero downtime, though three deprecated endpoints still need client updates before the April removal deadline.",
  "keyPoints": [
    "Migration completed on schedule",
    "Zero downtime achieved",
    "3 deprecated endpoints pending client updates"
  ]
}
```

**Example output (executive):**

```json
{
  "summary": "Engineering is on track for the Q2 launch but two blockers need leadership attention: the payment provider integration is stalled pending legal review of a $450K annual contract, and the mobile team is short one senior developer for the offline sync feature. Recommend fast-tracking the legal review and approving the open headcount by end of week.",
  "keyPoints": [
    "Q2 launch on track overall",
    "Payment integration blocked on legal review ($450K contract)",
    "Mobile team needs senior hire for offline sync",
    "Action needed: fast-track legal review, approve headcount"
  ]
}
```

#### Realistic example: daily standup digest

Summarize a team's daily standup notes into an executive brief for stakeholders:

```ts title="src/flows/standups/blocks/digest.ts"
import { macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = macro.summarizer({
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

### combiner — deterministic merge without an LLM {#combiner}

`combiner` uses a handler block — no model call, fully deterministic. It merges multiple artifacts using structural rules with auditable merge notes.

**Common use cases:**
- Merging parallel search results from multiple sources
- Combining paginated API responses into a single dataset
- Aggregating outputs from `forEach` or `parallel` steps
- Deduplicating overlapping data collected from different pipelines

```ts
import { macro } from "@flow-state-dev/core";

const merge = macro.combiner({ name: "merge-results" });
```

**Merge strategy:**

| Input shapes | What happens |
|-------------|-------------|
| All arrays | Concatenate and deduplicate by value |
| All objects | Deep-merge keys; conflicting scalars resolved by later artifact |
| Mixed types | Preserve order, deduplicate exact matches |

Deduplication uses stable serialization (sorted object keys) — not reference equality. Merge notes document every resolution decision so the merge is auditable.

**When to prefer combiner over synthesizer:** Use combiner when you need deterministic, predictable merging. Use synthesizer when inputs have semantic overlap that needs interpretive reasoning.

**Example output:**

```json
{
  "combined": [
    { "title": "Getting Started Guide", "source": "docs", "score": 0.95 },
    { "title": "API Reference", "source": "docs", "score": 0.88 },
    { "title": "Authentication Tutorial", "source": "web", "score": 0.82 },
    { "title": "Community Cookbook", "source": "web", "score": 0.71 }
  ],
  "mergeNotes": [
    "Deduplicated 'API Reference' (appeared in both sources)",
    "Preserved higher score (0.88 from docs) over duplicate (0.76 from web)"
  ]
}
```

#### Realistic example: merging parallel search results

After searching multiple sources in parallel, combine the results into a single deduplicated set:

```ts title="src/flows/search/blocks/merge-search.ts"
import { macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { searchWeb, searchDocs } from "./search-sources";

const merge = macro.combiner({ name: "merge-search-results" });

export const searchAndMerge = sequencer({
  name: "search-and-merge",
  inputSchema: z.object({ query: z.string() }),
})
  .parallel({
    web: searchWeb,
    docs: searchDocs,
  })
  .map((results) => [results.web, results.docs])
  .then(merge);
```

---

### synthesizer — reconcile conflict and overlap {#synthesizer}

When multiple sources cover the same ground with different perspectives or conflicting claims, `synthesizer` produces a unified artifact. It deduplicates overlapping content while explicitly resolving disagreements — unlike combiner, which uses structural rules, synthesizer uses interpretive reasoning.

**Common use cases:**
- Reconciling conflicting analyst reports or reviews
- Unifying overlapping research from parallel agents
- Merging multiple customer feedback themes into a single insight report
- Producing consensus summaries from multi-source intelligence

```ts
import { macro } from "@flow-state-dev/core";

const synthesize = macro.synthesizer({
  name: "reconcile",
  objectives: ["Prefer sources with direct evidence", "Flag unresolvable conflicts"],
});
```

The `rationale` array explains every synthesis decision — which sources agreed, how conflicts were resolved, and what was deduplicated. This makes the output auditable even though an LLM made the decisions.

**Example output:**

```json
{
  "synthesis": "Both analysts agree the product's core UX is strong and retention metrics are trending positively. Pricing strategy is the key point of disagreement: Analyst A recommends a 15% price reduction to drive volume, while Analyst B recommends feature bundling at current price points to increase perceived value. Market data from Q3 supports the bundling approach, as competitors who cut prices saw short-term volume gains but lower LTV. Both analysts independently flagged mobile performance as the top technical priority.",
  "rationale": [
    "UX sentiment: both analysts positive — merged without conflict",
    "Pricing: Analyst A recommends reduction, Analyst B recommends bundling. Weighted toward B (backed by Q3 market data)",
    "Mobile performance: both flagged independently — deduplicated into single finding",
    "Churn risk from competitor features mentioned only by Analyst A — preserved as-is"
  ]
}
```

#### Realistic example: reconciling analyst reports

Two analysts independently review the same product. Their reports overlap and sometimes disagree:

```ts title="src/flows/analysis/blocks/reconcile.ts"
import { macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const synthesize = macro.synthesizer({
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
```

---

## Evaluation

### analyzer — structured critique with routing {#analyzer}

`analyzer` evaluates an artifact against a list of criteria and returns structured findings. The default criteria are `quality`, `risk`, `coverage`, and `confidence`, but you can supply any list relevant to your domain. The output is designed to drive downstream decisions — wire it into a router to automatically route critical findings to human review.

**Common use cases:**
- Automated code review with severity-based routing
- Content quality gates before publishing
- Compliance checking against regulatory criteria
- Risk assessment for generated outputs before delivery to users

```ts
import { macro } from "@flow-state-dev/core";

const analyze = macro.analyzer({
  name: "code-review",
  criteria: ["correctness", "security", "performance", "maintainability"],
});
```

Each `Finding` has:

| Field | Type | Description |
|-------|------|-------------|
| `criterion` | `string` | Which criterion was evaluated |
| `assessment` | `string` | The evaluation result |
| `severity` | `"critical" \| "warning" \| "info"` | Priority level |
| `evidence` | `string` | Supporting evidence |

**Example output:**

```json
{
  "findings": [
    {
      "criterion": "correctness",
      "assessment": "Logic handles edge cases properly with null checks on all external inputs",
      "severity": "info",
      "evidence": "Null checks present at lines 12, 34, and 67"
    },
    {
      "criterion": "security",
      "assessment": "SQL query uses string concatenation instead of parameterized queries",
      "severity": "critical",
      "evidence": "Line 42: SELECT * FROM users WHERE id = '${userId}'"
    },
    {
      "criterion": "performance",
      "assessment": "N+1 query pattern in user listing endpoint",
      "severity": "warning",
      "evidence": "Loop at line 78 issues individual SELECT per user instead of batch query"
    }
  ],
  "score": 0.45,
  "recommendation": "Block merge until SQL injection vulnerability is fixed. Address N+1 query before next release."
}
```

#### Realistic example: automated code review with routing

Analyze a pull request. If anything critical is found, route to human review. Otherwise, auto-approve:

```ts title="src/flows/code-review/blocks/review.ts"
import { handler, macro, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const analyze = macro.analyzer({
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

### intentClassifier — categorize input for dispatch {#intentclassifier}

When your flow needs to handle different kinds of user input differently — billing questions vs. technical support vs. sales inquiries — `intentClassifier` categorizes the input into one of a bounded set of categories. Each category has a human-readable description so the model understands the semantics, not just the label.

The output schema includes built-in Zod validation that rejects categories not in the declared set, so it's safe to wire directly into a router without defensive checks.

**Common use cases:**
- Customer support triage into department-specific queues
- Command parsing for chatbot interactions
- Routing user requests by topic in multi-capability agents
- Pre-filtering inputs before expensive downstream processing

```ts
import { macro } from "@flow-state-dev/core";

const classify = macro.intentClassifier({
  name: "support-triage",
  categories: {
    billing: "Questions about invoices, charges, or subscription payments.",
    "technical-support": "Requests about bugs, outages, or broken product behavior.",
    "general-inquiry": "General product questions and feature clarifications.",
  },
});
```

The `categories` map requires at least 2 entries. Each key becomes a valid output category; each value becomes the description injected into the model prompt.

**Example output:**

```json
{
  "category": "billing",
  "confidence": 0.94,
  "reasoning": "User explicitly mentions 'invoice' and 'overcharged', indicating a billing-related dispute"
}
```

#### Realistic example: customer support triage

Classify incoming support messages and route them to the right team. High-confidence classifications go straight to the team handler; low-confidence ones are escalated for human triage:

```ts title="src/flows/support/blocks/triage.ts"
import { handler, macro, router, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const classify = macro.intentClassifier({
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

For most classification-to-dispatch workflows, `intentRouter` (below) eliminates this boilerplate entirely.

---

### intentRouter — classify and dispatch in one step {#intentrouter}

`intentRouter` combines `intentClassifier` + `router` into a single declaration. Instead of wiring the two primitives manually, you declare categories with descriptions and handlers in one place — the macro builds the sequencer for you.

This is the idiomatic way to do classification-driven branching. Use `intentClassifier` directly only when you need to inspect or transform the classification result before routing.

**Common use cases:**
- Multi-department helpdesk routing with confidence thresholds
- Chatbot command dispatch where each intent maps to a different pipeline
- Multi-tenant flows that branch by customer type
- Any classification-to-dispatch pattern where you don't need to inspect the classification mid-flow

```ts
import { macro } from "@flow-state-dev/core";

const triage = macro.intentRouter({
  name: "support-triage",
  categories: {
    billing: {
      description: "Invoice disputes, refund requests, payment failures.",
      handler: billingHandler,
    },
    technical: {
      description: "Bug reports, errors, broken product behavior.",
      handler: techHandler,
    },
  },
  fallback: unknownHandler,       // optional — handles low-confidence results
  confidenceThreshold: 0.7,       // optional — below this, use fallback
});
// Returns a sequencer block definition
```

The `categories` map is the single source of truth — labels, descriptions, and handlers declared once. The macro extracts descriptions for the classifier and handlers for the router.

**Confidence threshold behavior:**
- When `confidenceThreshold` is set and the classifier returns a confidence below it, the result routes to `fallback`
- When `fallback` is omitted and confidence is too low, an error is thrown with a descriptive message
- When no threshold is set, the top category is always used regardless of confidence

`intentRouter` returns whatever the matched branch handler produces — there is no wrapper output schema. The output type is the union of all branch handler outputs.

#### Realistic example: multi-department helpdesk

A helpdesk flow that routes user messages to specialized department handlers:

```ts title="src/flows/helpdesk/blocks/dispatch.ts"
import { handler, macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { techSupportPipeline } from "./tech-support";

const billingHandler = handler({
  name: "billing-dept",
  execute: async (input, ctx) => {
    await ctx.session.pushState("routing", { dept: "billing", at: Date.now() });
    return { department: "billing", message: "Routing to billing team..." };
  },
});

const salesHandler = handler({
  name: "sales-dept",
  execute: (input) => ({ department: "sales", message: "Connecting to sales..." }),
});

const escalationHandler = handler({
  name: "escalation-dept",
  execute: (input) => ({ department: "escalation", message: "Escalating to a manager..." }),
});

const fallbackHandler = handler({
  name: "fallback",
  execute: (input) => ({ department: "general", message: "Routing to general support..." }),
});

export const helpdesk = macro.intentRouter({
  name: "helpdesk-dispatch",
  categories: {
    billing: {
      description: "Invoice disputes, refund requests, subscription changes, payment failures.",
      handler: billingHandler,
    },
    technical: {
      description: "Bug reports, error messages, product crashes, or unexpected behavior.",
      handler: techSupportPipeline,
    },
    sales: {
      description: "Pricing questions, plan comparisons, enterprise inquiries, purchase flow.",
      handler: salesHandler,
    },
    escalation: {
      description: "Frustrated users, requests to speak with a manager, repeated unresolved issues.",
      handler: escalationHandler,
    },
  },
  fallback: fallbackHandler,
  confidenceThreshold: 0.6,
});

const pipeline = sequencer({
  name: "helpdesk-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .map((input) => input.message)
  .then(helpdesk);
```

Compare this to the manual `intentClassifier` + `router` approach above — the same behavior with significantly less wiring.

---

## End-to-end examples

These examples show how multiple macros compose into complete workflows.

### Research pipeline

A user asks a broad research question. The system decomposes it into subtasks, summarizes each one, checks quality, then synthesizes a final answer:

```ts title="src/flows/research/flow.ts"
import { defineFlow, macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ question: z.string() });

// Step 1: Break the question into research subtasks
const decompose = macro.decomposer({ name: "plan-research" });

// Step 2: Summarize each subtask's scope
const summarize = macro.summarizer({
  name: "summarize-subtask",
  granularity: "detailed",
});

// Step 3: Check quality of the collected research
const qualityGate = macro.analyzer({
  name: "quality-gate",
  criteria: ["coverage", "accuracy", "evidence-quality"],
});

// Step 4: Synthesize into one coherent answer
const synthesize = macro.synthesizer({
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
import { handler, macro, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const extract = macro.memoryExtractor({ name: "extract-memories" });

const compress = macro.contextReducer({
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
import { macro } from "@flow-state-dev/core";
import { z } from "zod";

const customAnalyzer = macro.analyzer({
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
