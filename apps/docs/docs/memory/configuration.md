---
sidebar_position: 2
---

# Configuration

`system()` takes a single config object. Every tier is optional, and the factory composes whichever tiers you ask for into a single capture pipeline, recall helper, and context formatter. You won't need every knob on day one. Start with the defaults and tighten things as you learn what your agent forgets.

```ts
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7, decay: { strategy: "power-law", rate: 0.5 } },
  episodic: { scope: "user", significanceThreshold: 0.6 },
  semantic: { consolidation: { episodicThreshold: 5 } },
  digest: { maxTokens: 400, topN: { facts: 30, episodes: 10 } },
});
```

Tier dependencies are validated when you call `system()`: semantic requires episodic, digest requires semantic. Working-only is allowed. If you wire something inconsistent, you'll hear about it at construction, not at runtime.

## Tier configuration

### `working`

Session-scoped recent observations with a salience-decay model. `capacity` controls how many entries stick around before older ones get evicted. The decay strategy controls how salience falls off as new turns arrive, so you can tune how aggressively the agent "forgets" what happened a few turns ago.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `capacity` | `number` | `7` | Max entries retained before eviction (Miller's number) |
| `maxPinnedSlots` | `number` | `2` | How many entries can be pinned against eviction |
| `decay.strategy` | `"power-law" \| "exponential" \| "none"` | `"power-law"` | How salience falls off with elapsed turns |
| `decay.rate` | `number` | `0.5` | Tunes the decay curve |

### `episodic`

User-scoped past sessions stored as encoded `Episode` records. Pass `true` for defaults, or an object when you want to override individual fields. The threshold is the dial worth thinking about: too low and you encode noise, too high and important moments slip past.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `"user" \| "org"` | `"user"` | Persistence scope for episodes |
| `significanceThreshold` | `number` | `0.6` | Minimum importance for an item to be encoded as an episode |
| `maxEpisodes` | `number` | `200` | Cap on retained episodes |

### `semantic`

User-scoped consolidated facts. Periodically, the system runs an LLM consolidation pass over recent episodes to extract durable facts the agent should keep.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `"user" \| "org"` | inherited from episodic, else `"user"` | Persistence scope for facts |
| `consolidation.episodicThreshold` | `number` | `5` | Run consolidation after N new episodic entries |
| `consolidation.onEviction` | `boolean` | `true` | Also consolidate when persistent items are evicted from working memory |
| `consolidation.minInterval` | `number` | framework default | Don't consolidate more than once per N turns |
| `pruneThreshold` | `number` | `20` | Prune when fact count reaches this; `0` disables |

Consolidation runs an LLM call, so budget for the latency. If you don't want that on the hot path of a user turn, drive `mem.consolidate` from a scheduled action instead of the capture pipeline.

### `digest`

User-scoped rolling summary that gets regenerated periodically. The digest is the cheapest thing to surface in the prompt: a static blob the agent reads, not a search target. If you want one always-on memory surface and nothing else, this is the one to keep.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxTokens` | `number` | `400` | Hard cap on the regenerated digest |
| `topN.facts` | `number` | `30` | Top-N semantic facts (by reinforcement count) fed to regeneration |
| `topN.episodes` | `number` | `10` | Top-N recent-and-significant episodes fed to regeneration |

### `hygiene`

Time-based maintenance for the semantic and episodic stores. On by default. Decays the confidence of stable facts as time-since-reinforcement grows, and applies durability-based TTLs to episodic episodes. See [Hygiene](./hygiene) for the full picture and how to tune it.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `hygiene` | `HygieneConfig \| true \| false` | `true` | Pass `false` to revert to pre-hygiene behavior (no decay, unbounded growth) |

## Capability presets

`mem.capability` exposes presets for each contribution, so you can dial in exactly what gets injected into a given block:

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

Default-on presets: `digest`, `working`, `recall`. Off by default: `episodic` and `semantic` context entries. The recall tool covers them already; turn the context entries on when you also want them auto-injected each turn.

## Per-tier capabilities

Sometimes you want a single tier without the full unified system. A pre-prompt step that only cares about working memory, for example. Each tier ships as a standalone capability for that case:

```ts
import { workingMemoryCapability } from "@flow-state-dev/memory";

generator({
  uses: [workingMemoryCapability],
});
```

The same applies to `episodicMemoryCapability`, `semanticMemoryCapability`, and `digestMemoryCapability`. Mix them when you need a non-default combination and don't want to route through `system()`.

## Standalone working memory

For the "I just want a working memory buffer with no observer" case, skip the unified capture and use `workingMemoryCapture` directly. It's a parallel pipeline with its own observer schema, and it runs independently of the system's unified observer.

```ts
import { workingMemoryCapture, workingMemoryResource } from "@flow-state-dev/memory";

const capture = workingMemoryCapture({ model: "openai/gpt-5.4-mini" });
```

See the [overview](./overview) for the unified path and [recall-tool](./recall-tool) for agent-invocable retrieval.
