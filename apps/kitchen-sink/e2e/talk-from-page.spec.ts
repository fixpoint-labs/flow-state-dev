/**
 * Talking from the page: posting to the support mailbox and messaging a
 * specialist, from the panel the rail opens, against the built app on its
 * scripted model.
 *
 * These write to `support.help`, a mailbox every scenario on this user shares,
 * which is why they live here and not in `workforce-shell.spec.ts` (whose
 * scenarios write to no mailbox). Each one asserts on a token of its own, so a
 * line another test posted can never be the one that passes it.
 *
 * The mailbox is routed: each post from a person goes to one specialist, and a
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
 * lands as one line under its name), BR-6 (an answer through `post-to-mailbox`
 * is still one line, and wakes nobody), BR-7 (a routed turn sees the lines
 * another specialist answered), BR-8 (a case that needs a person is one row on
 * `escalations`), BR-13 (a new conversation on a specialist keeps both sides
 * across a reload).
 *
 * And, re-pointed at this roster, by `specs/issues/FIX-1585/BUSINESS-RULES.md`:
 * BR-1 and BR-2 (a line labelled `devuser` survives a reload), BR-17 (a failed
 * "Talk" shows in the worker's roster row, opens nothing, and can be pressed
 * again). FIX-1585's BR-15 (a seat of a kind with no action takes no
 * messages) is checked on the panel itself, in `test/picked-session-panel`:
 * the rail lists only the kinds the shell names, so a seat of any other kind
 * never reaches the page.
 *
 * And by `specs/issues/FIX-1609/BUSINESS-RULES.md`, re-pointed at this
 * roster: BR-1, BR-7 and BR-8 (with the mailbox open, the routed specialist
 * shows as working, then its line lands and the row clears, with no
 * reload), BR-20 and BR-21 (the panel is the only view that follows its
 * session: one session stream, for `support.help`, and none for the
 * assistant). That one is read before any reload, on purpose: what it
 * checks is the page keeping up by itself.
 *
 * And by `specs/issues/FIX-1622/BUSINESS-RULES.md`: BR-1 and BR-2 (a case
 * filed while the page is open shows on escalations with no reload, as one
 * row with its status word, and no status columns), BR-21 (each row is still
 * an `li[data-task-id]` in the board's panel). Also read before any reload.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/*
 * Workers as data (FIX-1788): every specialist runs on the one `agent` copy,
 * and a conversation with one is a session of that copy that names the worker
 * when it is created. A person starts one with "Talk" on the roster panel. The
 * rail lists the copy's conversations, so which worker a conversation belongs
 * to is read from the server, by the session's `workerId`, and the
 * conversation itself is opened and read on the page.
 */

// One at a time, in file order: see the header.
test.describe.configure({ mode: "default" });

const MAILBOX = "support.help";
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

/** The flow every specialist runs on, registered as one copy at its kind. */
const WORKER_FLOW = "agent";

/** A worker's row on the roster panel, with its "Talk". */
const rosterRow = (page: Page, worker: string): Locator =>
  page.locator(`[data-testid="roster"]:visible [data-worker-id="${worker}"]`);

/** Open the worker flow's kind and its one copy in the rail, unless already open. */
async function openWorkerCopy(page: Page): Promise<Locator> {
  for (const button of [
    rail(page).locator(`button[data-kind="${WORKER_FLOW}"]`),
    rail(page).locator(`button[data-instance-id="${WORKER_FLOW}"]`),
  ]) {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  }
  const leaf = rail(page).locator(`ul[data-leaf="${WORKER_FLOW}"]`);
  // The list is loaded once it shows a row or says it has none.
  await expect(leaf.locator("[data-session-id]").or(leaf.getByText("No sessions yet")).first()).toBeVisible();
  return leaf;
}

type WorkerSession = { id: string; parentSessionId?: string | null };

/**
 * The person's sessions with `worker`, as the server lists them by the
 * session's readonly `workerId`; with `runs`, the conversations a mailbox
 * started for it too. Not graded on its own: what each holds is read on the page.
 */
async function sessionsOf(page: Page, worker: string, runs = false): Promise<WorkerSession[]> {
  const query = `flowId=${WORKER_FLOW}&userId=devuser&state.workerId=${encodeURIComponent(worker)}&limit=100${runs ? "&include=dispatch-runs" : ""}`;
  const res = await page.request.get(`/api/flows/sessions?${query}`);
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { sessions: WorkerSession[] }).sessions;
}

const token = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Open the mailbox's panel. */
async function openMailbox(page: Page): Promise<Locator> {
  await openShell(page);
  await open(page, "mailbox");
  await row(page, MAILBOX).click();
  const panel = picked(page);
  await expect(panel.getByTestId("mailbox-transcript")).toBeVisible();
  return panel;
}

/** Post a line from the mailbox's panel, and wait until the mailbox keeps it. */
async function post(panel: Locator, line: string): Promise<void> {
  await panel.getByLabel("Post to this mailbox").fill(line);
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByTestId("mailbox-line").filter({ hasText: line })).toHaveCount(1);
}

type Line = { principal: string; author?: string; body: string };

/** The mailbox's lines as the server keeps them, oldest first. Not graded: used only to wait. */
async function keptLines(page: Page): Promise<Line[]> {
  const res = await page.request.get(`/api/flows/sessions/${MAILBOX}/state?include_items=true&item_types=component&limit=1000`);
  const items = ((await res.json()) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
  return items.filter((item) => item.component === "mailbox-post").map((item) => item.data!);
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
 * The mailbox as drawn after a reload: each line's label and text, oldest
 * first. The transcript mounts before its lines load, so this waits for the
 * person's line carrying `mark` first.
 */
async function drawnAfterReload(page: Page, mark: string): Promise<Array<{ label: string; text: string }>> {
  await page.reload();
  const panel = await openMailbox(page);
  const person = page.getByTestId("mailbox-line-label").getByText("devuser", { exact: true });
  await expect(panel.getByTestId("mailbox-line").filter({ has: person }).filter({ hasText: mark }).first()).toBeVisible();
  return await panel
    .getByTestId("mailbox-line")
    .evaluateAll((els) =>
      els.map((el) => ({
        label: el.querySelector('[data-testid="mailbox-line-label"]')?.textContent ?? "",
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

/**
 * `seat`'s conversation for the mailbox, opened and drawn, or `undefined` when
 * it has none. A worker keeps one conversation per mailbox: the run the
 * mailbox started, created naming the worker.
 *
 * Reloads first, so nothing is picked, then waits for the copy's list to load
 * and the conversation to draw its first turn: a turn counted as missing is
 * read off a loaded conversation, never off one still fetching.
 */
async function mailboxConversationOf(page: Page, seat: string): Promise<Locator | undefined> {
  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  const runs = (await sessionsOf(page, seat, true)).filter((s) => s.parentSessionId === MAILBOX);
  expect(runs.length, `${seat} has ${runs.length} conversations for ${MAILBOX}`).toBeLessThanOrEqual(1);
  if (runs.length === 0) return undefined;
  const leaf = await openWorkerCopy(page);
  const run = leaf.locator(`[data-session-id="${runs[0]!.id}"]`);
  // Listed as the run the mailbox started.
  await expect(run).toHaveAttribute("data-dispatch-run-of", MAILBOX);
  await run.click();
  const conversation = picked(page);
  // A conversation for the mailbox opens on a person's post.
  await expect(conversation.locator('[data-message-role="user"]').first()).toBeVisible();
  return conversation;
}

test("a line posted to support.help shows as devuser, and is still there after a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const line = `help line ${token()}`;
  const panel = await openMailbox(page);
  await expect(page.getByText(/go to the assistant/)).toHaveCount(0);
  await post(panel, line);

  const posted = panel.getByTestId("mailbox-line").filter({ hasText: line });
  await expect(posted.getByTestId("mailbox-line-label")).toHaveText("devuser");
  await expect(panel.getByLabel("Post to this mailbox")).toHaveValue("");
  await answerLanded(page, line);

  await page.reload();
  const kept = (await openMailbox(page)).getByTestId("mailbox-line").filter({ hasText: line });
  await expect(kept).toHaveCount(1);
  await expect(kept.getByTestId("mailbox-line-label")).toHaveText("devuser");
});

/**
 * The reply to `message` in a worker conversation: the assistant message drawn
 * in the same request as it. "Talk" reopens the person's one conversation with
 * the worker, and the scripted reply is the same text every time, so a reply
 * matched on its text alone also matches every earlier turn's.
 */
const replyTo = (conversation: Locator, message: string): Locator =>
  conversation
    .locator("[data-request-id]")
    .filter({ has: conversation.page().locator('[data-message-role="user"]').filter({ hasText: message }) })
    .locator('[data-message-role="assistant"]')
    .filter({ hasText: "[reply:talk-to-seat]" });

test("a new support.devices conversation keeps the message and the reply across a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const message = `[scenario:talk-to-seat] where is order ${token()}?`;
  await openShell(page);
  await rosterRow(page, "support.devices").getByTestId("roster-talk").click();

  const panel = picked(page);
  await panel.getByLabel("Message this seat").fill(message);
  await panel.getByRole("button", { name: "Send" }).click();
  // Read in the conversation: the live view can draw the message while the
  // composer still holds its text, until the server has taken the send.
  await expect(panel.getByRole("log").getByText(message, { exact: true })).toBeVisible();
  await expect(replyTo(panel, message)).toBeVisible();

  // The conversation that was opened, so the reload can come back to it. It
  // is a session the server lists as the person's with the worker.
  const sessionId = await (await openWorkerCopy(page)).locator('[aria-current="true"]').getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  expect((await sessionsOf(page, "support.devices")).map((s) => s.id)).toContain(sessionId);

  await page.reload();
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
  await (await openWorkerCopy(page)).locator(`[data-session-id="${sessionId}"]`).click();
  const kept = picked(page);
  await expect(kept.getByText(message, { exact: true })).toBeVisible();
  await expect(replyTo(kept, message)).toBeVisible();
});

test("a failed Talk shows in the worker's roster row, opens nothing, and can be pressed again", async ({
  page,
  consoleErrors,
}) => {
  let refuse = true;
  // "Talk" finds the person's session with the worker, or creates one. Refuse
  // both, so the press fails whichever it would have done.
  await page.route(
    (url) =>
      url.pathname === `/api/flows/${WORKER_FLOW}/sessions` ||
      (url.pathname === "/api/flows/sessions" && url.searchParams.get("state.workerId") === "support.accounts"),
    async (route) => {
      if (!refuse) return route.fallback();
      await route.fulfill({ status: 503, json: { error: { message: "store unavailable" } } });
    },
  );
  await openShell(page);
  const worker = rosterRow(page, "support.accounts");
  const button = worker.getByTestId("roster-talk");
  await button.click();

  await expect(worker.getByTestId("roster-talk-error")).toContainText("Could not open a conversation");
  await expect(picked(page)).toHaveCount(0);

  refuse = false;
  await button.click();
  await expect(picked(page).getByLabel("Message this seat")).toBeVisible();
  await expect(worker.getByTestId("roster-talk-error")).toHaveCount(0);
  // The refused create's own 503 is the one console error this scenario causes.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !e.includes("503")));
});

test("a post to support.help gets one answer, as a line under the specialist it was routed to, kept across a reload", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `answer-token-${token()}`;
  const line = `[route:support.accounts] [scenario:wake] ${mark} where is my refund?`;
  await post(await openMailbox(page), line);
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
  await post(await openMailbox(page), `[route:support.devices] [scenario:needs-a-person] ${mark} the charger caught fire`);
  await answerLanded(page, mark);
  // The row is written by the mailbox's own request, a moment after the
  // dispatch. Let it land before the reload; nothing here is graded.
  await expect
    .poll(async () =>
      (await page.request.get(`/api/flows/sessions/${MAILBOX}/resources/${MAILBOX}.escalations`)).text(),
    )
    .toContain(mark);

  const answers = answersTo(await drawnAfterReload(page, mark), mark);
  expect(answers.map((l) => l.label)).toEqual(["support.devices"]);
  expect(answers[0]!.text).toContain("[reply:escalated]");
  const board = page.getByTestId(`board-${MAILBOX}.escalations`);
  await expect(board.locator("li[data-task-id]").filter({ hasText: mark })).toHaveCount(1);
});

test("a post that needs a person shows on escalations in the team panel with no reload, as one row in a list with its status", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `case-token-${token()}`;
  const mailbox = await openMailbox(page);
  // The board is read before the post, so a row that shows afterwards came
  // from the page keeping up by itself, not from that read.
  const board = page.getByTestId(`board-${MAILBOX}.escalations`);
  await expect(board.locator('[data-panel="board"]')).toBeVisible();
  await expect(board.locator('[data-state="loading"]')).toHaveCount(0);

  await post(mailbox, `[route:support.devices] [scenario:needs-a-person] ${mark} the charger caught fire`);

  const filed = board.locator("li[data-task-id]").filter({ hasText: mark });
  await expect(filed).toHaveCount(1, { timeout: 15_000 });
  await expect(filed.locator("[data-task-status]")).toHaveText("pending");
  // One list, not a column per status.
  await expect(board.locator("[data-column]")).toHaveCount(0);
  await answerLanded(page, mark);
});

test("a post to support.help runs the specialist it was routed to once, in its own conversation for the mailbox, and nobody else", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const first = `[route:support.fsd] [scenario:wake] wake ${token()} how do I stream a generator?`;
  const second = `[route:support.fsd] [scenario:wake] wake ${token()} and cancel one?`;
  const mailbox = await openMailbox(page);
  for (const line of [first, second]) {
    await post(mailbox, line);
    await answerLanded(page, line);
  }
  // Time for a wrongly woken seat to run, so its absence below is not a race.
  await page.waitForTimeout(1_500);

  // One conversation for the mailbox, whatever else the worker holds.
  const conversation = await mailboxConversationOf(page, "support.fsd");
  expect(conversation, `support.fsd has no conversation for ${MAILBOX}`).toBeDefined();
  for (const line of [first, second]) {
    const heard = conversation!.locator('[data-message-role="user"]').filter({ hasText: line });
    await expect(heard).toHaveCount(1);
    await expect(heard).toContainText(`in ${MAILBOX}: ${line}`);
  }
  await expect(conversation!.locator('[data-message-role="assistant"]').filter({ hasText: "[reply:wake]" })).not.toHaveCount(0);

  // The other specialists never heard either post.
  for (const seat of SPECIALISTS.filter((s) => s !== "support.fsd")) {
    const other = await mailboxConversationOf(page, seat);
    if (other === undefined) continue;
    for (const line of [first, second]) {
      await expect(other.locator('[data-message-role="user"]').filter({ hasText: line })).toHaveCount(0);
    }
  }
});

test("a specialist that answers through post-to-mailbox has one line under its own name, and the line wakes nobody", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `reply-token-${token()}`;
  const line = `[route:support.devices] [scenario:reply-in-mailbox] ${mark} when do refunds post?`;
  await post(await openMailbox(page), line);
  await answerLanded(page, mark);
  // Time for a wrongly woken seat to run, so its absence below is not a race.
  await page.waitForTimeout(1_500);

  const answers = answersTo(await drawnAfterReload(page, mark), mark);
  // The tool's line is the answer: one line, not the tool's and the reply's.
  expect(answers.map((l) => l.label)).toEqual(["support.devices"]);
  expect(answers[0]!.text).toContain(`[reply:in-mailbox] ${mark}`);

  for (const seat of SPECIALISTS) {
    const routed = seat === "support.devices";
    const conversation = await mailboxConversationOf(page, seat);
    if (conversation === undefined) {
      expect(routed, `${seat} has no conversation for ${MAILBOX}`).toBe(false);
      continue;
    }
    const turns = conversation.locator('[data-message-role="user"]').filter({ hasText: mark });
    // The routed specialist heard the person's post once; its own line reached no seat.
    await expect(turns, `${seat}'s turns carrying ${mark}`).toHaveCount(routed ? 1 : 0);
    if (routed) await expect(turns).toContainText(`devuser in ${MAILBOX}: ${line}`);
  }
});

test("a post routed to one specialist names a token from the line another specialist answered", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const mark = `reply-token-${token()}`;
  const earlier = `[route:support.devices] [scenario:reply-in-mailbox] ${mark} my laptop will not charge`;
  const mailbox = await openMailbox(page);
  await post(mailbox, earlier);
  await answerLanded(page, mark);
  const ask = `[route:support.accounts] [scenario:recall] recall ${token()} what did devices say?`;
  await post(mailbox, ask);
  await answerLanded(page, ask);

  // support.accounts was never sent the earlier post: the token reached it
  // only as one of the mailbox's recent lines.
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
  const mailbox = await openMailbox(page);
  await post(mailbox, line);

  // The routed specialist holds its answer about three seconds: long enough to
  // be seen working. It is the only one working on the post.
  const working = mailbox.getByTestId("working-row");
  await expect(working).toHaveText(["support.devices is working"]);
  const reply = mailbox.getByTestId("mailbox-line").filter({ hasText: `[reply:in-mailbox] ${mark}` });
  await expect(reply).toHaveCount(0);

  // Then its line lands in the open panel, under its name, and the row clears.
  await expect(reply).toHaveCount(1, { timeout: 15_000 });
  await expect(reply.getByTestId("mailbox-line-label")).toHaveText("support.devices");
  await expect(working).toHaveCount(0);

  // Only the mailbox's session is followed, by its panel and by the team
  // panel's board; the assistant's is not.
  expect([...new Set(followed)]).toEqual([MAILBOX]);
});
