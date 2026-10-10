---
sidebar_position: 2
---

# Configuration

Two entry points share the same tier configuration: `createMemoryCapability` builds the capability surface, and `system()` builds that capability plus the auto-capture and lifecycle pipeline. Whichever you pick, the tier configs below are identical. You won't need every knob on day one — start with the defaults and tighten things as you learn what your agent forgets.

Flow, runtime, and environment knobs that are not memory-specific sit next to those concepts in Core. The [Configuration map](/docs/configuration/overview) is the index.

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

Tier dependencies are validated at construction by both entry points: semantic requires episodic, digest requires semantic. Working-only is allowed. If you wire something inconsistent, you'll hear about it when you build, not at runtime.

## Choosing an entry point

| Need | Reach for |
|------|-----------|
| Read side: context block, recall tool, typed helpers | `createMemoryCapability` |
| Read side **plus** auto-capture, consolidation, prune, hygiene | `system()` |

Both accept the same tier configs below. `system()` builds `createMemoryCapability` internally and exposes it as `mem.capability`, so the read surface is identical — `system()` just adds the pipeline that writes new observations back into the tiers.

## `createMemoryCapability` options

`createMemoryCapability(options)` returns the composed capability with the resource maps you register at the flow level. Install it on a generator with `uses: [mem]` and spread its resources into the flow:

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { createMemoryCapability } from "@flow-state-dev/memory";

const mem = createMemoryCapability({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

generator({ uses: [mem] });

defineFlow({
  kind: "reader",
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: { /* ... */ },
});
```

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string \| string[]` | Model id (or fallback chain) for the recall tool's filter call. Required. |
| `working` | `WorkingMemorySystemConfig \| true` | Working tier config. Required; `true` for defaults. |
| `episodic` | `EpisodicMemoryConfig \| true` | Episodic tier. Omit to disable. |
| `semantic` | `SemanticMemoryConfig \| true` | Semantic tier. Omit to disable. Requires episodic. |
| `digest` | `DigestSystemConfig \| true` | Digest tier. Omit to disable. Requires semantic. |
| `tool` | `MemoryToolConfig` | Recall-tool strategy and defaults. |
| `hygiene` | `HygieneConfig \| true \| false` | Only the `confidenceDecay` slice applies here — it drives recall ranking. Janitor scheduling belongs to `system()`. |

The result is a `DefinedCapability` with `sessionResources` (always `workingMemory` + `memorySystem`), `userResources` (the configured user-scoped tiers), `tiers` (the per-tier capabilities), and `recallToolBlock` attached. For type-safe resource registration use `sessionResources` / `userResources` — the resource references travel with the capability, so the same `defineResource()` reference is used everywhere.

## `system()` options

`system()` accepts every field above plus the capture-pipeline knobs below, and returns the full `MemorySystem` — the capability (`mem.capability`), the capture pipeline (`mem.capture`, `mem.captureFromItems`), consolidation, prune, and the janitor.

| Field | Type | Description |
|-------|------|-------------|
| `consolidationModel` | `string \| string[]` | Model override for the consolidation generator. Defaults to `model`. |
| `pruneModel` | `string \| string[]` | Model override for the prune generator. Defaults to `model`. |
| `source` | `(input, ctx) => string` | Custom source function — overrides reading from `ctx.session.items`. |
| `maxAssistantChars` | `number` | Max chars of the assistant response captured per turn. Default `500`. |
| `name` / `inputSchema` | — | Optional naming and input schema for the capture pipeline. |
| `evaluator` | evaluator block | Optional. Asks one question before the observer runs: is anything in the new messages worth remembering? Usually `captureEvaluator("<model>")`. See [Deciding which turns to observe](#deciding-which-turns-to-observe). |

### Deciding which turns to observe

Every turn you capture runs the observer, a model call that reads the new messages and pulls
out anything worth keeping. In a chatty agent most turns hold nothing ("ok", "thanks", "try
that again"), and the observer runs anyway.

You can put an evaluator in front of it. An evaluator is a block that asks a model a question
with known answers and gets a typed answer back ([Evaluator](/docs/fundamentals/blocks#evaluator)). Memory
ships the question and a helper that builds the block; you choose the model:

```ts
import { system, captureEvaluator } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: true,
  episodic: true,
  evaluator: captureEvaluator("typesafe-ai/jev"),
});
```

The evaluator needs an evaluation model: a model that picks among fixed answers instead of
writing text ([Evaluation models](/docs/fundamentals/models#evaluation-models)). `typesafe-ai/jev`
is Jev, served through Vercel's AI Gateway. An ordinary chat model string like
`openai/gpt-5.4-mini` is not an evaluation model: through the gateway, the capture fails with an
error saying it's a language model. For OpenAI, pass `openai.evaluationModel("gpt-5.4-mini")`
from `@ai-sdk/openai` instead.

On each capture, the evaluator reads the same new messages the observer would and answers
`remember` or `skip`.

- **`remember`**: the observer runs on those messages, exactly as it does without an evaluator.
- **`skip`**: the observer doesn't run and nothing is written. The messages count as read, so
  no later capture looks at them again.
- **An error** (the evaluation model is down, or refuses the call): the capture fails the way an
  observer failure does. The messages stay unread, and the next capture that succeeds picks them
  up. An evaluator error never falls back to running the observer.

A skip is final, so a model that skips too eagerly loses facts. Try it on a sample of your real
conversations before you turn it on. It pays off when most turns are skips: a turn it marks
`remember` costs one evaluator call on top of the observer.

Memory ignores any confidence score the model returns.

Leave `evaluator` out and every captured turn runs the observer. You don't need to install an
evaluation model or provider to use memory.

#### Building the evaluator yourself

`captureEvaluator` is a shortcut for core's `evaluator` block with memory's question,
`captureQuestions`. Build the block yourself when you want to change its name or other
settings, then pass it the same way:

```ts
import { evaluator } from "@flow-state-dev/core";
import { captureQuestions } from "@flow-state-dev/memory";

const worthRemembering = evaluator({
  name: "memory-gate",
  model: "typesafe-ai/jev",
  questions: captureQuestions,
});
```

If you modify `captureQuestions`, keep its key and its `remember`/`skip` options. Otherwise the
capture fails with an error saying the evaluator did not answer the "capture" question with
"remember" or "skip", and telling you to build it with `captureQuestions`.

## Tier configuration

These configs apply to both entry points.

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
| `flowIsolation` | `boolean` | follows `isolateUserState` / `isolateOrgState` | `true` keeps episodes per flow, `false` shares them across flows. See [Sharing a tier across flows](#sharing-a-tier-across-flows) |
| `significanceThreshold` | `number` | `0.6` | Minimum importance for an item to be encoded as an episode |
| `maxEpisodes` | `number` | `200` | Cap on retained episodes |

### `semantic`

User-scoped consolidated facts. Periodically, the system runs an LLM consolidation pass over recent episodes to extract durable facts the agent should keep.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scope` | `"user" \| "org"` | inherited from episodic, else `"user"` | Persistence scope for facts |
| `flowIsolation` | `boolean` | follows `isolateUserState` / `isolateOrgState` (not inherited from episodic) | `true` keeps facts per flow, `false` shares them across flows. See [Sharing a tier across flows](#sharing-a-tier-across-flows) |
| `consolidation.episodicThreshold` | `number` | `5` | Run consolidation after N new episodic entries |
| `consolidation.onEviction` | `boolean` | `true` | Also consolidate when persistent items are evicted from working memory |
| `consolidation.minInterval` | `number` | framework default | Don't consolidate more than once per N turns |
| `pruneThreshold` | `number` | `20` | Prune when fact count reaches this; `0` disables |

Consolidation runs an LLM call, so budget for the latency. If you don't want that on the hot path of a user turn, drive `mem.consolidate` from a scheduled action instead of the capture pipeline.

Semantic memory also has an opt-in `relations` knob that stores typed connections between entities alongside facts. It's off by default; see [Relations](./relations) for when and how to enable it.

### `digest`

User-scoped rolling summary that gets regenerated periodically. The digest is the cheapest thing to surface in the prompt: a static blob the agent reads, not a search target. If you want one always-on memory surface and nothing else, this is the one to keep.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxTokens` | `number` | `400` | Hard cap on the regenerated digest |
| `topN.facts` | `number` | `30` | Top-N semantic facts (by reinforcement count) fed to regeneration |
| `topN.episodes` | `number` | `10` | Top-N recent-and-significant episodes fed to regeneration |

The digest has no `flowIsolation` of its own, because it summarizes episodes and facts. It is kept per flow copy when either `episodic` or `semantic` sets `flowIsolation: true`, shared across flows only when both set `false`, and follows the flow's default otherwise. So a flow's isolated episodes never reach another flow's digest.

### `hygiene`

Time-based maintenance for the semantic and episodic stores. On by default. Decays the confidence of stable facts as time-since-reinforcement grows, and applies durability-based TTLs to episodic episodes. See [Hygiene](./hygiene) for the full picture and how to tune it.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `hygiene` | `HygieneConfig \| true \| false` | `true` | Pass `false` to revert to pre-hygiene behavior (no decay, unbounded growth) |

### Sharing a tier across flows

Episodic, semantic and digest memory live at user (or org) scope, so by default they follow the flow's own setting: shared by every flow on the server for that user, or kept to the flow when it sets `isolateUserState: true` (`isolateOrgState` at org scope). See [Sharing State Across Flows](/docs/advanced/flow-isolation) for what those flags do.

`flowIsolation` on the `episodic` or `semantic` config overrides that default for one tier:

- **`true`**: the tier is kept per flow copy (each flow registered on the server, or each named copy of a collection flow), even when the flow doesn't isolate its user or org state.
- **`false`**: the tier is shared by every flow for that user (or org), even when the flow sets `isolateUserState: true`.
- **Omitted**: the tier follows the flow's `isolateUserState` / `isolateOrgState`.

A chief-of-staff flow that keeps its user state to itself might keep its own episodes but read and add to the facts the person's other flows share:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: true,
  episodic: true,                       // follows isolateUserState: kept to this flow
  semantic: { flowIsolation: false },   // shared with the person's other flows
});

defineFlow({
  kind: "coordinator",
  isolateUserState: true,
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: { /* ... */ },
});
```

The reverse works too: leave the flow shared and set `episodic: { flowIsolation: true }` to keep one flow's episodes out of the others. Each tier is set on its own, so `semantic` doesn't pick up the `flowIsolation` you give `episodic`. Working memory is per session and has no `flowIsolation`.

The per-tier capability factories take the same field, as in `createEpisodicMemoryCapability({ scope: "user", flowIsolation: true })`, and so do `createSemanticMemoryCapability` and `createDigestMemoryCapability`. The resource factories take it in an options argument (`MemoryResourceOptions`): `createEpisodicMemoryResource("user", { flowIsolation: true })`, the same for `createDigestMemoryResource`, and as the third argument of `createSemanticMemoryResource(scope, relations, options)`. Composing tiers by hand this way skips the digest rule above, so give the digest `flowIsolation: true` whenever either source is isolated.

## Capability presets

`mem.capability` exposes presets for each contribution, so you can dial in exactly what gets injected into a given block:

```ts
generator({
  // Default: digest + working context + recall tool
  uses: [mem.capability],
});

generator({
  // No tool — context-only
  uses: [mem.capability.with({ recall: false })],
});

generator({
  // No context, no tool — capability still installs resources
  uses: [
    mem.capability.with({ digest: false, working: false, recall: false }),
  ],
});
```

Default-on presets: `digest`, `working`, `recall`. Off by default: `episodic` and `semantic` context entries. The recall tool covers them already; turn the context entries on when you also want them auto-injected each turn.

A generator that declares its own `tools:` list is a different case: that list is the complete set of tools the model may call, so the recall preset adds nothing to it. Name the tool yourself, `tools: [lookupOrder, mem.tool.recall()]`, or leave `tools:` off the generator. See [Tools a capability contributes](../fundamentals/capabilities#capability-tools).

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
