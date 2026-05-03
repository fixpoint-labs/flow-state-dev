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

### BP-001: Canonical authority precedence

- Status: Active
- Date: 2026-02-15
- Rule:
  - If docs conflict, `preperation/architecture/*` is authoritative.
  - Planning docs and wave docs must reference canonical architecture sources.
- Why:
  - Prevents drift between wave execution and architecture contracts.

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

- Status: Active
- Date: 2026-02-15
- Rule:
  - Each wave must maintain wave-local artifacts (`docs/waves/wave-1/wave-1.<letter>-journal.md`, `docs/waves/wave-1/wave-1.<letter>-changelog.md`).
  - Each wave must also add a concise summary entry to root `changelog.md`.
- Why:
  - Wave-local docs preserve detail; root changelog preserves project-level continuity.

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
