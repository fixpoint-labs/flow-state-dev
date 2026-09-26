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
 *
 * And by `specs/issues/FIX-1590/BUSINESS-RULES.md`: BR-1, BR-8 and BR-9 (a
 * post to `support.desk` runs `support.iris` and `support.otto`, each in one
 * conversation of its own for the channel, listed under the seat as a run of
 * the channel, the post heard once with the reply under it after a reload,
 * and a second post lands in the same conversation), and BR-2 (no clerk or
 * runner seat lists a run of the channel).
 *
 * And by `specs/issues/FIX-1594/BUSINESS-RULES.md`: BR-2, BR-12 and BR-13
 * (`support.otto`, woken by a post, answers in `support.desk` itself; the line
 * is labelled `support.otto` after a reload) and BR-9 (its line wakes nobody:
 * each agent seat heard the token once, in the person's post).
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

/** A seat's conversation for a channel: the run the channel started, listed under the seat. */
const channelRun = (page: Page, seat: string, channel: string): Locator =>
  rail(page).locator(`ul[data-leaf="${seat}"] [data-dispatch-run-of="${channel}"]`);

test("a post to support.desk runs each agent seat once, in its own conversation for the channel, kept across a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const first = `[scenario:wake] wake ${token()} can someone look at the refund queue?`;
  const second = `[scenario:wake] wake ${token()} and the shipping one`;
  await openShell(page);
  await open(page, "channel");
  await row(page, "support.desk").click();
  const channel = picked(page);
  for (const line of [first, second]) {
    await channel.getByLabel("Post to this channel").fill(line);
    await channel.getByRole("button", { name: "Send" }).click();
    await expect(channel.getByTestId("channel-line").filter({ hasText: line })).toHaveCount(1);
  }

  // Each seat answers in its own request, after the post has landed. Let both
  // answers land before the reload; nothing here is graded, so a seat that
  // never ran fails below, on what the page shows.
  const answered = async (seat: string): Promise<boolean> => {
    const listed = await page.request.get(`/api/flows/sessions?flowId=${seat}&include=dispatch-runs&limit=100`);
    const { sessions } = (await listed.json()) as { sessions: Array<{ id: string; parentSessionId?: string | null }> };
    const run = sessions.find((s) => s.parentSessionId === "support.desk");
    if (run === undefined) return false;
    const state = await page.request.get(`/api/flows/sessions/${run.id}/state?include_items=true&item_types=message&limit=1000`);
    const text = await state.text();
    return text.includes(first) && text.includes(second) && (text.match(/\[reply:wake\]/g) ?? []).length >= 2;
  };
  for (let waited = 0; waited < 20_000; waited += 250) {
    if ((await answered("support.iris")) && (await answered("support.otto"))) break;
    await page.waitForTimeout(250);
  }

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "agent");
  for (const seat of ["support.iris", "support.otto"]) {
    await open(page, seat);
    // One conversation for the channel, whatever else the seat holds.
    await expect(channelRun(page, seat, "support.desk")).toHaveCount(1);
    await channelRun(page, seat, "support.desk").click();
    const conversation = picked(page);
    for (const line of [first, second]) {
      const heard = conversation.locator('[data-message-role="user"]').filter({ hasText: line });
      await expect(heard).toHaveCount(1);
      await expect(heard).toContainText(`in support.desk: ${line}`);
    }
    await expect(conversation.locator('[data-message-role="assistant"]').filter({ hasText: "[reply:wake]" })).not.toHaveCount(0);
  }

  // The clerks and the runner list no run of the channel: a post runs nothing on them.
  await open(page, "desk-clerk");
  await open(page, "followup-runner");
  for (const seat of ["support.ada", "support.grace", "support.wren"]) {
    await open(page, seat);
    await expect(rail(page).locator(`ul[data-leaf="${seat}"]`)).toBeVisible();
    await expect(channelRun(page, seat, "support.desk")).toHaveCount(0);
  }
});

test("a woken support.otto answers in support.desk under its own name, and its line wakes nobody", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `reply-token-${token()}`;
  const line = `[scenario:reply-in-channel] ${mark} when do refunds post?`;
  await openShell(page);
  await open(page, "channel");
  await row(page, "support.desk").click();
  const channel = picked(page);
  await channel.getByLabel("Post to this channel").fill(line);
  await channel.getByRole("button", { name: "Send" }).click();
  await expect(channel.getByTestId("channel-line").filter({ hasText: line })).toHaveCount(1);

  // Otto's line is written by the channel's own request, after otto's run.
  // Let it land, and both agents answer, before the reload; nothing here is
  // graded, so what did not happen fails below, on what the page shows.
  await expect
    .poll(async () => (await page.request.get("/api/flows/sessions/support.desk/state?include_items=true&item_types=component&limit=1000")).text())
    .toContain(`[reply:in-channel] ${mark}`);
  for (const seat of ["support.iris", "support.otto"]) {
    await expect
      .poll(async () => {
        const listed = await page.request.get(`/api/flows/sessions?flowId=${seat}&include=dispatch-runs&limit=100`);
        const { sessions } = (await listed.json()) as { sessions: Array<{ id: string; parentSessionId?: string | null }> };
        const run = sessions.find((s) => s.parentSessionId === "support.desk");
        if (run === undefined) return "";
        return (await page.request.get(`/api/flows/sessions/${run.id}/state?include_items=true&item_types=message&limit=1000`)).text();
      })
      .toContain(mark);
  }
  // Time for a wrongly woken seat to run, so its absence below is not a race.
  await page.waitForTimeout(1_500);

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "channel");
  await row(page, "support.desk").click();
  const reply = picked(page).getByTestId("channel-line").filter({ hasText: `[reply:in-channel] ${mark}` });
  await expect(reply).toHaveCount(1);
  await expect(reply.getByTestId("channel-line-label")).toHaveText("support.otto");

  await open(page, "agent");
  for (const seat of ["support.iris", "support.otto"]) {
    await open(page, seat);
    await channelRun(page, seat, "support.desk").click();
    // The person's post, heard once; otto's line never reached a seat.
    const heard = picked(page).locator('[data-message-role="user"]').filter({ hasText: mark });
    await expect(heard).toHaveCount(1);
    await expect(heard).toContainText(`devuser in support.desk: ${line}`);
  }
});
