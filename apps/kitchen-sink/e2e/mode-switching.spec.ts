import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("mode switching: build mode round-trip works after switching", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);

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

test("mode switching: a session reopens in the mode it last ran in", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);

  await byTestId(page, "mode-selector").click();
  await page.getByRole("menuitemradio", { name: /Build/ }).click();
  await byTestId(page, "message-input").fill(
    "[scenario:mode-build] make it green",
  );
  await byTestId(page, "message-submit").click();
  await expect(
    page.locator('[data-testid="message"][data-message-role="assistant"]:visible').first(),
  ).toContainText("Build mode acknowledged.");

  // The session ran in Build, so it reopens in Build: the next message must
  // not silently run in Ask.
  await page.reload();
  await expect(byTestId(page, "mode-selector")).toContainText("Build");
});
