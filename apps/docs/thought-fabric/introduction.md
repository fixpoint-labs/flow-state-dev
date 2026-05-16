---
sidebar_position: 1
---

# Introduction

flow-state-dev gives you blocks, flows, state, and streaming. Those are execution primitives. They don't have opinions about how an agent should think.

Thought Fabric is the cognitive layer. It's a separate framework built on top of flow-state-dev that models how agents manage attention, develop identity, perceive their environment, and reason about problems. Where flow-state-dev handles the "how does this run" question, Thought Fabric handles "how does this think."

The separation is deliberate. Not every flow needs cognition. A data pipeline that validates, transforms, and stores doesn't need salience scoring or a perspective model. But an agent that prioritizes what matters and behaves consistently across interactions does. Thought Fabric is for that second case.

## The vision

Thought Fabric maps cognitive science concepts onto composable building blocks. The full architecture spans several domains:

| Domain | What it models | Status |
|--------|---------------|--------|
| **Attention** | What to focus on. Relevance filtering and salience scoring. | Shipped |
| **Identity** | How to interpret. Perspective (viewpoint/expertise) with evolving observations and positions. | Shipped (partial) |
| **Perception** | How to interpret input. Sensory processing, context framing, signal extraction. | Coming soon |
| **Reasoning** | How to think. Structured deliberation, chain-of-thought, planning strategies. | Coming soon |
| **Metacognition** | How to self-monitor. Bias detection, sycophancy scoring, counter-argument generation. | Shipped (partial) |
| **Learning** | How to improve. Pattern extraction, skill acquisition, feedback integration. | Planned |

Each domain exports blocks, helpers, and resource definitions that compose with flow-state-dev primitives. A Thought Fabric block is a standard flow-state-dev block. You use it in sequencers, pass it as a tool, register it in flows. No special runtime, no separate execution model.

The goal isn't to simulate human cognition. It's to give agent builders a structured vocabulary for the cognitive behaviors they're already implementing ad-hoc. Instead of hand-rolling salience heuristics or bolting bias checks onto prompt templates, you compose purpose-built blocks that handle these concerns with tested, configurable implementations.

> **Memory used to live here.** Cross-turn memory shipped from Thought Fabric in earlier waves. It now lives in `@flow-state-dev/memory` so it can ship as part of the open framework. Thought Fabric will host specialized cognitive memory variants on top of that contract when they're ready — until then it doesn't address memory at all. See the framework docs at Ecosystem → Memory.

## What's shipped today

**Attention** ships two blocks. `filterRelevance` does deterministic keyword-based relevance filtering: fast, no LLM, good for cutting noise before expensive operations. `scoreSalience` uses an LLM to score items along configurable dimensions (goal relevance, recency, novelty, emotional weight). Use them together: filter first, then score the survivors. See [Attention](./attention.md).

**Identity** ships `perspective()` — a structured viewpoint model that shapes how an agent interprets information. Perspectives accumulate observations and positions over a session via resource-backed state. The `system()` factory bundles blocks, a capability, and a capture pipeline. A second primitive, `constitution()` (values and behavioral constraints), is planned. See [Identity](./identity.md).

**Metacognition** ships bias and sycophancy detection. The `biasAnalyzer` sequencer takes a user input and AI response, detects agreement bias across four dimensions, classifies six cognitive bias types, computes a composite sycophancy score, and generates counter-arguments when the score warrants it. All five internal blocks are exported individually for custom pipelines. See [Metacognition](./metacognition.md).

## Import paths

Use subpath exports for tree-shaking:

```ts
import { filterRelevance, scoreSalience } from '@thought-fabric/core/attention'
import { perspective, system } from '@thought-fabric/core/identity'
import { biasAnalyzer } from '@thought-fabric/core/metacognition'
```

Or import domain namespaces from the main package:

```ts
import { attention, identity, metacognition } from '@thought-fabric/core'
// attention.filterRelevance, identity.perspective, metacognition.biasAnalyzer
```

The package depends on `@flow-state-dev/core`. Build core first if you hit type resolution issues.

## Naming convention

Word order encodes the category:

| Pattern | Category | Example |
|---------|----------|---------|
| `[domain][Verb]` | Block or item | `perspectiveObserve`, `constitutionAuditor` |
| `[verb][Domain]` | Helper (verb first) | `addPerspective`, `summarizePerspective` |

A noun-first identifier is a block you compose in a pipeline. A verb-first identifier is a helper you call on a resource ref. The inversion tells you which is which without checking docs.
