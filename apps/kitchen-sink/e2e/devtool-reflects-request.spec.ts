import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("devtool reflects the app's user and its flows", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);

  await byTestId(page, "message-input").fill("[scenario:devtool] hi from e2e");
  await byTestId(page, "message-submit").click();

  await expect(
    page
      .locator(
        '[data-testid="message"][data-message-role="assistant"]:visible',
      )
      .first(),
  ).toContainText("DevTool scenario response.");

  await page.goto("/devtool");

  const panel = byTestId(page, "devtool-panel");
  await expect(panel).toBeVisible();
  // The panel mounts as the app's one user — the user every request above
  // resolved to — and surfaces the chat-agent flow registered on the server.
  // Asserting on the request body itself would require driving the navigator
  // UI; the smoke is that the panel can talk to the server as that user.
  await expect(panel).toContainText("devuser");
  await expect(panel).toContainText("chat-agent");
});
