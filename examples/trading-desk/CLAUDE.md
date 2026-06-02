# Trading Desk Example — Agent Guide

The trading-desk is a five-phase multi-agent flow that produces a structured
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
  resources.ts                   memosCollection + thesisSection + phase2Contributions
  capability.ts                  the tradingDesk capability — single import for every generator
  lib/                           app-level helpers and factories (no external IO)
    helpers.ts                   tickerDate / asDataBlock / memoLabel / attributedTools
    memo-writer.ts               defineMemoWriter — per-phase markWriting / markError / commit factory
    memo-setup.ts                defineMemoSetup — pre-create memo scaffolds per phase
    approach-generator.ts        createApproachGenerator — Phases 3–5 fast-model preamble
    format.ts                    shared prompt formatters (memo, debate, contributions)
    cache.ts                     process-wide TTL cache (getOrFetch)
    fixtures.ts                  loadFixture(tool, args)
    ticker-resolver.ts           pre-flight ticker probe
    discover.ts                  web-search → DiscoveryPayload shape
  providers/                     external API clients (stateless, throw on failure)
    finnhub.ts                   Finnhub fetch helpers
    yahoo.ts                     Yahoo Finance fetch helpers (quoteSummary + fundamentals-timeseries)
    yahoo-timeseries.ts          pure mapper: fundamentals-timeseries → 3 statements
    edgar.ts                     SEC EDGAR client (ticker→CIK lookup + companyfacts fetch)
    edgar-companyfacts.ts        pure mapper: us-gaap companyfacts → 3 statements
    web.ts                       homepage meta + web-search fallback
    xai.ts                       Grok (xAI) credentials + model id
  phase-1/
    index.ts                     phase1Pipeline (the sub-sequencer)
    analyst.ts                   defineAnalyst — per-analyst sub-sequencer factory
    analysts.ts                  the nine analyst sub-sequencers (9 × ~10 lines via defineAnalyst)
    setup.ts                     setupPhase1Memos (defineMemoSetup)
    writer.ts                    Phase-1 markWriting / commitMemo / markError (defineMemoWriter)
    prompts.ts                   per-analyst system prompts
    thesis-schema.ts             Thesis output shape (shared by all 5 analyst generators + writer)
    tools/                       one file per tool (get_balance_sheet.ts, etc.)
      schemas.ts                 shared zod schemas + ToolName / ToolInput / ToolOutput
      empty-payloads.ts          schema-valid zeros for "unavailable" results
      indicators-math.ts         pure RSI/MACD/ATR/SMA functions
      get_*.ts                   one per tool — mode branch + provider chain
      index.ts                   barrel re-export
  phase-2/                       (same shape — setup.ts + writer.ts + generators.ts + round-robin.ts)
  phase-3/                       (single trader — trader.ts owns its output schema)
  phase-4/                       (3 personas + risk-assessment consolidator)
  phase-5/                       (scenario forecaster + PM — two stages; each generator owns its output schema)
fixtures/<TICKER>/2026-05-06/    pinned snapshot for fixture mode
```

### Conventions enforced by this layout

- **Factories live in `lib/`.** `defineMemoWriter`, `defineMemoSetup`, and
  `defineAnalyst` (the last one is phase-1-specific, in `phase-1/analyst.ts`)
  capture the shapes every phase repeats. Each phase's `setup.ts` and
  `writer.ts` is now ≤ 15 lines + the per-phase commit projections.
- **Single-consumer output schemas live next to the generator that emits
  them.** `phase-3/trader.ts` and `phase-5/portfolio-manager.ts` declare
  their output schemas inline; the writer imports the type back. Multi-
  consumer schemas (Phase 1's `thesisOutputSchema`, Phase 4's persona +
  risk-assessment schemas) stay in a `*-schema.ts` / `schemas.ts` file.
- **`providers/` is for external API clients only.** Stateless,
  throw-on-failure modules with no caching (callers wrap with
  `getOrFetch` from `lib/cache.ts`).
- **`lib/` is for everything that's neither identity (`agents.ts`),
  contract (`resources.ts`, `state.ts`, `flow-schema.ts`), capability,
  nor phase code.** Helpers, factories, formatters, stateless utilities.

## Adding a new generator

**Structured-output agents in Phases 3–5 are wrapped with an approach
preamble.** Each such agent has a sibling `<agent>ApproachGenerator`
built via `createApproachGenerator()` in
`lib/approach-generator.ts` and inserted before the structured
generator in its step sequencer. Use the factory — don't hand-roll a
new `generator({...})` for a preamble.

Every generator in this example uses the `tradingDesk` capability for model
selection + ticker/date context. The minimum scaffold:

```ts
import { generator } from "@flow-state-dev/core";
import { tradingDesk } from "../capability";

export const myGenerator = generator({
  name: "my-generator",
  itemVisibility: { client: true, history: false }, // or { client: true, history: true } if it should emit speak rows
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
[`capability.ts`](src/flows/trading-desk/capability.ts).

### Adding a Phase 1 analyst

Each analyst is one `defineAnalyst({ shortName, tools, generator })` call.
The factory captures the universal recipe: `markWriting → .map(tickerDate)
→ .parallel(attributedTools) → generator → commitMemo, rescue(markError)`.
The call site supplies only what varies — the role's tools and its
synthesis generator. See [`phase-1/analysts.ts`](src/flows/trading-desk/phase-1/analysts.ts)
for the nine existing analysts.

To add another:

1. Add the agent to `AGENTS` and `PHASE_1_MEMO_KEYS` in `agents.ts`.
2. Add a new `discover_<role>_context.ts` tool if it needs web discovery,
   plus any role-specific `get_*` tools.
3. Write the generator (output `thesisOutputSchema`).
4. Call `defineAnalyst({...})` in `analysts.ts`.
5. Wire it into `phase-1/index.ts`'s `.parallel({...})`.

### Adding a phase setup or writer

Two factories collapse the per-phase boilerplate:

- `defineMemoSetup({ phaseId, agentTeam, keys, activePhase })` in
  `lib/memo-setup.ts` — pre-creates the phase's memos in `pending`. The
  memoStatus seed is derived from `Object.keys(keys)` so adding a new
  memo to a phase is a one-line edit to `agents.ts`.
- `defineMemoWriter({ phaseId, agentTeam, keys, errorMessageFallback,
  errorTextPlaceholder? })` in `lib/memo-writer.ts` — returns
  `{ markWriting, markError, defineCommit }`. Each phase's `writer.ts`
  destructures `markWriting` and `markError`, then calls
  `writer.defineCommit({ shortName, inputSchema, project, afterCommit? })`
  for each commit handler. `project` returns the patch applied on top of
  the standard `status: "published" / completedAt / errorMessage: null`
  fields; `afterCommit` runs any phase-terminal session-state work (Phase
  5 uses it to flip `runComplete`).

### The `investigate` preset

Phase 1 analysts opt into investigative search/fetch with
`tradingDesk.presets({ investigate: true })`. The preset exposes the
`fetch` tool and the `<investigation>` clause only on `costPreset ===
"full"`; on `fast` both are absent and the prompt suppresses the
`<investigation>` tag entirely (the resolver returns `null`, not `""`).
Each analyst also wires a deterministic discovery tool
(`discover_*_context`) into its parallel data fan-out. The discovery
tools self-gate at the body level — they short-circuit to
`skippedDiscoveryPayload` before any provider call when the preset isn't
full. Two coordinated seams, same key, no leakage.

The citation contract — every claim traces to either a `<data>` field
or a URL the analyst actually fetched, and fetched URLs go in the
`citations` array — is enforced by the prompt clauses, not by runtime
validation. Body-section "Sources" is the v1 surface; inline `[n]`
markers are intentionally deferred.

If you have **costPreset-conditional** content (heavier context only on
`full`), list the `*Full` variant of the preset alongside the always-on
ones. The gating lives inside the preset — the context formatter renders
an empty string when `costPreset !== "full"`, but the resource and the
prompt tag still wire up statically. The call site stays flat:

```ts
uses: [
  tradingDesk.presets({
    investmentThesis: true,    // always on
    phase1MemosFull: true,     // empty render on `fast`, populated on `full`
    phase2DebateFull: true,    // ditto
  }),
],
```

Available `*Full` variants today: `phase1MemosFull`, `phase2DebateFull`,
`riskCritiquesFull`. Each one declares the same resources as its
always-on counterpart, so generators don't need to mirror those on their
own `resources:` slot. Add a new variant when you want a different
preset to participate in the cost gate.

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

**Phase 2's bull/bear debate is the canonical `roundRobin()` demo in this
example.** It uses the pattern's distinguishing features: `terminateWhen`
drives the round count from session state (`maxDebateRounds`),
`uses: [tradingDesk]` resolves the model from `costPreset`, and the two
researcher slots share a single transcript via the contributions accessor.
No referee.

Two conventions when using `roundRobin()` in this example:

1. **Always set `accessorKey` explicitly.** Default `"contributions"` collides
   when multiple round-robins coexist in the same flow. Phase 2 uses
   `accessorKey: "p2Contributions"`.

2. **Declare the contributions resource in `phase-N/contributions.ts`.**
   Importers (the round-robin instance, the capability, the consolidator)
   all pull from there. This keeps the phase's import graph cycle-free
   (see BP-019).

**Phase 4 deliberately does NOT use `roundRobin()`.** It's a plain
sequencer chain — `aggressiveStep.step(conservativeStep).step(neutralStep)`
— even though the prose framing ("three risk officers in round-robin
order") sounds like the pattern. None of `roundRobin()`'s features
apply here:

- `maxRounds` would be `1` (no debate cycling).
- No synthesizer / referee.
- The roster is heterogeneous — the neutral persona has its own output
  schema, so the slots aren't interchangeable.
- The personas don't read a shared transcript; they pull prior critiques
  from the structured persona memos (`memos/p4/{aggressive,conservative}-risk`)
  via per-generator `context` entries. The memo audit trail is the
  richer source — using `roundRobin()` here would force every persona
  through an adapter that flattens the structured output to free-form
  text, then read that text back instead of the typed fields.

Reintroducing `roundRobin()` for Phase 4 would require a `deriveRiskGoal`
input adapter, a `toContributionShape` output adapter on every persona, a
contributions resource, and a debate-transcript capability preset — all
of them with no consumer. Keep it a plain chain.

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
   the shape — names match `fixtureFileName(tool)`). The Phase 1 file set
   includes `insider-transactions.json` (90 days of Form 4 rows for the
   news analyst).
3. The framework needs no other registration.

## Live mode

Live mode wires Finnhub → Yahoo → FRED → Polymarket as the upstream
providers, plus the `fetch` tool from `@flow-state-dev/tools` for article
bodies, plus Grok (xAI) for social sentiment when `XAI_API_KEY` is set.
Required environment variables:

```
FINNHUB_API_KEY=...      # finnhub.io — fundamentals snapshot, prices, news, insider transactions
FRED_API_KEY=...         # research.stlouisfed.org — macro indicators
XAI_API_KEY=...          # xai — Grok-backed social sentiment via xSearch (optional)
```

Polymarket, Yahoo Finance, and SEC EDGAR don't require keys.

The three financial statements (`get_balance_sheet` / `get_income_statement`
/ `get_cashflow`) source from **SEC EDGAR XBRL companyfacts first, then Yahoo
`fundamentals-timeseries`, then empty payload**. EDGAR is the authoritative
US-filing source and answers even when Yahoo throttles its unauthenticated
endpoint (a 200-with-no-data response the Yahoo mapper detects and treats as a
miss). Non-US tickers have no EDGAR CIK and fall through to Yahoo. Statement
fields are nullable: a field a provider doesn't report reads `null`
(unobserved), never `0` — extends the nullable-PE discipline (FIX-692) to the
statements. The legacy Yahoo `*History` quoteSummary modules were dropped:
they returned zero-filled statements in current Yahoo responses.

`get_social_sentiment` is the only Phase 1 tool that routes between a
handler and a generator. Fixture and unavailable are handlers; the
live-Grok path is a generator with the `xSearch` provider tool installed.
The dispatch primitive is a `router` (block kinds differ across routes —
the rest of the Phase 1 tools use `if` inside a handler because every
branch is the same kind). See
[`phase-1/tools/get_social_sentiment.ts`](src/flows/trading-desk/phase-1/tools/get_social_sentiment.ts)
as the canonical example of a router-with-LLM-route pattern.

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
