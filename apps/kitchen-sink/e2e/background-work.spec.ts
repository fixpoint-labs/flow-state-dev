/**
 * A turn that files background work returns, and the work shows up as its own
 * thing rather than as part of the conversation.
 *
 * This is the browser half of the durable-jobs evidence path. What only a
 * browser can show is the split: the reply lands in the transcript while the
 * work itself lands in a panel beside it, and opening that panel reaches a
 * *different session's* history — a read no other tier exercises.
 *
 * The panel appearing at all is the assertion with teeth. Nothing polls for it:
 * the turn's own reply arrives first, the child-session list is re-read once when
 * the turn stops streaming, and the row is what proves the work outlived the
 * request that started it.
 */
import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("background work runs in its own child session and renders outside the conversation", async ({
  page,
  userId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, userId);

  // Pick the style that hands the message to a child session instead of answering.
  await page.getByRole("button", { name: /Default/ }).first().click();
  await page.getByRole("menuitemradio", { name: /Background Work/ }).click();

  await byTestId(page, "message-input").fill("Summarize the locking tradeoffs");
  await byTestId(page, "message-submit").click();

  // The turn answers without the work being done — it says what it filed.
  const assistant = page.locator(
    '[data-testid="message"][data-message-role="assistant"]:visible',
  );
  await expect(assistant.first()).toContainText("as background work");

  // ...and the work appears beside the conversation, not inside it.
  const rows = byTestId(page, "background-work-row");
  await expect(rows).toHaveCount(1, { timeout: 30_000 });
  await expect(rows.first()).toContainText("Summarize the locking tradeoffs");

  // Opening the row reads the child session's OWN session history. The brief is
  // the mocked worker's output, so seeing it means the detached worker ran.
  await rows.first().click();
  await expect(page.getByRole("dialog")).toContainText("Background brief complete.", {
    timeout: 30_000,
  });
});
