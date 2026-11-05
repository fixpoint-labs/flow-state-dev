/**
 * A failed turn in Flow State mode reads as a failure, once, with its reason
 * and a Retry that runs the turn again.
 *
 * The `fail-once` scenario's first assistant call throws, as a provider error
 * would (`lib/e2e-mock-script.ts` → `failsOnce`); the retry's call answers.
 * Red state produced before this was trusted: draw the `error` item with
 * `ErrorDisplay` again, and the Retry step fails (no button).
 */
import { randomUUID } from "node:crypto";
import { test, expect, openKitchenSink, byTestId } from "./fixtures";

test("a failed turn shows its reason and Retry, once, and Retry answers it", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);

  await byTestId(page, "message-input").fill(`[scenario:fail-once] ${randomUUID()}`);
  await byTestId(page, "message-submit").click();

  const line = byTestId(page, "request-recovery");
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("data-state", "failed");
  await expect(line).toContainText("Assistant couldn't finish this turn");
  await expect(line).toContainText("Scripted model failure");
  // Once: not also as a second box in the stream or under it.
  await expect(page.getByText("Scripted model failure").filter({ visible: true })).toHaveCount(1);

  await line.getByRole("button", { name: "Retry" }).click();

  const assistant = page.locator('[data-testid="message"][data-message-role="assistant"]:visible');
  await expect(assistant.last()).toContainText("Answered on the retry.");
  await expect(byTestId(page, "streaming-indicator")).toBeHidden();

  // The failed turn keeps its reason, and loses its Retry: it is no longer the
  // newest request.
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Scripted model failure");
  await expect(line.getByRole("button")).toHaveCount(0);
});
