import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("smoke: ask-mode round-trip renders mocked assistant text", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "message-input").fill("[scenario:smoke] hello");
  await byTestId(page, "message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]:visible',
  );
  await expect(assistant.first()).toContainText("Smoke test response.");
  await expect(byTestId(page, "streaming-indicator")).toBeHidden();
});
