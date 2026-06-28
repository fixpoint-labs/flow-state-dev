# Best Practices — Resources & State

Situational BPs for resource definitions, collections, state schemas, client
projection, caching, and isolation. Load this file when defining or editing
resources, collections, or tool-block caching.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-015: Prefer `expose` / `exclude` over hand-rolled `data` projections

- Status: Active
- Date: 2026-05-11
- Scope: Resources — client projection.
- Rule:
  - To project a resource/collection's state to clients, use `expose: [...]` (whitelist) or `exclude: [...]` (blacklist). Reserve `data: (state) => ({...})` for computed fields not on the state schema.
  - One of the three per resource — never combine (`defineResource` / `defineResourceCollection` throw at definition time otherwise). Omit all three for the full state (the identity default).

### BP-019: Resource refs live in dedicated leaf modules

- Status: Active
- Date: 2026-05-13
- Scope: Resources — module layout.
- Rule:
  - Every `defineResource()` call and resource-factory invocation lives in a dedicated resource leaf module — a `*-resource.ts` file, or a shared `resources.ts` when several refs share one home.
  - That module imports only from `@flow-state-dev/core`, `@flow-state-dev/patterns`, `zod`, and other leaf utilities. **Never** from logic files (generators, sequencers, round-robin instances, writers).
  - Capabilities and cross-agent consumers import resource refs from the resource module, not from logic files that re-export them — otherwise a capability ↔ generator ↔ resource cycle breaks at first use.

### BP-020: Live mode never silently falls back to fixture data

- Status: Active
- Date: 2026-05-13
- Scope: Flows — live vs fixture data.
- Rule:
  - When a flow supports `dataSource: "fixture"` and `"live"`, the live path must never silently substitute fixture data when a provider fails or lacks a tool.
  - On total failure, return an empty schema-valid payload tagged with a `source: "unavailable"` sentinel — the analyst LLM sees explicit zeros/empty arrays and treats the field as missing signal, not bearish/bullish.
  - Surface the provenance in the UI (transcript pill / status indicator) so coverage gaps are visible.

### BP-021: Tool blocks declare `cacheable` deliberately

- Status: Active
- Date: 2026-05-18
- Scope: Tool blocks — caching.
- Rule:
  - Opt into `cacheable` only for a deterministic read of state that won't move underneath the run, or an expensive idempotent computation whose inputs fully determine its output.
  - Do **not** cache: state-mutating tools (a cached "write succeeded" lies on the second call); time/randomness/external-mutation–dependent reads not captured in the inputs (use a short `ttl` only when staleness has bounded blast radius); tools whose observable side effect on the transcript is the point.
  - Default `scope: "run"`. `"request"` when sibling boards in one request benefit; `"session"` only with a concrete reason.
  - Pair with a `cacheIf` guard when the same input legitimately yields both cacheable and non-cacheable results (cache only the stable one). Cache is the cost channel; `flowPolicy` (the ledger) is the information-sharing channel — don't conflate them.

### BP-023: Resource state schemas use `.nullable().default(null)` so callers can pass partials

- Status: Active
- Date: 2026-05-20
- Scope: Resources — state schemas.
- Rule:
  - Every nullable field on a resource state schema is `.nullable().default(null)`, not bare `.nullable()`. Creation/reset paths then supply only the non-nullable scaffold and let the framework's `safeParse` fill the rest — no parallel "blank state" helper or per-call-site `field: null` lists.
  - For "reset on re-run" where prior state must not bleed through, use `setState(schema.parse({...minimal}))`, not `patchState` (which merges).
  - Applies to resource state schemas only — not generator outputs (those follow BP-016: no `.default()` reachable from a generator output).

### BP-027: User-scoped resources default to shared (`flowIsolation` off); isolate only deliberately

- Status: Active
- Date: 2026-06-05 (updated 2026-06-06, FIX-735)
- Scope: Resources — flow isolation.
- Rule:
  - Leave `flowIsolation` unset/`false` on user-scoped resources unless there is a deliberate privacy reason. Do NOT reflexively set `flowIsolation: true` as a "safe default" — it blocks legitimate cross-flow reads for no benefit.
  - `flowIsolation` is honored per resource (FIX-735): a `false` resource keys at bare `{userId}` even when a sibling sets `true`. The flow-level `isolateUserState` / `isolateOrgState` is only the default for resources that don't declare their own, plus the key for the scope's own `state` blob.
  - Practical test: if a second flow must read this resource without a client bridge, it MUST be `flowIsolation: false` (or unset) on both sides.

### BP-033: Filter at the source before you load — don't list-then-discard

- Status: Active
- Date: 2026-06-27
- Scope: Data access in resource/store code — collections, lazy stores, queries.
- Rule:
  - Push the predicate to the data source. Never load a whole collection / table / key-prefix into memory just to filter most of it away — narrow first, load only what survives.
  - FSD lazy collections: resolve one resource by URI by checking static refs first, then `getOptional` on the single matching collection — don't `list()` every collection and filter. To enumerate opt-in resources (e.g. `llmReadable`), filter collections by config *before* `list()`.
  - Add a regression test asserting the bulk load (`list()` / full scan) is not run on data the operation shouldn't touch.
