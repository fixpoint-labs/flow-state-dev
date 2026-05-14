# Trading Desk Example — Agent Guide

The trading-desk is a four-phase multi-agent flow that produces a structured
trade recommendation for a given ticker. It's a working example of how to put
a non-trivial flow together with capabilities, services, per-tool files, and
fixture/live data modes.

When modifying this example, follow the conventions below. The patterns here
are also written up in the project-level docs — read those first if you
haven't:

- [`docs/contributing/best-practices.md`](../../docs/contributing/best-practices.md) — hard rules (BP-001 through BP-020)
- [`docs/contributing/building-apps.md`](../../docs/contributing/building-apps.md) — patterns and tradeoffs
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) — capability model

## Layout

```
src/flows/trading-desk/
  flow.ts                        flow definition (actions, resources, session state)
  state.ts                       sessionStateSchema (ticker, date, costPreset, dataSource, ...)
  agents.ts                      AGENTS map + per-phase memo key registries
  resources.ts                   memosCollection + thesisSection schema (shared across phases)
  memo-writer.ts                 markWriting / commitMemo / markError taps (Phase 1)
  services/
    cache.ts                     process-wide TTL cache (getOrFetch)
    fixtures.ts                  loadFixture(tool, args)
    finnhub.ts                   Finnhub fetch helpers
    yahoo.ts                     Yahoo Finance v3 fetch helpers
    format.ts                    shared prompt formatters (memo, debate, contributions)
    trading-desk-capability.ts   the tradingDesk capability — single import for every generator
  phase-1/
    index.ts                     phase1Pipeline (the sub-sequencer)
    analysts.ts                  defineAnalyst factory + the four analyst sub-sequencers
    setup.ts                     setupPhase1Memos (pre-creates memo resources)
    prompts.ts                   per-analyst system prompts
    thesis-schema.ts             Thesis output shape shared with memos
    resources.ts                 (none yet — phase-1 doesn't add its own resources)
    tools/                       one file per tool (get_balance_sheet.ts, etc.)
      schemas.ts                 shared zod schemas + ToolName / ToolInput / ToolOutput
      empty-payloads.ts          schema-valid zeros for "unavailable" results
      indicators-math.ts         pure RSI/MACD/ATR/SMA functions
      get_*.ts                   one per tool — mode branch + provider chain
      index.ts                   barrel re-export
  phase-2/                       (same shape)
  phase-3/
  phase-4/
fixtures/<TICKER>/2026-05-06/    pinned snapshot for fixture mode
```

## Adding a new generator

Every generator in this example uses the `tradingDesk` capability for model
selection + ticker/date context. The minimum scaffold:

```ts
import { generator } from "@flow-state-dev/core";
import { tradingDesk } from "../services/trading-desk-capability";

export const myGenerator = generator({
  name: "my-generator",
  agentType: "sub",                          // or "primary" if it should emit speak rows
  agentName: AGENT_KEYS.someAgent.agentName,
  uses: [tradingDesk],                       // model + ticker + date come from here
  prompt: MY_SYSTEM_PROMPT,
  user: "Now write the X.",                  // short, declarative; no concatenated sections
  outputSchema: myOutputSchema,
});
```

If your generator needs additional context (memos, debate transcripts, etc.),
opt into the relevant presets:

```ts
uses: [tradingDesk.presets({
  phase1Memos: true,
  investmentThesis: true,
})],
```

See the capability's available presets in
[`services/trading-desk-capability.ts`](src/flows/trading-desk/services/trading-desk-capability.ts).

If you have **costPreset-conditional** content (heavier context only on
`full`), use a dynamic `uses` entry:

```ts
uses: [
  tradingDesk.presets({ investmentThesis: true }),                       // always on
  (ctx: { session: { state: { costPreset?: string } } }) =>
    ctx.session.state.costPreset === "full"
      ? ([tradingDesk.presets({ phase1Memos: true, phase2Debate: true })] as const)
      : ([] as const),
] as const,
```

Note the `as const` and the explicit `(ctx: ...) =>` type — both are needed
because TypeScript widens otherwise. **Resources required by the dynamic
entry must be declared on the block's `resources:` slot directly** —
dynamic `uses` only contribute context and tools (see
[capabilities.md](../../docs/architecture/capabilities.md#dynamic-uses-entries)).

## Adding a new tool

Tools follow the per-tool-file pattern. Each tool file owns its mode
branch, provider preference, and fallback chain.

```ts
// phase-1/tools/get_my_tool.ts
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../../services/cache";
import { loadFixture } from "../../services/fixtures";
import { fetchFromProviderA } from "../../services/providerA";
import { emptyPayload } from "./empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "./schemas";

export const get_my_tool = handler({
  name: "get_my_tool",
  description: "...",
  inputSchema: toolInputSchemas.get_my_tool,
  outputSchema: toolOutputSchemas.get_my_tool,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_my_tool", input);
    return getOrFetch("get_my_tool", input, async () => {
      try { return await fetchFromProviderA(input); } catch {}
      return emptyPayload("get_my_tool", input);
    });
  },
});
```

Then:

1. Add the tool's input/output schemas to `phase-N/tools/schemas.ts` (both
   `toolInputSchemas` and `toolOutputSchemas`, plus the file-name mapping
   for fixture loading).
2. Add an empty-payload builder to `phase-N/tools/empty-payloads.ts`.
3. Re-export from `phase-N/tools/index.ts`.
4. Add to the appropriate analyst's `tools: [...]` list in
   `phase-N/analysts.ts`.
5. Add a curated fixture JSON under
   `fixtures/<TICKER>/2026-05-06/<tool-file-name>.json` so fixture mode
   still works.

If the tool needs a new external API, add its fetch helper to a new
`services/<provider>.ts` file (one per provider). Keep it stateless — read
keys from env, throw on any failure, no caching (the tool handler wraps the
call with `getOrFetch`).

## Round-robin patterns

Round-robin instances (Phase 2 bull/bear debate, Phase 4 risk debate) use
the `roundRobin()` pattern from `@flow-state-dev/patterns`. Two conventions
for this example:

1. **Always set `accessorKey` explicitly.** Default `"contributions"` collides
   when multiple round-robins coexist in the same flow. Trading-desk uses
   `accessorKey: "p2Contributions"` for Phase 2 and `accessorKey:
   "p4Contributions"` for Phase 4.

2. **Declare the contributions resource in `phase-N/resources.ts`.** Importers
   (the round-robin instance, the capability, the consolidator) all pull
   from there. This keeps the phase's import graph cycle-free
   (see BP-019).

## Fixture mode

Fixtures are a single pinned snapshot at `2026-05-06` (the
`FIXTURE_SNAPSHOT` constant in
[`services/fixtures.ts`](src/flows/trading-desk/services/fixtures.ts)). The
loader ignores `args.date` and always reads from the snapshot directory. The
returned payload carries the fixture's own `asOf` field, so analysts see the
actual data date.

When adding a new ticker to fixture coverage:

1. Create `fixtures/<TICKER>/2026-05-06/`.
2. Drop in one JSON per tool (see existing `fixtures/NVDA/2026-05-06/` for
   the shape — names match `fixtureFileName(tool)`).
3. The framework needs no other registration.

## Live mode

Live mode wires Finnhub → Yahoo → FRED → Polymarket as the upstream
providers, plus the `fetch` tool from `@flow-state-dev/tools` for article
bodies. Required environment variables:

```
FINNHUB_API_KEY=...      # finnhub.io — fundamentals, prices, news
FRED_API_KEY=...         # research.stlouisfed.org — macro indicators
```

Polymarket and Yahoo Finance don't require keys.

If a live provider fails for a given tool, the tool returns an empty payload
tagged `source: "unavailable"` (see BP-020). It does **not** fall back to
fixture data — that would silently corrupt analyst reasoning. The transcript
pill marks the result `UNAVAILABLE`; the analyst is prompted to treat it as
missing signal, not bearish.

## Running and testing

```bash
pnpm --filter @flow-state-dev/example-trading-desk dev          # Next.js dev server
pnpm --filter @flow-state-dev/example-trading-desk typecheck    # tsc --noEmit
pnpm --filter @flow-state-dev/example-trading-desk test         # vitest run
```

The test suite is offline — every live provider is mocked, every analyst
generator is mocked. Tests verify wiring (resources, memo transitions,
sequencer composition) rather than LLM behavior.
