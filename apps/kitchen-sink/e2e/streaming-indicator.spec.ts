import { test, expect, openKitchenSink, byTestId } from "./fixtures";

/**
 * Distinct from smoke-ask: asserts the streaming indicator becomes visible
 * during the in-flight phase (not just hidden after settle). Catches a
 * regression where the streaming-state plumbing never wires through SSE
 * to React — a bug the smoke spec's "hidden after settle" check would
 * miss because the indicator simply never appearing also satisfies it.
 */
test("streaming indicator is visible mid-stream and hidden after settle", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "message-input").fill("[scenario:smoke] x");
  await byTestId(page, "message-submit").click();

  // The indicator should flip visible as soon as the request is in flight.
  // toBeVisible() auto-retries up to expect.timeout, which covers SSE wiring
  // latency on slower CI runners.
  await expect(byTestId(page, "streaming-indicator")).toBeVisible();

  // Once the assistant text lands, the indicator must return to hidden.
  await expect(
    page
      .locator(
        '[data-testid="message"][data-message-role="assistant"]:visible',
      )
      .first(),
  ).toContainText("Smoke test response.");
  await expect(byTestId(page, "streaming-indicator")).toBeHidden();
});
