import { test, expect, openKitchenSink } from "./fixtures";

test("streaming indicator hides after the response settles", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await page.getByTestId("message-input").fill("[scenario:smoke] x");
  await page.getByTestId("message-submit").click();

  // Terminal state: assistant text rendered AND indicator hidden.
  await expect(
    page.locator('[data-testid="message"][data-message-role="assistant"]').first(),
  ).toContainText("Smoke test response.");
  await expect(page.getByTestId("streaming-indicator")).toBeHidden();
});
