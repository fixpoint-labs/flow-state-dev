/**
 * Talking from the page: posting to the support channel and messaging a
 * specialist, from the panel the rail opens, against the built app on its
 * scripted model.
 *
 * These write to `support.help`, a channel every scenario on this user shares,
 * which is why they live here and not in `workforce-shell.spec.ts` (whose
 * scenarios write to no channel). Each one asserts on a token of its own, so a
 * line another test posted can never be the one that passes it.
 *
 * The channel is routed: each post from a person goes to one specialist, and a
 * post sent while that specialist has not answered the last one goes to it
 * again, with no model call. So these run one at a time, in order, and each
 * waits for its last post's answer to land before it ends: a post left
 * unanswered would hold the next test's post on the wrong specialist.
 *
 * What is asserted is always read back from the server after a reload: the
 * panel draws no optimistic copy, and the reload throws away anything the
 * page kept for itself.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1611/BUSINESS-RULES.md`):
 * BR-4 (a post runs the routed specialist once and nobody else; its answer
 * lands as one line under its name), BR-6 (an answer through `post-to-channel`
 * is still one line, and wakes nobody), BR-7 (a routed turn sees the lines
 * another specialist answered), BR-8 (a case that needs a person is one row on
 * `escalations`), BR-13 (a new conversation on a specialist keeps both sides
 * across a reload).
 *
 * And, re-pointed at this roster, by `specs/issues/FIX-1585/BUSINESS-RULES.md`:
 * BR-1 and BR-2 (a line labelled `devuser` survives a reload), BR-17 (a failed
 * "New conversation" shows in the seat's row, opens nothing, and can be
 * pressed again). FIX-1585's BR-15 (a seat of a kind with no action takes no
 * messages) is checked on the panel itself, in `test/picked-session-panel`:
 * the rail lists only the kinds the shell names, so a seat of any other kind
 * never reaches the page.
 *
 * And by `specs/issues/FIX-1609/BUSINESS-RULES.md`, re-pointed at this
 * roster: BR-1, BR-7 and BR-8 (with the channel open, the routed specialist
 * shows as working, then its line lands and the row clears, with no
 * reload), BR-20 and BR-21 (the panel is the only view that follows its
 * session: one session stream, for `support.help`, and none for the
 * assistant). That one is read before any reload, on purpose: what it
 * checks is the page keeping up by itself.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// One at a time, in file order: see the header.
test.describe.configure({ mode: "default" });

const CHANNEL = "support.help";
const SPECIALISTS = ["support.devices", "support.accounts", "support.fsd", "support.general"] as const;

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

/** Open the channel's panel. */
async function openChannel(page: Page): Promise<Locator> {
  await openShell(page);
  await open(page, "channel");
  await row(page, CHANNEL).click();
  const panel = picked(page);
  await expect(panel.getByTestId("channel-transcript")).toBeVisible();
  return panel;
}

/** Post a line from the channel's panel, and wait until the channel keeps it. */
async function post(panel: Locator, line: string): Promise<void> {
  await panel.getByLabel("Post to this channel").fill(line);
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByTestId("channel-line").filter({ hasText: line })).toHaveCount(1);
}

type Line = { principal: string; author?: string; body: string };

/** The channel's lines as the server keeps them, oldest first. Not graded: used only to wait. */
async function keptLines(page: Page): Promise<Line[]> {
  const res = await page.request.get(`/api/flows/sessions/${CHANNEL}/state?include_items=true&item_types=component&limit=1000`);
  const items = ((await res.json()) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
  return items.filter((item) => item.component === "channel-post").map((item) => item.data!);
}

/**
 * Wait until a seat has answered the post carrying `mark`: a line by a seat
 * after it. Not graded; what did not happen fails on the page, after the
 * reload. It also releases the route's hold, so the next test's post is
 * routed afresh.
 */
async function answerLanded(page: Page, mark: string): Promise<void> {
  await expect
    .poll(async () => {
      const lines = await keptLines(page);
      const at = lines.findIndex((l) => l.author === undefined && l.body.includes(mark));
      return at !== -1 && lines.slice(at + 1).some((l) => l.author !== undefined);
    }, { timeout: 20_000 })
    .toBe(true);
}

/**
 * The channel as drawn after a reload: each line's label and text, oldest
 * first. The transcript mounts before its lines load, so this waits for the
 * person's line carrying `mark` first.
 */
async function drawnAfterReload(page: Page, mark: string): Promise<Array<{ label: string; text: string }>> {
  await page.reload();
  const panel = await openChannel(page);
  const person = page.getByTestId("channel-line-label").getByText("devuser", { exact: true });
  await expect(panel.getByTestId("channel-line").filter({ has: person }).filter({ hasText: mark }).first()).toBeVisible();
  return await panel
    .getByTestId("channel-line")
    .evaluateAll((els) =>
      els.map((el) => ({
        label: el.querySelector('[data-testid="channel-line-label"]')?.textContent ?? "",
        text: el.textContent ?? "",
      })),
    );
}

/** The lines drawn after the one carrying `mark`, up to the next person's line. */
function answersTo(drawn: Array<{ label: string; text: string }>, mark: string) {
  const at = drawn.findIndex((l) => l.label === "devuser" && l.text.includes(mark));
  expect(at, `no line of the person's carries ${mark}`).not.toBe(-1);
  const rest = drawn.slice(at + 1);
  const next = rest.findIndex((l) => l.label === "devuser");
  return next === -1 ? rest : rest.slice(0, next);
}

/** A seat's conversation for a channel: the run the channel started, listed under the seat. */
const channelRun = (page: Page, seat: string, channel: string): Locator =>
  rail(page).locator(`ul[data-leaf="${seat}"] [data-dispatch-run-of="${channel}"]`);

/**
 * `seat`'s conversation for the channel, opened and drawn, or `undefined` when
 * it has none. A seat keeps one conversation per channel.
 *
 * Reloads first, so nothing is picked, then waits for the seat's list to load
 * and the conversation to draw its first turn: a turn counted as missing is
 * read off a loaded conversation, never off one still fetching.
 */
async function channelConversationOf(page: Page, seat: string): Promise<Locator | undefined> {
  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "agent");
  await open(page, seat);
  const leaf = rail(page).locator(`ul[data-leaf="${seat}"]`);
  // The list is loaded once it shows a row or says it has none.
  await expect(leaf.locator("[data-session-id]").or(leaf.getByText("No sessions yet")).first()).toBeVisible();
  const runs = channelRun(page, seat, CHANNEL);
  const count = await runs.count();
  expect(count, `${seat} lists ${count} conversations for ${CHANNEL}`).toBeLessThanOrEqual(1);
  if (count === 0) return undefined;
  await runs.click();
  const conversation = picked(page);
  // A conversation for the channel opens on a person's post.
  await expect(conversation.locator('[data-message-role="user"]').first()).toBeVisible();
  return conversation;
}

test("a line posted to support.help shows as devuser, and is still there after a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const line = `help line ${token()}`;
  const panel = await openChannel(page);
  await expect(page.getByText(/go to the assistant/)).toHaveCount(0);
  await post(panel, line);

  const posted = panel.getByTestId("channel-line").filter({ hasText: line });
  await expect(posted.getByTestId("channel-line-label")).toHaveText("devuser");
  await expect(panel.getByLabel("Post to this channel")).toHaveValue("");
  await answerLanded(page, line);

  await page.reload();
  const kept = (await openChannel(page)).getByTestId("channel-line").filter({ hasText: line });
  await expect(kept).toHaveCount(1);
  await expect(kept.getByTestId("channel-line-label")).toHaveText("devuser");
});

test("a new support.devices conversation keeps the message and the reply across a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const message = `[scenario:talk-to-seat] where is order ${token()}?`;
  await openShell(page);
  await open(page, "agent");
  await open(page, "support.devices");
  await seatRow(page, "support.devices").getByRole("button", { name: "New conversation" }).click();

  const panel = picked(page);
  await panel.getByLabel("Message this seat").fill(message);
  await panel.getByRole("button", { name: "Send" }).click();
  // Read in the conversation: the live view can draw the message while the
  // composer still holds its text, until the server has taken the send.
  await expect(panel.getByRole("log").getByText(message, { exact: true })).toBeVisible();
  await expect(panel.getByText(/\[reply:talk-to-seat\]/)).toBeVisible();

  // The conversation that was opened, so the reload can come back to it.
  const sessionId = await rail(page)
    .locator('ul[data-leaf="support.devices"] [aria-current="true"]')
    .getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "agent");
  await open(page, "support.devices");
  await rail(page).locator(`[data-session-id="${sessionId}"]`).click();
  const kept = picked(page);
  await expect(kept.getByText(message, { exact: true })).toBeVisible();
  await expect(kept.getByText(/\[reply:talk-to-seat\]/)).toBeVisible();
});

test("a failed New conversation shows in the seat's row, opens nothing, and can be pressed again", async ({
  page,
  consoleErrors,
}) => {
  let refuse = true;
  await page.route(
    (url) => url.pathname === "/api/flows/support.accounts/sessions",
    async (route) => {
      if (route.request().method() !== "POST" || !refuse) return route.fallback();
      await route.fulfill({ status: 503, json: { error: { message: "store unavailable" } } });
    },
  );
  await openShell(page);
  await open(page, "agent");
  await open(page, "support.accounts");
  const button = seatRow(page, "support.accounts").getByRole("button", { name: "New conversation" });
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

test("a post to support.help gets one answer, as a line under the specialist it was routed to, kept across a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `answer-token-${token()}`;
  const line = `[route:support.accounts] [scenario:wake] ${mark} where is my refund?`;
  await post(await openChannel(page), line);
  await answerLanded(page, mark);

  const answers = answersTo(await drawnAfterReload(page, mark), mark);
  // One line, by the specialist the post was routed to, and not the post handed back.
  expect(answers.map((l) => l.label)).toEqual(["support.accounts"]);
  expect(answers[0]!.text).toContain("[reply:wake]");
  expect(answers[0]!.text).not.toContain(mark);
});

test("a post that needs a person is one row on escalations in the team panel after a reload, and the line says so", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `case-token-${token()}`;
  await post(await openChannel(page), `[route:support.devices] [scenario:needs-a-person] ${mark} the charger caught fire`);
  await answerLanded(page, mark);
  // The row is written by the channel's own request, a moment after the
  // dispatch. Let it land before the reload; nothing here is graded.
  await expect
    .poll(async () =>
      (await page.request.get(`/api/flows/sessions/${CHANNEL}/resources/${CHANNEL}.escalations`)).text(),
    )
    .toContain(mark);

  const answers = answersTo(await drawnAfterReload(page, mark), mark);
  expect(answers.map((l) => l.label)).toEqual(["support.devices"]);
  expect(answers[0]!.text).toContain("[reply:escalated]");
  const board = page.getByTestId(`board-${CHANNEL}.escalations`);
  await expect(board.locator("li[data-task-id]").filter({ hasText: mark })).toHaveCount(1);
});

test("a post to support.help runs the specialist it was routed to once, in its own conversation for the channel, and nobody else", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const first = `[route:support.fsd] [scenario:wake] wake ${token()} how do I stream a generator?`;
  const second = `[route:support.fsd] [scenario:wake] wake ${token()} and cancel one?`;
  const channel = await openChannel(page);
  for (const line of [first, second]) {
    await post(channel, line);
    await answerLanded(page, line);
  }
  // Time for a wrongly woken seat to run, so its absence below is not a race.
  await page.waitForTimeout(1_500);

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await open(page, "agent");
  await open(page, "support.fsd");
  // One conversation for the channel, whatever else the seat holds.
  await expect(channelRun(page, "support.fsd", CHANNEL)).toHaveCount(1);
  await channelRun(page, "support.fsd", CHANNEL).click();
  const conversation = picked(page);
  for (const line of [first, second]) {
    const heard = conversation.locator('[data-message-role="user"]').filter({ hasText: line });
    await expect(heard).toHaveCount(1);
    await expect(heard).toContainText(`in ${CHANNEL}: ${line}`);
  }
  await expect(conversation.locator('[data-message-role="assistant"]').filter({ hasText: "[reply:wake]" })).not.toHaveCount(0);

  // The other specialists never heard either post.
  for (const seat of SPECIALISTS.filter((s) => s !== "support.fsd")) {
    const other = await channelConversationOf(page, seat);
    if (other === undefined) continue;
    for (const line of [first, second]) {
      await expect(other.locator('[data-message-role="user"]').filter({ hasText: line })).toHaveCount(0);
    }
  }
});

test("a specialist that answers through post-to-channel has one line under its own name, and the line wakes nobody", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `reply-token-${token()}`;
  const line = `[route:support.devices] [scenario:reply-in-channel] ${mark} when do refunds post?`;
  await post(await openChannel(page), line);
  await answerLanded(page, mark);
  // Time for a wrongly woken seat to run, so its absence below is not a race.
  await page.waitForTimeout(1_500);

  const answers = answersTo(await drawnAfterReload(page, mark), mark);
  // The tool's line is the answer: one line, not the tool's and the reply's.
  expect(answers.map((l) => l.label)).toEqual(["support.devices"]);
  expect(answers[0]!.text).toContain(`[reply:in-channel] ${mark}`);

  for (const seat of SPECIALISTS) {
    const routed = seat === "support.devices";
    const conversation = await channelConversationOf(page, seat);
    if (conversation === undefined) {
      expect(routed, `${seat} has no conversation for ${CHANNEL}`).toBe(false);
      continue;
    }
    const turns = conversation.locator('[data-message-role="user"]').filter({ hasText: mark });
    // The routed specialist heard the person's post once; its own line reached no seat.
    await expect(turns, `${seat}'s turns carrying ${mark}`).toHaveCount(routed ? 1 : 0);
    if (routed) await expect(turns).toContainText(`devuser in ${CHANNEL}: ${line}`);
  }
});

test("a post routed to one specialist names a token from the line another specialist answered", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `reply-token-${token()}`;
  const earlier = `[route:support.devices] [scenario:reply-in-channel] ${mark} my laptop will not charge`;
  const channel = await openChannel(page);
  await post(channel, earlier);
  await answerLanded(page, mark);
  const ask = `[route:support.accounts] [scenario:recall] recall ${token()} what did devices say?`;
  await post(channel, ask);
  await answerLanded(page, ask);

  // support.accounts was never sent the earlier post: the token reached it
  // only as one of the channel's recent lines.
  const answers = answersTo(await drawnAfterReload(page, ask), ask);
  expect(answers.map((l) => l.label)).toEqual(["support.accounts"]);
  expect(answers[0]!.text).toContain("[reply:recall]");
  expect(answers[0]!.text).toContain(mark);
});

test("with support.help open, the routed specialist shows as working and then its line lands, with no reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  // Every session stream the page opens, by the session it follows.
  const followed: string[] = [];
  page.on("request", (request) => {
    const match = /^\/api\/flows\/sessions\/([^/]+)\/stream$/.exec(new URL(request.url()).pathname);
    if (match !== null) followed.push(decodeURIComponent(match[1]!));
  });

  const mark = `reply-token-${token()}`;
  const line = `[route:support.devices] [scenario:reply-after-a-hold] ${mark} when do refunds post?`;
  const channel = await openChannel(page);
  await post(channel, line);

  // The routed specialist holds its answer about three seconds: long enough to
  // be seen working. It is the only one working on the post.
  const working = channel.getByTestId("working-row");
  await expect(working).toHaveText(["support.devices is working"]);
  const reply = channel.getByTestId("channel-line").filter({ hasText: `[reply:in-channel] ${mark}` });
  await expect(reply).toHaveCount(0);

  // Then its line lands in the open panel, under its name, and the row clears.
  await expect(reply).toHaveCount(1, { timeout: 15_000 });
  await expect(reply.getByTestId("channel-line-label")).toHaveText("support.devices");
  await expect(working).toHaveCount(0);

  // Only the channel's panel follows its session; the assistant does not.
  expect([...new Set(followed)]).toEqual([CHANNEL]);
});
