---
sidebar_position: 1
---

# Introduction

Thought Fabric is a cognitive architecture layer built on top of flow-state-dev. The low-level framework gives you blocks, flows, and streaming. Thought Fabric adds higher-level abstractions for building agents that think more like humans: what to focus on, what to remember, and how to behave.

## Three Domains

The package is organized into three domains:

- **Attention** — What to focus on. Relevance filtering and salience scoring so the agent prioritizes information that matters for the current task.
- **Memory** — What to remember. Working memory: a bounded, decaying store that tracks what stays in cognitive focus.
- **Identity** — How to behave. Perspective (role and expertise) and constitution (values and constraints). Placeholders for Wave 2.

Each domain exports blocks, helpers, and resource definitions. They compose with flow-state-dev primitives. A Thought Fabric block is a standard flow-state-dev block.

## Import Paths

Use subpath exports for tree-shaking:

```ts
import { filterRelevance, scoreSalience } from '@thought-fabric/core/attention'
import { workingMemoryCapture, workingMemoryContextFormatter } from '@thought-fabric/core/memory'
import { perspective, constitution } from '@thought-fabric/core/identity'
```

The memory domain has a dedicated subpath. For attention and identity, you can also import from the main package:

```ts
import { attention, memory, identity } from '@thought-fabric/core'
// attention.filterRelevance, memory.workingMemoryCapture, identity.perspective
```

The package depends on `@flow-state-dev/core`. Build core first if you hit type resolution issues.

## Naming Convention

Word order encodes the category:

| Pattern | Category | Example |
|---------|----------|---------|
| `workingMemory[Verb]` | Block or item | `workingMemoryCapture`, `workingMemoryObserve` |
| `[verb]WorkingMemory` | Helper (verb first) | `addWorkingMemory`, `evictWorkingMemory` |

`workingMemoryAdd` is a block you compose in a pipeline. `addWorkingMemory` is a helper you call on a resource ref. The inversion tells you which is which without checking docs.

## What's Shipped Today

**Memory domain** — Working memory is fully implemented. Capture block, observe/remember/tick blocks, helpers, resource, context formatter. Entries decay with power-law (ACT-R style) by default. See [Memory](./memory.md) for details.

**Attention domain** — `filterRelevance` (deterministic keyword-based relevance filtering) and `scoreSalience` (LLM-based salience scoring). Both are production-ready. See [Attention](./attention.md).

**Identity domain** — Placeholder types only. `perspective()` and `constitution()` throw "Not implemented" and will ship in Wave 2. See [Identity](./identity.md).

## Domain Overview

### Attention

Relevance and salience determine what the agent attends to. `filterRelevance` removes or annotates items below a threshold using keyword overlap heuristics. No LLM, fast, deterministic. `scoreSalience` uses an LLM to score items along configurable dimensions (goal relevance, recency, novelty, emotional weight). Use them together: filter first to cut noise, then score the survivors for ranking.

### Memory

Working memory is a session-scoped resource. Capacity defaults to 7 (Miller's number). Entries have importance and optional pins. Decay strategies: power-law (default), exponential, or none. The `workingMemoryCapture` block extracts memories via LLM, persists them, and advances the decay clock. Use `workingMemoryContextFormatter` in a generator's `context` array to inject active memories into prompts.

### Identity

Placeholders for how an agent interprets and constrains itself. `perspective` will define role and expertise. `constitution` will define values and constraints. Both influence behavior at interpretation time. Not implemented yet.
