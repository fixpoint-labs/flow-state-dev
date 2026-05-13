---
sidebar_position: 4
---

# End-to-end tests

The kitchen-sink app — the reference Next.js app under `apps/kitchen-sink` — has a small Playwright suite that drives a real browser against a real production build. It catches the regressions that the lower tiers can't see: SSE → React state desync, hydration, the embedded DevTool, prompt-input plumbing.

It is deliberately small. Five to seven scenarios. The suite's job is not coverage. The flow-integration tier already covers flow correctness; component-level behavior is unit-tested.

## When to reach for an E2E test

A scenario belongs here only if it can't be tested anywhere else. In practice, that means:

- A real browser consumes the SSE stream (streaming indicator, scroll-anchor, mid-stream user input).
- React renders the result (hydration mismatches, theme glitches).
- The kitchen-sink wires the DevTool embed (`/devtool`) into a host route.
- A flow round-trip succeeds end to end through the UI from a non-default state (mode switch, page reload).

Not for:

- Flow correctness — that's the [Flow integration tests](flow-integration-tests).
- Generator behavior — `testFlow` with `mockGenerator` is faster.
- Visual regression or cross-browser matrix — out of scope for v1.

If a scenario doesn't need a browser, it doesn't belong here.

## Running the suite locally

`NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE` must be set at build time. Next.js inlines `NEXT_PUBLIC_*` env vars into the client bundle at `next build`, so setting it on `next start` has no effect.

```bash
pnpm --filter @flow-state-dev/kitchen-sink exec playwright install chromium

KITCHEN_SINK_TEST_MODE=1 NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE=1 \
  pnpm --filter @flow-state-dev/kitchen-sink build

pnpm --filter @flow-state-dev/kitchen-sink test:e2e
```

Useful flags:

- `--headed` runs Chromium with a visible window.
- `--ui` opens Playwright's interactive runner (best for debugging).
- `--debug` steps through one test at a time.

To run against a deployed preview instead of building locally:

```bash
KITCHEN_SINK_URL=https://kitchen-sink-preview.vercel.app \
  pnpm --filter @flow-state-dev/kitchen-sink test:e2e
```

When `KITCHEN_SINK_URL` is set, Playwright skips its own dev server.

## How LLMs are mocked

Tests don't hit a network or pay tokens. Setting `KITCHEN_SINK_TEST_MODE=1` swaps the model resolver in `apps/kitchen-sink/lib/server.ts` for `createMockModelResolver`. The mocks live in `apps/kitchen-sink/lib/e2e-mock-script.ts`:

- **`assistantMock`** is a hand-rolled dispatcher over `SCENARIO_SCRIPTS` — each entry is `{ match: (json) => boolean, steps: MockGeneratorScriptStep[] }`. Each scenario sends a message with a unique sentinel substring (e.g. `[scenario:smoke]`); the matching entry's `steps` are walked in order across the generator's tool loop.
- The other generators on the run path (`thinkingStyleClassifierMock`, `intentClassifierMock`, `autoTitleMock`) use the framework's `mockGenerator()` with `{ when, then }` predicate entries because they need a single fixed response per call.

```ts
// apps/kitchen-sink/lib/e2e-mock-script.ts
const SCENARIO_SCRIPTS: ScenarioScript[] = [
  {
    match: (json) => json.includes("[scenario:smoke]"),
    steps: [{ text: "Smoke test response." }],
  },
  // ...
];
```

For tool-call scenarios, set both `text` and `toolCalls` on the same step so the mock returns a terminal result without entering its internal execute loop. The stream wrapper in `lib/server.ts` then emits the tool-call items + the assistant text together.

## Adding a scenario

1. Pick a sentinel: `[scenario:my-thing]`.
2. Add an entry to `SCENARIO_SCRIPTS` in `apps/kitchen-sink/lib/e2e-mock-script.ts`.
3. Add a `*.spec.ts` file under `apps/kitchen-sink/e2e/`.
4. Keep the suite's total runtime under three minutes. If a single spec crosses 30s, that's a smell — either the scenario is too broad or it belongs in a lower tier.

A minimal scenario:

```ts
import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("my thing", async ({ page, userId }) => {
  await openKitchenSink(page, userId);
  await byTestId(page, "message-input").fill("[scenario:my-thing] hi");
  await byTestId(page, "message-submit").click();
  await expect(
    page
      .locator('[data-testid="message"][data-message-role="assistant"]:visible')
      .first(),
  ).toContainText("expected response");
});
```

Use the `byTestId(page, id)` helper from `fixtures.ts` instead of `page.getByTestId(id)` directly: kitchen-sink renders both a mobile and a desktop `ChatPanel` into the DOM at all times (Tailwind toggles visibility via CSS), so a raw test-id matches two elements and trips Playwright's strict-mode check. The helper appends `:visible` to pick the one actually rendered for the current viewport.

The `userId` fixture mints a fresh `e2e-<uuid>` per test so parallel scenarios don't share session state.

## Debugging a failure

CI uploads `apps/kitchen-sink/playwright-report` as an artifact named `playwright-report` on every run. Open `index.html` in a browser to see the report, including a trace viewer for retried-and-still-failed cases.

Locally, `--ui` is the best tool — it replays each step with timeline and DOM snapshots. `--headed` plus `await page.pause()` is the next step down when `--ui` is too heavy.
