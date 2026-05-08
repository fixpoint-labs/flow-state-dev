import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("streaming indicator hides after the response settles", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "message-input").fill("[scenario:smoke] x");
  await byTestId(page, "message-submit").click();

  await expect(
    page
      .locator(
        '[data-testid="message"][data-message-role="assistant"]:visible',
      )
      .first(),
  ).toContainText("Smoke test response.");
  await expect(byTestId(page, "streaming-indicator")).toBeHidden();
});
