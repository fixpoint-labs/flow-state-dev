---
name: fsd:tdd
description: Test-driven development for FSD blocks, patterns, capabilities, and flows using a strict red-green-refactor loop with vertical (tracer-bullet) slices. Use when building a new block / pattern / capability / flow, fixing a bug, or any time the user mentions "red-green-refactor", "TDD", "tracer bullet", or "test-first".
---

# Test-Driven Development

## Philosophy

Tests verify behaviour through the public interface, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public surfaces. A good test reads like a behavioural specification — `"handler emits a block_output item with status: failed when the upstream fetch errors"` tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, assert on call counts, peek at private state, or check artefacts in storage instead of going through the interface. Warning sign: the test breaks when you rename an internal function even though the observable behaviour didn't change.

See [tests.md](tests.md) for FSD-flavoured good/bad examples, and [mocking.md](mocking.md) for where the mock seams actually are in this codebase.

## Two kinds of test, two different jobs

FSD development uses **CI specs** and **goal checks**. They answer different questions and neither substitutes for the other.

| | CI spec (`*.spec.ts`) | Goal check (`goals/<describe>/<it>/run.mts`) |
|---|---|---|
| Question it answers | "Does this unit still behave?" | "Did we actually achieve the real-world goal?" |
| LLM | Mocked (`mockGenerator`) | **Real model** |
| Stores | In-memory | Real where the goal depends on it |
| Runs in CI | Yes — over and over, every push | **No** — excluded from CI |
| Run by | CI | The agent (you), by hand, to validate the work |
| Determinism | Required | Not expected — assert on the goal, not exact strings |

**CI specs keep their mocks.** They run hundreds of times; a real model call there would be slow, flaky, and expensive. `mockGenerator` + in-memory stores are correct for the fast loop. Everything in [mocking.md](mocking.md) about mocking only at system boundaries still applies to specs.

**Goal checks prove the thing was actually built.** A mocked spec can pass while the feature does nothing useful, because the mock fed the assertion the answer it wanted. That is the failure mode the user is worried about: green tests, broken goal. The goal check removes the crutch — real model, real path, assert on the observable outcome that *is* the goal. You run it during development to confirm you reached the goal before declaring the work done. It is development-time proof, not committed coverage, and it does not gate CI.

### Writing a goal check

1. **State the goal as an observable outcome.** Not "add a summarizer block" — "given a 2,000-word document, the flow emits a message item whose content is a faithful 3-bullet summary of it." The goal is the real effect a user would care about, phrased so success is checkable.
2. **Name how you'll know you got there.** The pass/fail signal: an item emitted, a state value written, a return value, a downstream side effect. It has to be checkable without reading the model's mind — assert on structure and grounded facts (the summary mentions the document's actual subject), not on exact phrasing.
3. **Exercise the real path.** Default mechanism is `fsdev run <flow> <action> -i '{...}'` against a **real** model (see AGENTS.md → "Verifying flow changes"), capturing NDJSON with `--capture` to assert against. For non-flow goals, the goal's `run.mts` calls the public API directly (e.g. `runAction`) — the `goals` workspace package resolves the deps. Real LLM, real stores where the goal depends on them. Mock only true third-party services (payment, email) you genuinely cannot call.
4. **Make the verdict explicit.** The check prints PASS/FAIL on the goal, with the evidence it inspected. An LLM running it later should be able to read the output and know whether the goal holds without re-deriving the criteria.

Placement and naming: goals live in the root **`goals/` library** — `goals/<describe>/<it>/` (both kebab-case: `<describe>` is the subject, `<it>` completes "it …"), holding `goal.md` (the contract — Outcome / Input / Signal / **Anti-game** / Model / Run / verdict log), `run.mts` (the runner), and `fixtures/`. Copy `goals/_template/`. **`goals/README.md` is authoritative** — read it before adding a goal. `run.mts` lives outside any package's vitest root, so CI never runs it; run one with `pnpm tsx goals/<describe>/<it>/run.mts`. Keep goal checks cheap to re-run, but do not gate CI on them and do not let a passing CI suite stand in for a goal check that was never run.

## Anti-pattern: horizontal slices

**Do NOT write all tests first, then all implementation.** This is horizontal slicing — treating RED as "write all the specs" and GREEN as "write all the code." It produces unreliable tests:

- Tests written in bulk test *imagined* behaviour, not *actual* behaviour
- You end up asserting on the *shape* of things (schema fields, type signatures, ZodObject keys) rather than on observable behaviour
- Tests become insensitive to real changes — they pass when behaviour breaks and fail when behaviour is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**This anti-pattern is especially lethal in FSD.** Block specs are deceptively easy to write before the block exists: you can fill a `*.spec.ts` with `expect(result).toMatchObject({...})` assertions that look like coverage but actually only test ZodSchemas — which Zod will already enforce at runtime. The result: the spec passes, the block ships, real behavioural bugs slip through.

**Correct approach: vertical slices via tracer bullets.** One test → one implementation → repeat. Each cycle responds to what you learned from the previous one. Because you just wrote the code, you know exactly which behaviour matters and how to verify it.

```
WRONG (horizontal):
  RED:   spec for shape, spec for retry, spec for emit, spec for error, spec for state
  GREEN: implement everything

RIGHT (vertical):
  RED→GREEN: emits expected block_output on happy path → minimal handler
  RED→GREEN: emits step_error when upstream fails → add error path
  RED→GREEN: retries on TimeoutError → wire retry config
  ...
```

## Workflow

### 1. Planning

When exploring the codebase, use FSD vocabulary throughout — block / generator / sequencer / router / pattern / capability / flow / scope / item. Test names should describe behaviour in those terms, not implementation steps. Read the relevant `docs/architecture/<area>.md` doc before deciding what behaviours actually matter.

Before writing any code:

- [ ] **State the goal** as an observable real-world outcome, and the **goal check** that will prove it (real model, out of CI — see "Two kinds of test"). The goal frames everything below: the behaviours you test are the steps to it, the goal check is how you confirm you arrived. If this is one of the no-goal-check cases (pure refactor, docs-only, exploratory UI/prose, diagnose-driven bug — see "Verify the goal"), state that no goal check applies and why, rather than inventing a hollow one.
- [ ] Identify which FSD construct you're building: block (which kind?), pattern, capability, flow action
- [ ] Identify the public surface: `inputSchema`, `outputSchema`, emitted item types, state scope reads/writes, lifecycle hooks
- [ ] Identify deepening opportunities (see `fsd:improve-codebase-architecture`) — small interface, deep implementation
- [ ] List the **behaviours** to test (not implementation steps). Behaviours are observable through: items emitted to the stream, state ops applied to scopes, return values from `.execute`, retry/rescue triggers
- [ ] Decide which seam each test exercises (see [tests.md](tests.md)): vitest mock context, `fsdev block`, `fsdev run` with NDJSON, or `packages/integration-tests/`
- [ ] Confirm with the user which behaviours matter most

Ask: *"What should the public surface look like? Which observable behaviours are load-bearing?"*

**You can't test everything.** Confirm with the user which behaviours are critical. Focus testing effort on the contract-shaped behaviours and the hard cases — not every shape permutation.

### 2. Tracer bullet

Write ONE test that confirms ONE behaviour about the system:

```
RED:   Write a vitest spec that exercises the happy path through the
       block's public interface using @flow-state-dev/testing's mock
       context → fails (block doesn't exist yet, or exists but throws)
GREEN: Write the minimal block code to make that test pass → passes
```

This is your tracer bullet — proves the path works end-to-end through the FSD execution model.

For generators specifically: the tracer test should use `mockGenerator` (from `@flow-state-dev/testing`) so the LLM call is deterministic. The first test exercises the model loop's happy path; later tests exercise tool invocation, retry, rescue.

For sequencers and patterns: the tracer test runs the composition through a real context and asserts on the *terminal* output / items emitted / state changes — not on individual `.step()` step results.

### 3. Incremental loop

For each remaining behaviour:

```
RED:   Write the next test → fails
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass the current test
- Don't anticipate future tests
- Each test asserts on **observable** behaviour through the public surface — items emitted, state mutated, return values, lifecycle hooks fired. Not internal data shape, not call order, not private intermediate values
- For sequencer/router behaviour: assert on the terminal output or stream, not the intermediate `.step()` step shapes
- For generator behaviour: assert on emitted items (`message`, `block_output`, `step_error`, `state_change`) and on the final `output` — not on which model call was made or the order of mocked responses

### 4. Refactor

After all tests pass, look for:

- [ ] Duplication across blocks → extract a utility, a connector function (BP-013), or a capability
- [ ] Repeated tool / context / resource wiring → extract a capability (`defineCapability`)
- [ ] Shallow handlers whose `execute` is a single transform → fold into the sequencer via `.map()` or a connector
- [ ] Handlers that just return their input → replace with `.tap()` (BP-012, BP-014)
- [ ] Wrapper sequencers gating a single step → replace with `.stepIf` / `.workIf` / `.tapIf` (BP-036)
- [ ] Generator output schemas with `z.optional` / `z.default` / `z.record` / heterogeneous `z.union` → collapse to fixed + nullable (BP-016)
- [ ] Shallow modules in the broader area → use `fsd:improve-codebase-architecture` for deepening
- [ ] Run tests after each refactor step. **Never refactor while red.** Get to green first.

After the refactor:
- Per-package check: `pnpm --filter @flow-state-dev/<pkg> typecheck && pnpm --filter @flow-state-dev/<pkg> test`
- Cross-package: root `pnpm typecheck` (also runs the package boundary validator)
- User-facing API change: update `packages/<pkg>/README.md` and any affected `apps/docs` page in the same change set (CLAUDE.md rule)
- BP-007: any new file gets a header comment and doc-comment on every export

### 5. Verify the goal

Green specs mean the units behave. They do **not** mean you reached the goal — the mocks fed the assertions. **When the work has a goal check** (the default for observable behaviour), run it before declaring the work done (real model, real path — see "Two kinds of test"):

- Run it (`fsdev run` against a real model, or `pnpm tsx goals/<describe>/<it>/run.mts`) and read the PASS/FAIL verdict on the actual outcome.
- If it fails, the work is not done even with every spec green — go back to the loop. A failed goal check on green specs usually means a spec was asserting on a mock's output instead of the real behaviour; fix the goal first, then tighten the spec.
- Record the goal check (its command/path and its verdict) so the next reader can re-run it.

**When there's no goal check to run**, don't invent one and don't fabricate a PASS. This applies to the cases where TDD itself is skipped or relaxed (see "When NOT to use TDD"): pure refactors covered by existing tests, docs-only work, exploratory UI/prose, and diagnose-driven bugs (whose real-path repro re-run is the goal-level proof). Record the reason there's no goal check instead of a verdict.

## Per-cycle checklist

```
[ ] Test describes behaviour, not implementation
[ ] Test goes through the public surface (inputSchema → execute → emitted
    items / outputSchema / state changes)
[ ] Test would survive an internal refactor (renaming a private helper
    doesn't break it)
[ ] Code is minimal — passes this test, no more
[ ] No speculative features, no anticipating future tests
[ ] If the cycle involved a generator: schema strictness asserted with
    makeSchemaStrict per BP-016
```

## When NOT to use TDD

TDD is the default for new blocks, patterns, capabilities, and flow actions. Skip it (or relax it) when:

- The work is purely refactoring with existing tests covering the behaviour — the existing tests are the safety net; don't pretend to TDD a non-functional change.
- The work is documentation-only.
- The change is in `apps/docs` or `apps/kitchen-sink` and is exploratory UI/prose work.
- You're debugging a specific bug via `fsd:diagnose` — diagnose's Phase 5 already covers the "regression test before the fix" discipline, which is TDD-shaped but framed around the bug, not the feature.
