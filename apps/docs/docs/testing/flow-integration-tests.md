---
sidebar_position: 3
---

# Flow integration tests

Per-flow tests using `testFlow` are good for isolated assertions. They miss bugs that only show up when several patterns run together — supervisor + task-board's claim system, plan-and-execute's drain loop with concurrent workers, session resume across two runs sharing a registry. The integration suite catches those.

This page describes the tier of testing one level above `testBlock` / `testRouter`: full `runAction` engine, real sequencer composition, real router branching, deterministic mocked generators. It exists to catch regressions that would otherwise need a running server and a real LLM to surface.

## When to reach for which

- **`testBlock` / `testRouter`** — a single block's logic. State changes, output shape, error paths. Most unit-test work belongs here.
- **`testFlow`** — one flow action, end to end. Generator wiring, sequencer step ordering, action dispatch.
- **Flow integration tests** — multi-pattern flows whose pathology emerges from composition. Supervisor's claim-system + reviewer + synthesizer interaction is the canonical example. Live in `packages/integration-tests`.
- **`fsdev run`** — your hands on the wheel: real flow, real models, real stream. Use it to confirm a flow change works in practice. See [agent dev loop](../cli/agent-dev-loop).

The integration suite isn't trying to be comprehensive. It targets the highest-value composition surfaces — the ones where a bug means an infinite loop, a deadlock, or a silent data loss.

## What's in the suite today

Seven scenarios under `packages/integration-tests/src/scenarios/`. Each runs in roughly 20–80ms with mocked generators; the whole suite finishes in a few seconds.

- `hello-chat-smoke` — package wiring sanity check.
- `chat-ask` — single round-trip happy path through a generator.
- `chat-tool-loop` — multi-step tool loop converges to a terminal answer.
- `build-artifact` — generator emits a tool call that mutates a session resource.
- `plan-and-execute` — planner → executor (per-task predicate) → synthesizer.
- `supervisor-task-board` — three concurrent workers, per-task review, final synthesis. The headline regression target.
- `session-resume` — two `testFlow` calls sharing a `StoreRegistry`; verifies the session journal survives the second run.

Each scenario lives in its own `.test.ts` file. The cross-scenario helpers — `findMessage`, `findResourceChanges`, `findBlockOutputs`, `inputContains` — are in `src/helpers/assertions.ts`.

## Mocking generators by predicate

Concurrent patterns (supervisor, parallel plan-and-execute) call the same worker block with different inputs. Per-call ordering is not guaranteed. The mock generator script supports predicate entries that match against the input rather than the call order:

```ts
mockGenerator({
  name: "test-worker",
  script: [
    { when: (input) => JSON.stringify(input).includes("Research X"), then: { text: "X is foo" } },
    { when: (input) => JSON.stringify(input).includes("Research Y"), then: { text: "Y is bar" } },
    { when: (input) => JSON.stringify(input).includes("Research Z"), then: { text: "Z is baz" } },
  ],
});
```

Predicate entries don't consume — the same predicate can match repeatedly. Plain entries still consume sequentially when no predicate matches. The two forms mix freely; predicates win when they fire.

The `inputContains(needle)` helper in `helpers/assertions.ts` is shorthand for the JSON-stringify check.

## Sharing stores across runs

`testFlow` accepts an optional `stores: StoreRegistry`. Pass the same registry to two calls and the second one resumes from the first one's session, journal, and resource state:

```ts
import { createInMemoryStores } from "@flow-state-dev/server";

const stores = createInMemoryStores();
await testFlow({ flow, action, userId, sessionId: "s1", stores, /* ... */ });
await testFlow({ flow, action, userId, sessionId: "s1", stores, /* ... */ }); // sees state from run 1
```

Seeding is idempotent: an already-seeded user/session/org isn't re-`set`. That's the whole point — without it the second run would clobber the first run's journal.

## Running the suite

```bash
pnpm --filter @flow-state-dev/integration-tests test
```

Or as part of the recursive `pnpm test` from the repo root.

`unmockedGeneratorPolicy: "error"` is the default in scenarios. An unrecognized generator block name surfaces as a loud throw with the missing key in the message — easier to debug than a silent fallback.

## Loop guards and timeouts

Sequencer loops trip `DEFAULT_MAX_LOOP_GUARD = 250` and throw with a clear message; generator tool loops cap at `maxIterations: 8` (configurable). Vitest's `testTimeout: 30_000` is the outer net for anything that escapes both. Between the three you don't need a custom watchdog matcher — an infinite loop fails the test deterministically every time.

## Adding a scenario

1. Drop a fixture flow under `src/scenarios/fixtures/` if the scenario doesn't fit one of the existing flows.
2. Write the scenario file under `src/scenarios/<flow>-<scenario>.test.ts`.
3. Mock every generator the pipeline reaches. `policy: "error"` will yell about the ones you missed.
4. Run `pnpm --filter @flow-state-dev/integration-tests test:watch` while iterating.

When a scenario gets ad-hoc mock-script setup that a third scenario also needs, lift it to `src/helpers/`. Until that third occurrence shows up, keeping it in the test file is fine.
