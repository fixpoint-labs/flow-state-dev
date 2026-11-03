/**
 * The suggestion chips under an empty Flow State conversation are the page's
 * only first-run guidance: clicking one has to put its text in the composer.
 * The chip is clicked after the session has resolved, which is the moment a
 * click handler holding a stale draft setter would silently drop the write.
 */
import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("a suggestion chip fills the composer with its text", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);

  const chip = page.getByRole("button", { name: "Create a deployment plan" }).locator("visible=true");
  await chip.click();

  await expect(byTestId(page, "message-input")).toHaveValue("Create a deployment plan");
});
