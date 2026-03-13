---
sidebar_position: 1
---

# Introduction

flow-state-dev gives you blocks, flows, state, and streaming. Those are execution primitives. They don't have opinions about how an agent should think.

Thought Fabric is the cognitive layer. It's a separate framework built on top of flow-state-dev that models how agents manage attention, form memories, develop identity, perceive their environment, and reason about problems. Where flow-state-dev handles the "how does this run" question, Thought Fabric handles "how does this think."

The separation is deliberate. Not every flow needs cognition. A data pipeline that validates, transforms, and stores doesn't need working memory or salience scoring. But an agent that maintains context across long conversations, prioritizes what matters, and behaves consistently across interactions does. Thought Fabric is for that second case.

## The vision

Thought Fabric maps cognitive science concepts onto composable building blocks. The full architecture spans seven domains:

| Domain | What it models | Status |
|--------|---------------|--------|
| **Attention** | What to focus on. Relevance filtering and salience scoring. | Shipped |
| **Memory** | What to remember. Bounded working memory with decay and eviction. | Shipped |
| **Identity** | How to behave. Perspective (role/expertise) and constitution (values/constraints). | Coming soon |
| **Perception** | How to interpret input. Sensory processing, context framing, signal extraction. | Coming soon |
| **Reasoning** | How to think. Structured deliberation, chain-of-thought, planning strategies. | Coming soon |
| **Metacognition** | How to self-monitor. Confidence calibration, strategy selection, self-correction. | Planned |
| **Learning** | How to improve. Pattern extraction, skill acquisition, feedback integration. | Planned |

Each domain will export blocks, helpers, and resource definitions that compose with flow-state-dev primitives. A Thought Fabric block is a standard flow-state-dev block. You use it in sequencers, pass it as a tool, register it in flows. No special runtime, no separate execution model.

The goal isn't to simulate human cognition. It's to give agent builders a structured vocabulary for the cognitive behaviors they're already implementing ad-hoc. Instead of hand-rolling memory management or bolting salience heuristics onto prompt templates, you compose purpose-built blocks that handle these concerns with tested, configurable implementations.

## What's shipped today

**Memory** is fully implemented. Working memory gives your agents a bounded, salience-scored store that tracks what stays in cognitive focus during a conversation. Entries decay over time using configurable strategies (ACT-R power-law by default). The `workingMemoryCapture` block extracts memories via LLM, persists them, and advances the decay clock. One line to add to a pipeline. See [Memory](./memory.md).

**Attention** ships two blocks. `filterRelevance` does deterministic keyword-based relevance filtering: fast, no LLM, good for cutting noise before expensive operations. `scoreSalience` uses an LLM to score items along configurable dimensions (goal relevance, recency, novelty, emotional weight). Use them together: filter first, then score the survivors. See [Attention](./attention.md).

**Identity** has placeholder types. `perspective()` and `constitution()` define the interfaces but throw "Not implemented" until the next wave. The design is set; the implementation is queued. See [Identity](./identity.md).

## Import paths

Use subpath exports for tree-shaking:

```ts
import { filterRelevance, scoreSalience } from '@thought-fabric/core/attention'
import { workingMemoryCapture, workingMemoryContextFormatter } from '@thought-fabric/core/memory'
import { perspective, constitution } from '@thought-fabric/core/identity'
```

Or import domain namespaces from the main package:

```ts
import { attention, memory, identity } from '@thought-fabric/core'
// attention.filterRelevance, memory.workingMemoryCapture, identity.perspective
```

The package depends on `@flow-state-dev/core`. Build core first if you hit type resolution issues.

## Naming convention

Word order encodes the category:

| Pattern | Category | Example |
|---------|----------|---------|
| `workingMemory[Verb]` | Block or item | `workingMemoryCapture`, `workingMemoryObserve` |
| `[verb]WorkingMemory` | Helper (verb first) | `addWorkingMemory`, `evictWorkingMemory` |

`workingMemoryAdd` is a block you compose in a pipeline. `addWorkingMemory` is a helper you call on a resource ref. The inversion tells you which is which without checking docs.
