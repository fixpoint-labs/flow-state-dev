/**
 * Talking from the page: posting to a channel and messaging a seat, from the
 * panel the rail opens, against the built app on its scripted model.
 *
 * These write to `support.desk`, a channel every scenario on this user shares,
 * which is why they live here and not in `workforce-shell.spec.ts` (whose
 * scenarios write to no channel). Each one asserts on a token of its own, so a
 * line another test posted can never be the one that passes it.
 *
 * What is asserted is always read back from the server after a reload: the
 * panel draws no optimistic copy, and the reload throws away anything the
 * page kept for itself.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1585/BUSINESS-RULES.md`):
 * BR-1 and BR-2 (the desk line, labelled `devuser`, survives a reload), BR-12,
 * BR-13 and BR-16 (a new `support.otto` conversation keeps the message and
 * its reply across a reload), BR-15 (`support.wren` has no composer and says
 * why), BR-17 (a failed "New conversation" shows in the seat's row, opens
 * nothing, and can be pressed again).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const rail = (page: Page) => page.getByTestId("rail");
const row = (page: Page, name: string) => rail(page).getByRole("button", { name, exact: true });
/** The picked panel. The page draws the stream twice, one hidden by width. */
const picked = (page: Page) => page.locator('[data-testid="picked-session"]:visible');

async function openShell(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
}

/** Open a row, unless it is already open. */
async function open(page: Page, name: string): Promise<void> {
  const button = row(page, name);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/** The actions drawn on a seat's own row. */
const seatRow = (page: Page, address: string): Locator =>
  rail(page).locator(`[data-instance-id="${address}"]`).locator("xpath=..");

const token = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Open a new conversation on a desk-clerk seat and send it a note. */
async function sendClerkNote(page: Page, seat: string, note: string): Promise<string> {
  await openShell(page);
  await open(page, "desk-clerk");
  await open(page, seat);
  await seatRow(page, seat).getByRole("button", { name: "New conversation" }).click();
  const panel = picked(page);
  await panel.getByLabel("Message this seat").fill(note);
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.locator('[data-message-role="user"]').filter({ hasText: note })).toHaveCount(1);
  const sessionId = await rail(page)
    .locator(`ul[data-leaf="${seat}"] [aria-current="true"]`)
    .getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

test("a line posted to support.desk shows as devuser, and is still there after a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const line = `desk line ${token()}`;
  await openShell(page);
  await open(page, "channel");
  await row(page, "support.desk").click();

  const panel = picked(page);
  await expect(panel.getByTestId("channel-transcript")).toBeVisible();
  await expect(page.getByText(/go to the assistant/)).toHaveCount(0);
  await panel.getByLabel("Post to this channel").fill(line);
  await panel.getByRole("button", { name: "Send" }).click();

  const posted = panel.getByTestId("channel-line").filter({ hasText: line });
  await expect(posted).toHaveCount(1);
  await expect(posted.getByTestId("channel-line-label")).toHaveText("devuser");
  await expect(panel.getByLabel("Post to this channel")).toHaveValue("");

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "channel");
  await row(page, "support.desk").click();
  const kept = picked(page).getByTestId("channel-line").filter({ hasText: line });
  await expect(kept).toHaveCount(1);
  await expect(kept.getByTestId("channel-line-label")).toHaveText("devuser");
});

test("a new support.otto conversation keeps the message and the reply across a reload; support.wren takes none", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const message = `[scenario:talk-to-seat] where is order ${token()}?`;
  await openShell(page);
  await open(page, "agent");
  await open(page, "support.otto");
  await seatRow(page, "support.otto").getByRole("button", { name: "New conversation" }).click();

  const panel = picked(page);
  await panel.getByLabel("Message this seat").fill(message);
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText(message, { exact: true })).toBeVisible();
  await expect(panel.getByText(/\[reply:talk-to-seat\]/)).toBeVisible();

  // The conversation that was opened, so the reload can come back to it.
  const sessionId = await rail(page)
    .locator('ul[data-leaf="support.otto"] [aria-current="true"]')
    .getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "agent");
  await open(page, "support.otto");
  await rail(page).locator(`[data-session-id="${sessionId}"]`).click();
  const kept = picked(page);
  await expect(kept.getByText(message, { exact: true })).toBeVisible();
  await expect(kept.getByText(/\[reply:talk-to-seat\]/)).toBeVisible();

  // A seat whose kind has nothing to answer with gets no composer.
  await open(page, "followup-runner");
  await open(page, "support.wren");
  await seatRow(page, "support.wren").getByRole("button", { name: "New conversation" }).click();
  await expect(picked(page).getByTestId("picked-read-only")).toContainText("runs rows from a board");
  await expect(picked(page).getByTestId("picked-composer")).toHaveCount(0);
});

test("a failed New conversation shows in the seat's row, opens nothing, and can be pressed again", async ({
  page,
  consoleErrors,
}) => {
  let refuse = true;
  await page.route(
    (url) => url.pathname === "/api/flows/support.grace/sessions",
    async (route) => {
      if (route.request().method() !== "POST" || !refuse) return route.fallback();
      await route.fulfill({ status: 503, json: { error: { message: "store unavailable" } } });
    },
  );
  await openShell(page);
  await open(page, "desk-clerk");
  await open(page, "support.grace");
  const button = seatRow(page, "support.grace").getByRole("button", { name: "New conversation" });
  await button.click();

  await expect(rail(page).getByTestId("seat-create-error")).toContainText("Could not start a conversation");
  await expect(picked(page)).toHaveCount(0);

  refuse = false;
  await button.click();
  await expect(picked(page).getByLabel("Message this seat")).toBeVisible();
  await expect(rail(page).getByTestId("seat-create-error")).toHaveCount(0);
  // The refused create's own 503 is the one console error this scenario causes.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !e.includes("503")));
});

test("a note to support.ada gets a reply a model wrote, under its desk, and both are kept across a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `clerk-token-${token()}`;
  const note = `[scenario:clerk-answer] ${mark} where is my refund?`;
  const sessionId = await sendClerkNote(page, "support.ada", note);
  await expect(picked(page).getByText(/\[front desk\] \[clerk:answered\]/)).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "desk-clerk");
  await open(page, "support.ada");
  await rail(page).locator(`[data-session-id="${sessionId}"]`).click();
  const kept = picked(page);
  await expect(kept.locator('[data-message-role="user"]').filter({ hasText: note })).toHaveCount(1);
  const reply = kept.locator('[data-message-role="assistant"]');
  await expect(reply).toHaveCount(1);
  await expect(reply).toContainText("[front desk] [clerk:answered]");
  // The reply is the model's, not the note handed back.
  await expect(reply).not.toContainText(mark);
});

test("a note the clerk files shows as a row on escalations in the team panel after a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `clerk-token-${token()}`;
  await sendClerkNote(page, "support.ada", `[scenario:clerk-file] ${mark} the charger caught fire`);
  await expect(picked(page).getByText(/\[front desk\] \[clerk:filed\]/)).toBeVisible();
  // The row is written by the channel's own request, a moment after the
  // dispatch. Let it land before the reload; nothing here is graded.
  await expect
    .poll(async () =>
      (await page.request.get("/api/flows/sessions/support.desk/resources/support.desk.escalations")).text(),
    )
    .toContain(mark);

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  const board = page.getByTestId("board-support.desk.escalations");
  await expect(board.locator("li[data-task-id]").filter({ hasText: mark })).toHaveCount(1);
});
