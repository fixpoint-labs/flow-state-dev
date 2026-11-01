/**
 * The page's address names the open conversation (`?session=<id>`), so a
 * reload, a link and Back reopen it: the assistant's, or a coordinator's
 * picked in the rail. Each case reads what is drawn, never the address alone,
 * so a page that writes the address and ignores it on load fails.
 *
 * Nothing here posts, so sharing the app's one user across parallel tests is
 * safe: each opens the person's one conversation with the coordinator, or its
 * own assistant session.
 */
import type { Page } from "@playwright/test";
import { test, expect, openKitchenSink } from "./fixtures";

const COORDINATOR = "support.help";

const rail = (page: Page) => page.getByTestId("rail");
const row = (page: Page, name: string) => rail(page).getByRole("button", { name, exact: true });
/** The picked panel. The page draws the stream twice, one hidden by width. */
const picked = (page: Page) => page.locator('[data-testid="picked-session"]:visible');
const assistantComposer = (page: Page) => page.locator('[data-testid="message-input"]:visible');
const named = (page: Page) => new URL(page.url()).searchParams.get("session");

/** Open the person's conversation with the coordinator from the rail. */
async function openHelpDesk(page: Page): Promise<string> {
  const flow = row(page, "coordinator");
  if ((await flow.getAttribute("aria-expanded")) !== "true") await flow.click();
  const before = named(page);
  await row(page, COORDINATOR).click();
  await expect(picked(page).getByTestId("coordinator-transcript")).toBeVisible();
  await expect.poll(() => named(page)).not.toBe(before);
  return named(page)!;
}

test("a coordinator conversation picked in the rail is still open after a reload", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);
  const conversation = await openHelpDesk(page);
  expect(conversation).not.toBe(sessionId);

  await page.reload();
  await expect(picked(page).getByTestId("coordinator-transcript")).toBeVisible();
  expect(named(page)).toBe(conversation);
});

test("Back returns from a picked conversation to the assistant's session", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);
  await openHelpDesk(page);

  await page.goBack();
  await expect(assistantComposer(page)).toBeEnabled();
  await expect(picked(page)).toHaveCount(0);
  await expect.poll(() => named(page)).toBe(sessionId);
});

test("a link to a session that is gone opens the assistant, and the address drops the dead id", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("/flow-state?session=sess_gone_for_good");
  await expect(assistantComposer(page)).toBeEnabled();
  await expect(picked(page)).toHaveCount(0);
  await expect.poll(() => named(page)).not.toBe("sess_gone_for_good");
  // The read of the dead session's record is the one error this scenario causes.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !e.includes("404")));
});

test("Back onto a session that is gone opens the assistant, not the conversation that was open", async ({
  page,
  sessionId,
  consoleErrors,
}) => {
  await openKitchenSink(page, sessionId);
  await openHelpDesk(page);

  // An entry for a session that has since gone, then Back onto it.
  await page.evaluate(() => {
    window.history.pushState(null, "", "/flow-state?session=sess_gone_for_good");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(assistantComposer(page)).toBeEnabled();
  await expect(picked(page)).toHaveCount(0);
  await expect.poll(() => named(page)).toBe(sessionId);
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !e.includes("404")));
});
