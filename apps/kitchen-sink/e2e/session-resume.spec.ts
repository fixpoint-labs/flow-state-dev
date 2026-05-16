import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("session resume: prior messages return after page reload", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "message-input").fill("[scenario:resume] remember me");
  await byTestId(page, "message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]:visible',
  );
  await expect(assistant.first()).toContainText("I will remember.");

  await page.reload();

  const conversation = byTestId(page, "conversation");
  await expect(conversation).toContainText("remember me");
  await expect(conversation).toContainText("I will remember.");
});
