import { test, expect, openKitchenSink } from "./fixtures";

test("tool calls render in a grouped collapsible", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await page
    .getByTestId("message-input")
    .fill("[scenario:tool-1] use the tools");
  await page.getByTestId("message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]',
  );
  await expect(assistant.first()).toContainText("Found alpha and beta.");

  const toolGroup = page.getByTestId("tool-group").first();
  await expect(toolGroup).toBeVisible();
});
