---
sidebar_position: 2
---

# Configuration

`system()` takes a single config object. Every tier is optional. The factory composes the requested tiers into a unified capture pipeline, recall helper, and context formatter.

```ts
import { system } from "@flow-state-dev/patterns/memory";

const mem = system({
  model: "openai/gpt-4o-mini",
  working: { capacity: 7, decay: { strategy: "power-law", rate: 0.5 } },
  episodic: { scope: "user", significanceThreshold: 0.6 },
  semantic: { consolidation: { episodicThreshold: 5 } },
  digest: { maxTokens: 400, topN: { facts: 30, episodes: 10 } },
});
```

Tier dependencies are validated at construction: semantic requires episodic, digest requires semantic. Working-only is allowed.

## Tier configuration

### `working`

Session-scoped recent observations with a salience-decay model. The capacity controls how many entries are retained before eviction; the decay strategy controls how salience falls off as new turns arrive.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `capacity` | `number` | `7` | Max entries retained before eviction (Miller's number) |
| `maxPinnedSlots` | `number` | `2` | How many entries can be pinned against eviction |
| `decay.strategy` | `"power-law" \| "exponential" \| "none"` | `"power-law"` | How salience falls off with elapsed turns |
| `decay.rate` | `number` | `0.5` | Tunes the decay curve |

### `episodic`

User-scoped past sessions stored as encoded `Episode` records. Pass `true` for defaults or an object to override.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `"user" \| "org"` | `"user"` | Persistence scope for episodes |
| `significanceThreshold` | `number` | `0.6` | Minimum importance for an item to be encoded as an episode |
| `maxEpisodes` | `number` | `200` | Cap on retained episodes |

### `semantic`

User-scoped consolidated facts. The system runs an LLM consolidation pass periodically to extract durable facts from recent episodes.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `"user" \| "org"` | inherited from episodic, else `"user"` | Persistence scope for facts |
| `consolidation.episodicThreshold` | `number` | `5` | Run consolidation after N new episodic entries |
| `consolidation.onEviction` | `boolean` | `true` | Also consolidate when persistent items are evicted from working memory |
| `consolidation.minInterval` | `number` | framework default | Don't consolidate more than once per N turns |
| `pruneThreshold` | `number` | `20` | Prune when fact count reaches this; `0` disables |

Consolidation runs an LLM call; budget for the latency. If you want it off the hot path, drive `mem.consolidate` from a scheduled action instead of the capture pipeline.

### `digest`

User-scoped rolling summary regenerated periodically. The digest is the cheapest thing to surface in the prompt — it's a static blob the agent reads, not a search target.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxTokens` | `number` | `400` | Hard cap on the regenerated digest |
| `topN.facts` | `number` | `30` | Top-N semantic facts (by reinforcement count) fed to regeneration |
| `topN.episodes` | `number` | `10` | Top-N recent-and-significant episodes fed to regeneration |

## Capability presets

`mem.capability` exposes presets for each contribution. Toggle them when wiring into a block:

```ts
generator({
  // Default: digest + working context + recall tool
  uses: [mem.capability],
});

generator({
  // No tool — context-only
  uses: [mem.capability.presets({ recall: false })],
});

generator({
  // No context, no tool — capability still installs resources
  uses: [
    mem.capability.presets({ digest: false, working: false, recall: false }),
  ],
});
```

Default-on presets: `digest`, `working`, `recall`. Off by default: `episodic`, `semantic` context entries (the recall tool covers them; turn them on to also auto-inject).

## Per-tier capabilities

When you want a single tier without the unified system — for example, a pre-prompt step that only needs working memory — the per-tier capabilities ship standalone:

```ts
import { workingMemoryCapability } from "@flow-state-dev/patterns/memory";

generator({
  uses: [workingMemoryCapability],
});
```

The same applies for `episodicMemoryCapability`, `semanticMemoryCapability`, and `digestMemoryCapability`. Mix them when you need a non-default combination without going through `system()`.

## Standalone working memory

For the "I just want a working memory buffer with no observer" case, skip the unified capture and use `workingMemoryCapture` directly. It's a parallel pipeline with its own observer schema and runs independently of the system's unified observer.

```ts
import { workingMemoryCapture, workingMemoryResource } from "@flow-state-dev/patterns/memory";

const capture = workingMemoryCapture({ model: "openai/gpt-4o-mini" });
```

See the [overview](./overview) for the unified path and [recall-tool](./recall-tool) for agent-invocable retrieval.
