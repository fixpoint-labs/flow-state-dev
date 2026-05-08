import { test, expect, openKitchenSink } from "./fixtures";

test("mode switching: build mode round-trip works after switching", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  await page.getByTestId("mode-selector").click();
  await page.getByRole("menuitemradio", { name: /Build/ }).click();
  await expect(page.getByTestId("mode-selector")).toContainText("Build");

  await page
    .getByTestId("message-input")
    .fill("[scenario:mode-build] make it green");
  await page.getByTestId("message-submit").click();

  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]',
  );
  await expect(assistant.first()).toContainText("Build mode acknowledged.");
});
