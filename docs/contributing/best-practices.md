# Best Practices (Living)

Purpose:

- Capture implementation standards decided during planning/review.
- Keep decisions cumulative so future waves and agents follow the same bar.

Update policy:

- When user review establishes a new best practice, update this file in the same change set as the code/docs adopting it.
- Do not overwrite prior practices; append a new entry with status/date.
- If a practice is superseded, mark the old one `Superseded` and link the replacement entry.

---

## Active Practices

### BP-001: Documentation authority precedence

- Status: Active
- Date: 2026-02-15
- Rule:
  - If two in-repo docs conflict, the more specific reference wins (e.g. `docs/architecture/streaming.md` over a general statement in `overview.md`).
  - Planning docs and wave docs must reference the relevant `docs/architecture/<area>.md` file rather than restating contracts inline.
- Why:
  - Prevents drift between wave execution and architecture contracts, and keeps a single source of truth per concept.

### BP-002: Wave-driven execution

- Status: Active
- Date: 2026-02-15
- Rule:
  - Every implementation change must map to a wave task.
  - Each wave requires explicit deliverables and verification commands.
- Why:
  - Enables autonomous run-to-completion execution with predictable verification.

### BP-003: Verification evidence is mandatory

- Status: Active
- Date: 2026-02-15
- Rule:
  - Every claimed deliverable must have an evidence path and pass criteria.
  - Wave close-out requires a journal and changelog under `docs/waves/`.
- Why:
  - Eliminates ambiguous “done” states.

### BP-004: Public boundary first

- Status: Active
- Date: 2026-02-15
- Rule:
  - Prioritize package boundaries and contracts before runtime implementation details.
  - Early waves should lock import/export shape before behavior depth.
- Why:
  - Reduces rework and cross-package breakage in later waves.

### BP-005: Dual changelog requirement

- Status: Superseded (2026-05-19) by [BP-022: Release notes via Changesets](#bp-022-release-notes-via-changesets)
- Date: 2026-02-15
- Rule (historical):
  - Each wave must maintain wave-local artifacts (`docs/waves/wave-1/wave-1.<letter>-journal.md`, `docs/waves/wave-1/wave-1.<letter>-changelog.md`).
  - Each wave must also add a concise summary entry to root `changelog.md`.
- Why (historical):
  - Wave-local docs preserve detail; root changelog preserved project-level continuity pre-Changesets.
- Successor: BP-022 replaces the root-changelog half of this rule. Wave-local artifacts are no longer required.

### BP-006: Keep wave labels out of code and tests

- Status: Active
- Date: 2026-02-16
- Rule:
  - Use wave identifiers in planning and documentation artifacts only.
  - Do not reference wave labels (for example `wave 1.x`) in runtime code, package code comments, or test assertions/titles.
- Why:
  - Keeps implementation surfaces domain-focused and avoids coupling runtime artifacts to temporary execution planning labels.

### BP-007: Concise API and file-level documentation

- Status: Active
- Date: 2026-02-16
- Rule:
  - Add a concise file header comment to implementation files that explains the file's role in the runtime.
  - Document 100% of exported methods/functions/classes with concise doc comments focused on contract and behavior.
  - Document important internal helpers when they carry non-obvious control flow, state transitions, or error semantics.
  - Keep comments high-signal and short; avoid restating obvious syntax.
- Why:
  - Improves onboarding speed and reduces misunderstanding as runtime orchestration complexity grows.

### BP-008: Keep README onboarding-first and current

- Status: Active
- Date: 2026-02-16
- Rule:
  - `README.md` is the first-stop onboarding document for new developers and should focus on project purpose, objectives, key concepts, setup, package responsibilities, and core commands.
  - Process-specific collaboration protocol (for example wave execution rules) should live in `AGENTS.md`, not in `README.md`.
  - Update `README.md` in the same change set when onboarding-relevant facts change (new package/app, package responsibility changes, setup/command changes, or major architecture concept shifts).
- Why:
  - Keeps onboarding fast and accurate while preserving detailed process guidance in the right place for agent workflows.

### BP-009: Maintain package-level READMEs for public packages

- Status: Active
- Date: 2026-02-16
- Rule:
  - Maintain `README.md` in each public package directory (`packages/*`).
  - Package READMEs should document purpose, current public API surface, basic usage, and package-local verification commands.
  - Update a package README in the same change set when that package’s exported surface, runtime behavior, or setup scripts materially change.
- Why:
  - Reduces onboarding and integration friction by keeping package docs close to the code that owns each contract.

### BP-010: React component conventions

- Status: Active
- Date: 2026-03-10
- Rule:
  - **Prefer `useMemo` over `useEffect` for derived state.** If a value can be computed from props or other state, derive it with `useMemo` rather than syncing it through `useEffect` + `setState`. `useEffect` should be reserved for genuine side effects: subscriptions, DOM manipulation, data fetching, or synchronization with external systems.
  - **Comment every `useEffect`.** Each `useEffect` must have a brief comment above or inside the hook explaining *what* side effect it performs and *why* it exists. This applies even when the effect seems straightforward — the "why" is often non-obvious to the next reader.
  - **Comment non-obvious logic.** Code should be readable on its own, but when intent or reasoning isn't self-evident — complex conditions, non-trivial memoization dependencies, workarounds — add a concise comment explaining the *why*.
- Why:
  - `useMemo` is synchronous and deterministic — no extra render cycle, no stale intermediate state, no cleanup concerns. `useEffect` for derived state introduces unnecessary complexity and subtle timing bugs.
  - Mandatory `useEffect` comments prevent "mystery effects" that accumulate as components grow. Effects are the most error-prone part of React components; explaining their purpose makes bugs easier to spot during review.

### BP-011: Handlers must not call blocks internally

- Status: Active
- Date: 2026-04-03 (broadened 2026-05-02 by FIX-503)
- Rule:
  - A handler block must not instantiate or call any block (handler, generator, sequencer, router) inside its `execute` body.
  - When a block needs to produce another block's output and then act on it, model it as a sequencer with the upstream block as one step and the consuming handler as the next step.
- Enforcement (FIX-503):
  - `BlockDefinition` does not expose a `run` method. The substrate dispatch entry lives on `BlockRuntime.run` and is recovered at substrate boundaries via `asRuntime(block)`. `someBlock.run(input, ctx)` from a user handler body is a TypeScript error — the firewall lives at the type level.
  - First-party substrate utilities that genuinely cannot be expressed via sibling-step composition (e.g. dynamic worker dispatch by `task.assignee` in `dispatchAndExecuteBlock`, the classifier-bound input shape in `intentRouter`) reach for `asRuntime(block).run(input, ctx)` inside their handler bodies. The explicit `asRuntime` call signs the deviation in every diff. Document the reason inline.
  - Tests drive a block from test code with `runForTest(block, input, ctx)` from `@flow-state-dev/testing`.
- Why:
  - Every block kind has substrate-managed semantics: streaming, retry, tool loops, observability hooks, state snapshots, lifecycle traces. Calling a block from inside a handler bypasses all of these and makes the inner block invisible to the runtime — no devtools row, no checkpoint, no rescue. The sequencer / router / generator-tool composition primitives are the only sanctioned way to chain blocks.

### BP-012: Use `.tap()` for state-mutation-only blocks — never return input as passthrough

- Status: Active
- Date: 2026-04-08
- Rule:
  - When a block only mutates state (session, user, sequencer) and its output carries no meaningful information forward, chain it with `.tap()` instead of `.then()`.
  - Such handlers must not declare `outputSchema` and must not `return input` at the end of `execute`.
- Why:
  - Every block chained with `.then()` appends its output to the items log. Returning `input` as a passthrough pollutes the items log with redundant copies of data that carry no new information. Items should contain meaningful output — LLM responses, structured results — not echoes of prior state. State mutations are already observable through the state change log.
  - `.tap()` communicates intent clearly: this block runs for its side effects, the upstream data flows through unchanged.



### BP-013: Use `connectInput` and `connectOutput` inside the router, not on blocks directly

- Status: Active
- Date: 2026-04-09
- Rule:
  - When a router selects a block that requires input transformation, perform the transformation inside the router's `execute` function using `connectInput`, not by pre-connecting the block at definition time.
  - Return `block.connectInput(() => transformedInput)` (using closure over the router's `input`) rather than declaring a permanently-adapted variant of the block.
  - `connectInput` works natively on all block kinds including sequencers — no wrapper block is created; the full interface (`.then()`, `.tap()`, etc.) is preserved.
  - If a router's selected block produces output in a shape the router's output schema doesn't expect, use `connectOutput` on the selected block inside `execute` to adapt it.
  - Pre-connecting blocks at definition time (outside a router) is appropriate only when the block is purpose-built as a reusable adapter for a specific caller and the input contract belongs to the block itself, not to a runtime routing decision.
- Why:
  - Performing input adaptation inside the router keeps each block's schema generic and reusable. Pre-connecting forces an arbitrary caller's schema into the block definition, coupling it to one usage site.
  - Using closure over `input` inside `execute` avoids repeating the input type annotation — the router already knows it.
  - Returning a connected block from `execute` works cleanly with the router's route validation (matching is by name) and with `testRouter` (which uses `onRouteSelected` hooks, not object identity).

### BP-014: Handlers must never return input as output

- Status: Active
- Date: 2026-04-10
- Rule:
  - A handler's `execute` must never `return input` verbatim.
  - If the block produces no meaningful output, use `.tap()` (per BP-012).
  - If the block transforms input, return the transformation — not the original `input`.
- Why:
  - Returning `input` pollutes the items log with redundant echoes of data already present in prior items. Items should contain meaningful outputs (LLM responses, structured results), not passthrough copies. This is a generalization of BP-012: even when a handler is not state-mutation-only, echoing input as output is never correct behavior.

### BP-015: Prefer `expose` / `exclude` over hand-rolled `data` projections on resource client config

- Status: Active
- Date: 2026-05-11
- Rule:
  - For projecting a resource or collection's state to clients, prefer `expose: [...]` for a whitelist or `exclude: [...]` for a blacklist. Reserve `data: (state) => ({...})` for computed fields that aren't on the state schema.
  - One of the three per resource — never combine. `defineResource` and `defineResourceCollection` throw at definition time when more than one is set.
  - Omit all three when you want the full state — that's the identity default.
- Why:
  - Hand-rolled `data: (state) => ({ ... })` literals drift from the state schema as fields are added. `expose` is type-checked against `stateSchema` at build time and impossible to drift silently.
  - The identity default removes a footgun where `state.read: true` without a `data` projection returned the empty-looking `{ topic }` shape (bit trading-desk twice during Phase 2 development).

### BP-016: Generator outputSchemas must be OpenAI strict-compatible

- Status: Active
- Date: 2026-05-11
- Rule:
  - Generator `outputSchema` values must serialize to a JSON schema OpenAI's structured-output strict mode accepts.
  - Concretely:
    - **No `z.record()` on object roots or anywhere reachable from a generator output.** It serializes to `additionalProperties: true`, which strict mode rejects. Use a fixed-shape `z.object({...})` when the keys are known. When the keys are dynamic, use `z.array(z.object({ key: z.string(), value: z.string() }))` and convert to a `Record` at the writer seam.
    - **No `z.optional()` or `z.default()` on generator outputs.** They remove the key from the `required` set. Use `z.nullable()` (key stays required, value can be `null`).
    - **No `z.union([...])` of differently-shaped variants.** The variants produce conflicting `required` sets. Collapse to a single shape with nullable slots, or split into separate generators with their own schemas. Discriminated unions over differing shapes have the same problem.
  - Two examples in this repo:
    - Fixed-shape metrics: [`examples/trading-desk/src/flows/trading-desk/phase-2/thesis-schemas.ts`](../../examples/trading-desk/src/flows/trading-desk/phase-2/thesis-schemas.ts) (closed `z.object({ conviction, horizon, target, stop })`).
    - Array-of-pairs metrics for variable keys + the canonical nullable section shape: [`examples/trading-desk/src/flows/trading-desk/blocks/thesis-schema.ts`](../../examples/trading-desk/src/flows/trading-desk/blocks/thesis-schema.ts).
  - Authors can sanity-check a schema in a test: import `makeSchemaStrict` from `@flow-state-dev/core` and run the result through a walker that fails on the patterns above. The trading-desk example ships such a guard at [`examples/trading-desk/test/output-schemas-strict.spec.ts`](../../examples/trading-desk/test/output-schemas-strict.spec.ts) — copy it into any package that defines generator outputs.
- Why:
  - The framework calls `makeSchemaStrict()` internally before handing schemas to the AI SDK ([`packages/core/src/models/createAiSdkModelResolver.ts`](../../packages/core/src/models/createAiSdkModelResolver.ts)), but the helper only unwraps `optional` / `default` / `nullable` — it does not transform `record` or `union` patterns. Those bypass the framework's safety net and fail at first generator call against OpenAI strict mode, surfacing as opaque "Invalid schema for response_format" errors that are hard to diagnose without context.
  - Catching the bug at test time (via the strict-mode walker) is cheaper than catching it at runtime on a real API call, especially because the framework's `intent/*` fallback wraps the strict-mode error in a "All models in group failed" message that hides the root cause.
  - Phase 1 of the trading-desk example hit this bug three times in one day across three different schema patterns (record, optional, union) before BP-016 existed. The pattern is real and recurring.

### BP-017: Use the generator `context` slot for typed, segmented prompts

- Status: Active
- Date: 2026-05-13
- Rule:
  - Build prompts via the generator's `context: { tagName: fn }` slot, not via a hand-built multi-section `user:` string.
  - Each key becomes an XML tag the model can parse cleanly. Values resolve at render time with typed `ctx`, including session state and resources.
  - Reserve `user:` for the short trailing instruction ("Now write the published Bull memo.") rather than concatenated section dumps.
  - When the same key is contributed by multiple sources (the block's own `context` plus capabilities installed via `uses`), the framework aggregates them inside one tag — there's no name conflict.
- Why:
  - Hand-built user prompts duplicate boilerplate (`Ticker:`, `As-of date:`, role lines) across every generator. The trading-desk had ~8 generators all repeating the same 3-line preamble before BP-017 landed.
  - The `context` slot is type-checked against the session state schema and the capability surface. Hand-built strings drift silently when state shape changes.
  - Models handle XML-tagged context segmentation better than markdown headers buried in a long user message — empirically the same model produces tighter outputs when fields are tagged rather than concatenated. See [`examples/trading-desk/src/flows/trading-desk/services/trading-desk-capability.ts`](../../examples/trading-desk/src/flows/trading-desk/services/trading-desk-capability.ts) for the canonical pattern.

### BP-018: Shared prompt formatters live in `services/`

- Status: Active
- Date: 2026-05-13
- Rule:
  - When two or more blocks (across phases or within a phase) format the same shape of data into a prompt — memo blocks, transcript dumps, structured-field rollups — lift the formatter into a `services/format.ts` file (or equivalent service module) and import it from each consumer.
  - Phase-specific formatters used by only one block stay in that block's file; the bar is "two or more consumers."
- Why:
  - Inline copies drift. The trading-desk had three nearly-identical copies of `formatMemoBlock` across phase-2/3/4 before BP-018 — they diverged enough that one introduced a duplicate-heading bug that was caught only by a manual review.
  - One canonical formatter per data shape means one place to fix rendering tweaks, one place to enforce field ordering, one place to test.

### BP-019: Per-phase resources live in `phase-N/resources.ts`

- Status: Active
- Date: 2026-05-13
- Rule:
  - All `defineResource()` calls and resource-factory invocations (e.g., `createRoundRobinContributions()`) for a phase live in a single `phase-N/resources.ts` leaf module.
  - That file imports only from `@flow-state-dev/core`, `@flow-state-dev/patterns`, `zod`, and other leaf utility files. **Never** imports from the phase's own logic files (generators, sequencers, round-robin instances, writers).
  - Capabilities and cross-phase consumers import resource refs from `phase-N/resources.ts`, not from logic files that happen to re-export them.
- Why:
  - When a capability needs a resource ref defined in a phase's `round-robin.ts`, and that `round-robin.ts` also imports the phase's generators, and those generators import the capability — you get a cycle that breaks at first use with `Cannot read properties of undefined`. The trading-desk hit this exactly during the FIX-589 refactor.
  - Resources are pure data — singleton refs with no runtime dependencies on the phase's logic. Putting them in a leaf module makes the import graph clean by construction.
  - Naming the file `resources.ts` instead of inventing a name per resource keeps the convention obvious. Every phase has one; importers know where to look.

### BP-020: Live mode never silently falls back to fixture data

- Status: Active
- Date: 2026-05-13
- Rule:
  - When a flow supports both `dataSource: "fixture"` and `dataSource: "live"` modes, the live path must never silently substitute fixture data when an upstream provider fails or doesn't implement a tool.
  - On total failure, return an empty schema-valid payload tagged with a `source: "unavailable"` sentinel (or equivalent provenance signal). The caller — typically an analyst LLM — sees explicit zeros / empty arrays and should treat the field as missing signal, not as bearish/bullish.
  - Surface the provenance in the UI (transcript pill, status indicator) so a human review can spot coverage gaps.
- Why:
  - Hand-curated fixture data is dated and ticker-specific. Serving it as if it were live silently corrupts the LLM's reasoning — the analyst thinks it just got NVDA's Q1 fundamentals and writes a memo around them, when in reality the live API failed and a year-old fixture filled in.
  - "No data" is a recoverable signal the LLM can reason about ("I'm missing fundamentals for this ticker, so I'll lean on technicals and macro"). "Wrong data labeled as right data" is not recoverable.
  - The trading-desk used a fixture floor in its first multi-provider implementation and the resulting analyst memos cited fixture numbers as if they were live for two days before anyone noticed. The empty-payload-with-sentinel pattern landed in FIX-589 to prevent recurrence.

### BP-021: Tool blocks declare `cacheable` deliberately

- Status: Active
- Date: 2026-05-18
- Rule:
  - Opt a tool block into `cacheable` only when the call is functionally a deterministic read of state that won't move underneath the run, or an expensive idempotent computation whose inputs fully determine its output. Examples: reading an artifact by key, resolving a config value, looking up a fixture record, fetching an immutable file by hash.
  - Do **not** declare `cacheable` on:
    - Tools that mutate state (writes, deletes, status changes). A cached "write succeeded" is a lie on the second call.
    - Tools whose result depends on time, randomness, or external mutation not captured in their input arguments. A cached "get current price" returns yesterday's price. Use a short `ttl` only when staleness has bounded blast radius; prefer no cache when the cost of being wrong is high.
    - Tools whose output the worker needs to observe happening (e.g. a tool whose side-effect on the transcript is the point — a "show user" tool that suppresses on cache hit is broken).
  - Default to `scope: "run"`. Reach for `"request"` when sibling boards within the same request would benefit; reach for `"session"` only with a concrete reason — session lifetimes are long, and stale entries are hard to reason about across turns.
  - Pair `cacheable` with a `cacheIf` guard when the same input legitimately produces both cacheable and non-cacheable outputs (e.g. a fetch that returns either a stable document or an error envelope as a successful return value — cache only the document).
- Why:
  - Errors are never cached and identical in-flight calls in the same request coalesce to one execution, so opting in is safe for the common deterministic-read case — but those guarantees don't cover the tool's correctness model. A cached mutating tool corrupts state; a cached time-sensitive read corrupts reasoning. Both fail silently and only surface on the second call.
  - The wrong default is "cache everything that's expensive." Cost reduction is real but is bought with stale-data risk. Make the call per tool, not per package.
  - Cross-task observation flow (`flowPolicy`) records every tool call regardless of cacheability — the ledger is the substrate's information-sharing channel, the cache is its cost-reduction channel. They're independent. Don't reach for `cacheable` to make a tool's results visible to other workers; reach for the right `flowPolicy` instead.

### BP-022: Release notes via Changesets

- Status: Active
- Date: 2026-05-19
- Rule:
  - Every PR with user-facing impact (new/changed public API, capability, block, CLI command, hook, env var, config key, or behavior end users observe) includes a `.changeset/*.md` fragment listing every affected publishable package.
  - Pre-1.0 discipline: select `patch` for non-breaking changes and `minor` for new capabilities or breaking changes. Do not use `major` — a `major` changeset against a `0.x.y` package bumps to `1.0.0`, and Changesets has no built-in pre-1.0 mode. If you believe a breaking change warrants `major`, raise it in the PR and a maintainer will decide.
  - Internal-only changes (refactors, test-only edits, internal helpers, infra) do not need a changeset. Run `pnpm changeset --empty` and commit the resulting empty fragment, or state "no changeset needed" in the PR description.
  - Do not edit a root `changelog.md`. None exists. Per-package `CHANGELOG.md` files are generated by `pnpm version-packages`.
- Why:
  - Eliminates the merge-conflict cost of editing a single root file per PR.
  - Produces release-shaped per-package CHANGELOGs that ship with npm artifacts.
  - Locks the launch story before first publish, so contributors form the habit pre-1.0.
  - The pre-1.0 `major` discipline prevents a premature `1.0.0` bump that would signal stability the packages haven't earned and burn the breaking-change budget before the API surface has settled.
- See: [`docs/contributing/release-notes-workflow.md`](release-notes-workflow.md)
- Supersedes: BP-005

## Template For New Entries

```md
### BP-XXX: <Name>

- Status: Active | Superseded
- Date: YYYY-MM-DD
- Rule:
  - ...
- Why:
  - ...
- Superseded by: BP-YYY (optional)
```
