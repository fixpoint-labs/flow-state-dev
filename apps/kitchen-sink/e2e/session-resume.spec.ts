import { test, expect, openKitchenSink } from "./fixtures";

test("session resume: prior messages return after page reload", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await page
    .getByTestId("message-input")
    .fill("[scenario:resume] remember me");
  await page.getByTestId("message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]',
  );
  await expect(assistant.first()).toContainText("I will remember.");

  await page.reload();

  await expect(page.getByTestId("conversation")).toContainText("remember me");
  await expect(page.getByTestId("conversation")).toContainText(
    "I will remember.",
  );
});
