import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("devtool reflects a live request from the chat surface", async ({
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
  await expect(byTestId(page, "devtool-panel")).toBeVisible();

  await expect(byTestId(page, "devtool-panel")).toContainText(
    /\[scenario:devtool\]/,
  );
});
