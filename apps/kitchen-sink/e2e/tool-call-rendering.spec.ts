import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("tool calls render in a grouped collapsible", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "message-input").fill("[scenario:tool-1] use the tools");
  await byTestId(page, "message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]:visible',
  );
  await expect(assistant.first()).toContainText("Found alpha and beta.");

  const toolGroup = byTestId(page, "tool-group").first();
  await expect(toolGroup).toBeVisible();
});
