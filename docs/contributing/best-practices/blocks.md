# Best Practices — Blocks & Composition

Situational BPs for handlers, routers, sequencers, and how blocks are factored
and chained. Load this file when writing or refactoring block logic.
See [`../best-practices.md`](../best-practices.md) for the index and universal rules.

---

### BP-011: Handlers must not call blocks internally

- Status: Active
- Date: 2026-04-03 (broadened 2026-05-02 by FIX-503)
- Scope: Blocks — handlers and composition.
- Rule:
  - A handler block must not instantiate or call any block (handler, generator, sequencer, router) inside its `execute` body.
  - When a block needs another block's output and then acts on it, model it as a sequencer: upstream block as one step, consuming handler as the next.
  - Enforced at the type level: `BlockDefinition` exposes no `run`; `someBlock.run(input, ctx)` from a handler body is a TypeScript error. First-party substrate utilities that genuinely can't compose via sibling steps use `asRuntime(block).run(input, ctx)` and document the reason inline — the explicit `asRuntime` signs the deviation. Tests drive blocks with `runForTest(block, input, ctx)` from `@flow-state-dev/testing`.

### BP-012: Use `.tap()` for state-mutation-only blocks — never return input as passthrough

- Status: Active
- Date: 2026-04-08
- Scope: Blocks — state-mutation handlers.
- Rule:
  - When a block only mutates state (session, user, sequencer) and its output carries no information forward, chain it with `.tap()`, not `.step()`.
  - Such handlers must not declare `outputSchema` and must not `return input`.

### BP-013: Use `connectInput` / `connectOutput` inside the router, not on blocks directly

- Status: Active
- Date: 2026-04-09
- Scope: Routers.
- Rule:
  - When a router selects a block needing input transformation, transform inside the router's `execute` via `connectInput` — return `block.connectInput(() => transformedInput)` (closure over the router's `input`), not a pre-connected definition-time variant.
  - `connectInput` works on all block kinds including sequencers — no wrapper block; the full interface (`.step()`, `.tap()`, …) is preserved.
  - If a selected block's output shape doesn't match the router's output schema, adapt it with `connectOutput` on the block inside `execute`.
  - Pre-connecting at definition time is only for purpose-built reusable adapters whose input contract belongs to the block itself, not to a routing decision.

### BP-014: Handlers must never return input as output

- Status: Active
- Date: 2026-04-10
- Scope: Blocks — handlers.
- Rule:
  - A handler's `execute` must never `return input` verbatim — it pollutes the items log with redundant echoes.
  - No meaningful output → use `.tap()` (BP-012). Transforming input → return the transformation, not the original `input`.

### BP-024: Factor with helpers when the body varies; factor with factories when it doesn't

- Status: Active
- Date: 2026-05-23
- Scope: Composition — factoring sibling blocks.
- Rule:
  - **Identity-only** parameterization (body identical, only a key/name/lookup-target varies) → a **factory** that takes the identity and returns the block (e.g. key-driven `markWriting` / `markError`, `defineMemoSetup`).
  - **Scaffolding-only** sharing (body unique per instance — different projection/derivation/side effect) → a **helper function** the body calls into, NOT a factory that takes the body as a callback (e.g. a `publishMemo` helper + plain `handler()` calls).
  - **Shared config, varied body and identity** → `handler.withDefaults({...})` (partially-applied constructor; per-call overrides allowed).
  - Test: does the per-instance variation live in the callback parameter, or in things known at construction time? If the former, use a helper — a body-as-callback factory forces generic type-plumbing through the closure.

### BP-025: Declare and validate sequencer output schemas deliberately

- Status: Active
- Date: 2026-05-23
- Scope: Sequencers — output schemas.
- Rule:
  - Declare `outputSchema` on a sequencer when its composed output is consumed by something that depends on the shape (downstream block, flow action, client renderer). The framework validates the returned value against it on every exit path (tail, `exitIf`, `rescue`).
  - Call `.validate()` at build/setup time on any sequencer that declares `outputSchema` — it catches drift between the declared schema and the chain's inferred tail before the flow runs.
  - Omit `outputSchema` for internal/ephemeral sequencers (scratch pipelines, background fan-out) — there the validation is pure overhead.
  - `.validate()` is a conservative one-level structural check: deep shapes, refinements, brands, and union variants are out of scope, and it no-ops when the tail is erased by `stepAny` / `race` / `stepAll` / `branch`. The runtime gate still catches real mismatches; `.validate()` is the early warning, not the guarantee.

### Conditional composition: prefer step variants over wrapper sequencers

- Status: Active
- Scope: Blocks — conditional composition.
- Rule:
  - Use `.workIf(condition, connector, block)` — not a wrapper sequencer with `.stepIf` inside `.work()`.
  - Use `.tapIf(condition, block)` — not a gating handler that conditionally calls a block.
  - Use `.stepIf(condition, block)` — not a wrapper sequencer with a `.map` + `.step`.
  - All conditional variants accept an inline connector as a second argument for input adaptation; don't create an intermediate sequencer just to `.map()` before a block.
