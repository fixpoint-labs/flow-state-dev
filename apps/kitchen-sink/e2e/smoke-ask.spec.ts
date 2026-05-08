import { test, expect, openKitchenSink } from "./fixtures";

test("smoke: ask-mode round-trip renders mocked assistant text", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await page.getByTestId("message-input").fill("[scenario:smoke] hello");
  await page.getByTestId("message-submit").click();

  const assistant = page
    .getByTestId("message")
    .filter({ has: page.locator('[data-message-role="assistant"]') })
    .or(page.locator('[data-testid="message"][data-message-role="assistant"]'));

  await expect(assistant.first()).toContainText("Smoke test response.");
  await expect(page.getByTestId("streaming-indicator")).toBeHidden();
});
