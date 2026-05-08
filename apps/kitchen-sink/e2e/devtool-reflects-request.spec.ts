import { test, expect, openKitchenSink } from "./fixtures";

test("devtool reflects a live request from the chat surface", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await page
    .getByTestId("message-input")
    .fill("[scenario:devtool] hi from e2e");
  await page.getByTestId("message-submit").click();

  await expect(
    page.locator('[data-testid="message"][data-message-role="assistant"]').first(),
  ).toContainText("DevTool scenario response.");

  await page.goto(`/devtool?e2eUserId=${encodeURIComponent(userId)}`);
  await expect(page.getByTestId("devtool-panel")).toBeVisible();

  // The user message snippet should appear somewhere inside the navigator.
  // We don't bind to a specific tree node — the DevTool renders sessions /
  // requests in its own UI that may evolve.
  await expect(page.getByTestId("devtool-panel")).toContainText(
    /\[scenario:devtool\]/,
  );
});
