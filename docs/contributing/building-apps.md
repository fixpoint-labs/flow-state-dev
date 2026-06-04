# Building Apps with `@flow-state-dev`

Patterns and tradeoffs for putting a flow-state app together, distilled from
the trading-desk app. This is taste-and-tradeoff guidance, not a rigid
rulebook — for hard rules see [`best-practices.md`](./best-practices.md).

## When to build a capability vs. inline

**Build a capability** when three or more generators share configuration —
model selection, common context (ticker/date/role), the same memo or
transcript dumps, the same provider options. Capabilities pay for themselves
quickly here.

**Stay inline** when the configuration is per-generator. A one-off context
function that reads a specific memo, a per-generator system prompt, a tool
list unique to one analyst — none of that belongs in a shared capability.

The trading-desk's `tradingDesk` capability hit the threshold easily: nine
generators across four phases share model selection and ticker/date context,
plus the heavy memo/contribution context bundles are reusable across
multiple consolidation steps. See
[`labs/trading-desk/src/flows/trading-desk/services/trading-desk-capability.ts`](../../labs/trading-desk/src/flows/trading-desk/services/trading-desk-capability.ts).

## When per-tool files beat a dispatch abstraction

For an app with N tools and M providers, the natural impulse is a single
`DataSource` interface and a per-provider class that implements it. That
makes sense when N × M is high and most tools have ≥2 providers — the
chain abstraction earns its keep.

For an app where most tools have one provider and only a few have a
fallback, per-tool files with explicit `try { } catch { }` are simpler.
The trading-desk: 8/10 tools have a single live provider, 2/10 have a
two-provider fallback. The earlier `DataSource` + `MultiSourceDataSource`
implementation required ~35 unsupported-method stubs (one per
tool-not-implemented combination) and an abstract dispatcher. The
per-tool-file rewrite was ~250 LOC smaller and each tool's
fallback story sits in one file.

## Service-layer convention

For HTTP backends and process-wide utilities, use a `services/` directory of
flat function modules:

- **`services/cache.ts`** — process-wide TTL cache (`getOrFetch(tool, args, fetcher)`). No `ctx`, no resources, no framework coupling.
- **`services/fixtures.ts`** — fixture loader (`loadFixture(tool, args)`).
- **`services/<provider>.ts`** — one file per upstream API (`finnhub.ts`, `yahoo.ts`, `fred.ts`). Each exports flat fetch functions; reads its API key from env; throws on any failure so tool handlers can `try { } catch { }` past it.

Services don't know about modes (fixture vs. live), don't know about caching,
don't know about the framework. Tool handlers and capabilities call services;
services are leaves in the import graph.

## Process-wide TTL cache vs. session-scoped resource

When data is universal (market prices, public APIs) and a second session
asking for the same ticker should reuse the first's fetch, use a process-wide
TTL cache. ~50 lines: a `Map<key, { value, expiresAt }>` plus an in-flight
Promise dedup map.

When data is per-user or session-specific (a draft document, a chat
history), use a session-scoped resource. The framework's resource system is
designed for this.

The trading-desk's first cut used a session-scoped resource for market-data
deduplication. That was over-architecting — every NVDA fundamentals fetch
ran once per session. Switching to a process-wide 120s TTL cache (see
[`labs/trading-desk/src/flows/trading-desk/services/cache.ts`](../../labs/trading-desk/src/flows/trading-desk/services/cache.ts))
let multiple sessions share warm fetches, dropped the cache plumbing
(`ctx.resources.marketdata`, the `marketDataCollection` definition, the flow
registration), and made the call sites cleaner.

## Fixture-mode hygiene

Pin fixtures to a single snapshot date directory and ignore `args.date` in
the loader. Otherwise the moment your UI's default date moves off the
snapshot day, every fixture lookup misses.

The trading-desk pattern:

```ts
// services/fixtures.ts
const FIXTURE_SNAPSHOT = "2026-05-06";
const FIXTURE_ROOT = path.resolve(process.cwd(), "fixtures");

export async function loadFixture<T extends ToolName>(
  tool: T,
  args: { ticker?: string; date: string }, // date ignored for path resolution
): Promise<ToolOutput<T>> {
  const filePath = path.join(
    FIXTURE_ROOT,
    args.ticker ?? "_macro",
    FIXTURE_SNAPSHOT,
    fixtureFileName(tool),
  );
  // ...
}
```

The returned payload still carries the fixture's own `asOf` field, so
analysts see the snapshot date in their reasoning — they're not being lied
to about when the data is from. If you ever add a second snapshot, the
constant becomes a `latestSnapshot()` helper that lists the directory and
picks the most recent.

## Source-tag provenance

When tools have multiple live providers (Finnhub, Yahoo, FRED, etc.) plus a
fixture mode, stamp the actual provider name on the tool output's `source`
field — not just `"fixture" | "live"`. This lets the transcript pill (and
analyst reasoning, if you want it to) distinguish "Yahoo answered" from
"Yahoo fallback didn't fire because Finnhub answered."

Useful sentinels:

- `"fixture"` — fixture-mode output.
- `"<provider>"` — one tag per live provider.
- `"unavailable"` — live mode, no provider could answer. Surfaces in the
  transcript with a muted pill and tells the analyst "treat this as missing
  signal." See BP-020 for why this matters.

## Next.js / Turbopack specifics

A few gotchas when the flow runs inside a Next.js app:

### `import.meta.url` is unreliable under Turbopack

Turbopack rewrites `import.meta.url` during server bundling, so a relative
walk from the file location can land inside `.next/` rather than the source
tree. **Anchor on `process.cwd()`** for filesystem paths in server code —
Next.js dev, Next.js build, and vitest all set `cwd` to the app's package
directory.

```ts
// Reliable
const FIXTURE_ROOT = path.resolve(process.cwd(), "fixtures");

// Fragile under Turbopack
const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../fixtures",
);
```

### Module-level `const` values are frozen at server start

```ts
// Bad — captured at module load. In a long-running Next.js server this
// stays whatever date the process started on, for every visitor across days.
const DEFAULT_DATE = new Intl.DateTimeFormat("en-CA").format(new Date());
```

Fix: wrap in a helper and use a lazy `useState` initializer so the value is
captured at first render of each mount:

```ts
function todayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

// Inside the component:
const [date, setDate] = useState(() => todayIsoDate());
```

Applies broadly to anything time-dependent at module scope (`new Date()`,
`Date.now()`, randomized IDs, locale formatting that drifts).

### HTML5 phrasing-content rules in transcript-like UIs

`<button>` only accepts phrasing content as children. `<div>` is block-flow
and produces invalid HTML when nested inside `<button>` — browsers parse it,
but the accessibility tree gets inconsistent across screen readers.

For clickable flex rows (a transcript row, a list item with a toggle), use
`<span className="flex ...">` for the row container. Tailwind's `flex` class
sets `display: flex` on any element, and `<span>` is valid phrasing content
inside a button.

```tsx
// Good
<button type="button" onClick={...}>
  <span className="flex items-center gap-2">
    <ChevronRight />
    <span>{label}</span>
  </span>
</button>

// Bad — div inside button
<button type="button" onClick={...}>
  <div className="flex items-center gap-2">
    <ChevronRight />
    <span>{label}</span>
  </div>
</button>
```
