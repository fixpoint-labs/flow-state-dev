import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("devtool reflects the per-test session under the same userId", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "message-input").fill("[scenario:devtool] hi from e2e");
  await byTestId(page, "message-submit").click();

  await expect(
    page
      .locator(
        '[data-testid="message"][data-message-role="assistant"]:visible',
      )
      .first(),
  ).toContainText("DevTool scenario response.");

  await page.goto(`/devtool?e2eUserId=${encodeURIComponent(userId)}`);

  const panel = byTestId(page, "devtool-panel");
  await expect(panel).toBeVisible();
  // The panel mounts with the per-test userId and surfaces the chat-agent
  // flow registered on the server. Asserting on the request body itself
  // would require driving the navigator UI; the smoke is that the panel
  // can talk to the server in the per-test scope.
  await expect(panel).toContainText(userId);
  await expect(panel).toContainText("chat-agent");
});
