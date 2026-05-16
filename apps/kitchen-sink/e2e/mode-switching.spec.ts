import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("mode switching: build mode round-trip works after switching", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await byTestId(page, "mode-selector").click();
  await page.getByRole("menuitemradio", { name: /Build/ }).click();
  await expect(byTestId(page, "mode-selector")).toContainText("Build");

  await byTestId(page, "message-input").fill(
    "[scenario:mode-build] make it green",
  );
  await byTestId(page, "message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]:visible',
  );
  await expect(assistant.first()).toContainText("Build mode acknowledged.");
});
