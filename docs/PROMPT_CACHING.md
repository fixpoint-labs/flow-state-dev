# Prompt Caching

Prompt caching reduces per-call cost and latency by reusing the large, stable parts of a request across turns — primarily the system prompt, tool definitions, and injected skill context. `@flow-state-dev/core` wires this in so every generator call gets it by default.

This document covers the audit that preceded the current design, the runtime behaviour, and how to opt in or out.

## TL;DR

- A `caching` config field on `generator()` controls prompt-cache behaviour.
- Default: `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`.
- The AI SDK adapter emits the right marker flavour for the detected provider:
  - **Anthropic** (and OpenRouter, which proxies to Anthropic) — stamps `providerOptions.anthropic.cacheControl` on the last system message when the cacheable prefix is large enough.
  - **Vercel AI Gateway** — opts into `providerOptions.gateway.caching: 'auto'` and lets the gateway decide where to place markers.
  - **OpenAI / Google / DeepSeek** — no-op. Those providers cache implicitly.
- Cache token counts (`cacheReadInputTokens`, `cacheCreationInputTokens`) are surfaced on `GeneratorModelUsage` and in the DevTool.

## Audit — state before this change

Before this work, no call path in the framework emitted a cache breakpoint. The generator block resolved a generic `providerOptions` dict and passed it straight through to `generateText` / `streamText`. That means every Anthropic call re-billed the full system + tools + history prefix on every turn, with zero cache hits.

Call paths inspected:

| Call path | Location | Cache marker? |
|-----------|----------|---------------|
| `generator()` | `packages/core/src/blocks/generator.ts` | No |
| `utility.*` (analyzer, summarizer, classifier, router, advisor, etc.) | `packages/core/src/utility/*.ts` | No — all build on top of `generator()` |
| `@flow-state-dev/skills` context injection | `packages/skills/src/context-fn.ts` | No — composed through `generator()` |
| `@flow-state-dev/patterns` (supervisor, plan-and-execute, blackboard, reactive blackboard, etc.) | `packages/patterns/src/*.ts` | No — all use the generator block |
| Kitchen-sink app, hello-chat example | `apps/kitchen-sink`, `examples/hello-chat` | No |

The only place `providerOptions` was set intentionally was the `thinking-*` presets, which enabled Anthropic extended thinking via `providerOptions.anthropic.thinking`. That unblocked thinking without interacting with caching.

Telemetry infrastructure was already in place:

- `BlockTraceItem.modelUsage.cacheReadTokens` / `cacheCreationTokens` were defined (`packages/core/src/items/types.ts`).
- The sequencer and server both extracted those values from `providerMetadata.anthropic` (`packages/core/src/blocks/sequencer.ts`, `packages/engine/src/execution/executeBlock.ts`).
- Pricing estimation understood the Anthropic cache-read and cache-write rates (`packages/core/src/adapters/model-lookup.ts`).
- The DevTool displayed aggregated and per-call cache stats (`apps/devtool/src/components/detail/token-usage-summary.tsx`).

The whole pipeline was ready. The only missing piece was a call path that actually produced a cache hit.

## Design

### Generator-level config

Generator blocks accept a `caching` field alongside `providerOptions`:

```ts
generator({
  name: "assistant",
  model: "anthropic/claude-sonnet-4-6",
  prompt: LARGE_SYSTEM_PROMPT,
  caching: {
    enabled: true,           // default true
    breakpoints: "auto",     // default "auto" | "manual"
    ttl: "5m",               // default "5m" | "1h"
  },
});
```

Semantics:

- `enabled: false` — no cache markers are emitted, regardless of provider.
- `enabled: true, breakpoints: 'auto'` — adapter decides breakpoint placement per provider.
- `enabled: true, breakpoints: 'manual'` — the caller sets `cacheControl` themselves via `providerOptions`; the adapter passes everything through untouched.
- `ttl` is the Anthropic ephemeral tier. `5m` is cheaper to create; `1h` costs more per write but survives longer between calls.
- `caching` also accepts a function of `(input, ctx)` so the decision can be per-call.

### Adapter translation

Translation lives in `packages/core/src/models/caching.ts` and is invoked from `buildAiSdkRequest` in `createAiSdkModelResolver.ts`. Provider family is detected from the AI SDK language model's `provider` property:

- `anthropic.*` — auto mode stamps `{ providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl } } } }` on the **last system message**. Anthropic applies the marker cumulatively, so that single breakpoint caches tools + system together — the most stable prefix.
- `openrouter.*` — same treatment as Anthropic. OpenRouter proxies `cache_control` unchanged for Anthropic models.
- `gateway.*` — sets `providerOptions.gateway.caching: 'auto'`. The gateway handles provider-specific marker placement, so we don't double-mark.
- Anything else — no-op. OpenAI, Google, and DeepSeek cache implicitly and the AI SDK doesn't accept an explicit knob.

#### Threshold

Anthropic requires a cacheable prefix of ~1024 tokens (2048 for Haiku). Below that the API silently ignores `cacheControl` and any write costs are wasted. The adapter estimates the combined system + tools size by character count (~4 chars/token heuristic) and skips marking when the combined prefix is under 4096 chars.

#### User markers always win

Auto mode is conservative: if the caller has already placed `cacheControl` on the target message (via their own `providerOptions`), the adapter leaves it alone. The same guarantee applies to `providerOptions.gateway.caching` when routing through a gateway.

### Skills-aware prefix ordering

The generator assembles messages in this order:

1. Base system prompt (`{ role: 'system', content: prompt }`)
2. Context entries — including skill context (`withSkills` → `buildActiveSkillsContext`) and auto-generated tool descriptions
3. History (from `history: true`, `history: { limit: ... }`, or a custom slot)
4. Current-turn user input

The cache breakpoint lands on the last system-role message, which is the tail of the prefix above. Because skill context is part of that prefix, it's covered by the cache when it's stable across turns (same matched skill set). When the matched skill set changes, the cache invalidates naturally — that's the correct behaviour.

Tools are passed to the AI SDK in a separate slot. Anthropic's cumulative marker placement means the breakpoint on the last system message caches tools along with the system prefix.

### Telemetry

`GeneratorModelUsage` now carries optional `cacheReadInputTokens` and `cacheCreationInputTokens`. The AI SDK adapter extracts them from either:

- `providerMetadata.anthropic.cacheReadInputTokens` / `cacheCreationInputTokens` (Anthropic's canonical surface), or
- the AI SDK usage counters — `usage.inputTokenDetails.cacheReadTokens` / `cacheWriteTokens` on AI SDK 7, with the older aggregated `usage.cachedInputTokens` still read as a fallback.

Downstream consumers (sequencer, server executeBlock, DevTool) prefer the normalised usage fields and fall back to provider metadata so existing call paths keep working.

## Verifying a live Anthropic run

For real Anthropic calls, a request with the default caching config will produce a non-zero `cacheCreationInputTokens` on the first turn and a non-zero `cacheReadInputTokens` on subsequent turns with the same system prompt. You can inspect this live in the DevTool's token usage panel, or by checking `result.usage` on any generator return.

## Cost model

- **Cache write** — ~1.25× the input rate (Anthropic 5m tier). One-time cost.
- **Cache read** — ~0.1× the input rate. Applies on every hit after creation.
- **Break-even** — one read refunds the write premium. Every subsequent hit is pure savings.

For any generator whose system prompt is stable across turns — which is most of them — caching is strictly cheaper than not caching. Default-on is the right call.

## When to disable

- Prompts under ~1024 tokens — the threshold guard already skips marking here.
- Test flows that need deterministic per-call billing.
- Hot paths where you want to burn cache slots fresh each turn (rare).

```ts
generator({
  ...,
  caching: { enabled: false },
});
```

## Manual mode

For fine-grained control over breakpoint placement, use manual mode and set `cacheControl` yourself:

```ts
generator({
  ...,
  caching: { breakpoints: "manual" },
  providerOptions: {
    anthropic: {
      // your own breakpoint placement via AI SDK providerOptions on specific parts
    },
  },
});
```

In manual mode the framework never adds or modifies markers. Useful when you want breakpoints at multiple positions (e.g., end of history prefix for multi-turn agents) or when you need different TTLs on different parts.

## References

- Anthropic prompt caching docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Vercel AI SDK — Anthropic provider options: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
- Vercel AI Gateway — caching: https://vercel.com/docs/ai-gateway
