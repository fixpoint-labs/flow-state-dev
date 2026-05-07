# @flow-state-dev/integration-tests

Tier 1 flow integration test suite. Private. Not published.

Exists to catch regressions whose pathology only emerges from full
sequencer + router + claim-system composition — the kind a `testBlock`
or `testRouter` can't see. Drives whole flows through `runAction`
against in-memory stores with deterministic mocked generators.

## Running

```bash
pnpm --filter @flow-state-dev/integration-tests test
```

Or via the recursive root command:

```bash
pnpm test
```

The repo's root `pnpm test` script runs `pnpm -r --if-present test`, so this
package is included automatically.

Suite duration target: under 30 seconds on a developer laptop. Currently
finishes in ~3 seconds.

## Layout

```
src/
  helpers/
    assertions.ts            ← shared item-stream helpers
  scenarios/
    fixtures/                ← synthetic flows under test
      chat-flow.ts
      artifact-flow.ts
      plan-and-execute-flow.ts
      supervisor-flow.ts
    chat-ask.test.ts         ← S2
    chat-tool-loop.test.ts   ← S4
    build-artifact.test.ts   ← S3
    plan-and-execute.test.ts ← S6
    supervisor-task-board.test.ts ← S1 (regression target)
    session-resume.test.ts   ← S7
    hello-chat-smoke.test.ts ← S5
```

The hello-chat scenarios (S5, S7) reach over to `examples/hello-chat`
via relative imports — that flow is small enough to use as a real-world
fixture. Every other scenario uses a synthetic fixture flow that wraps
the pattern under test, isolating it from app-specific composition.

## Helpers

`src/helpers/assertions.ts` exports plain functions, not custom vitest
matchers. The set is small on purpose — additions arrive when a third
scenario asks for them, not before.

- `itemsByType(items, type)` — filter to a specific `OutputItem` type.
- `findMessage(items, role)` — first message matching role.
- `messageText(messageItem)` — concatenate `output_text` parts of a message.
- `findToolCalls(items)` — every `tool_output` item.
- `findResourceChanges(items, prefix?)` — `resource_change` items, optionally filtered.
- `findBlockOutputs(items, blockName)` — `block_trace` items produced by a named block.
- `inputContains(needle)` — predicate factory for mock-generator `when` clauses.

## Authoring a new scenario

1. Add a fixture flow under `src/scenarios/fixtures/` if no existing one fits.
2. Write the scenario file as `<flow>-<scenario>.test.ts`.
3. Use `unmockedGeneratorPolicy: "error"` (default). The first run will
   tell you the exact block names you missed mocking.
4. For per-input matching (concurrent workers, varying-input generators),
   use predicate entries:

   ```ts
   mockGenerator({
     name: "worker",
     script: [
       { when: inputContains("Task A"), then: { text: "Did A" } },
       { when: inputContains("Task B"), then: { text: "Did B" } },
     ],
   });
   ```

5. Run `pnpm --filter @flow-state-dev/integration-tests test:watch` while
   iterating.

See `apps/docs/docs/testing/flow-integration-tests.md` for the user-facing
docs page.
