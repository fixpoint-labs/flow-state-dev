/**
 * Flow State's composer while a turn runs: a person can type and send, each
 * line waits under the conversation marked "runs when this turn ends", and
 * the lines run in the order typed once the turn ends.
 *
 * The first turn is held 35 seconds, past `queue`'s 30-second wait: under
 * `queue` a waiting `run` is refused with a 503 before the turn ends, so the
 * second answer never comes. While the turn runs, the session holds one
 * waiting `run` on the server, not two: `defer` starts waiting runs in no set
 * order, so the page keeps the third line until the second has started.
 */
import type { Page } from "@playwright/test";
import { test, expect, openKitchenSink, byTestId } from "./fixtures";

/** How long the first turn is held: past `queue`'s 30-second wait. */
const HELD_MS = 35_000;

type RequestRow = {
  id: string;
  actionName: string;
  status: string;
  startedAtMs?: number;
  items?: Array<{ type?: string; role?: string; content?: Array<{ text?: string }> }>;
};

/** The session's `run` requests, oldest first, with their items when asked. */
async function runRequests(page: Page, sessionId: string, query = ""): Promise<RequestRow[]> {
  const res = await page.request.get(`/api/flows/sessions/${encodeURIComponent(sessionId)}/requests?limit=50${query}`);
  expect(res.ok(), await res.text()).toBe(true);
  const { requests } = (await res.json()) as { requests: RequestRow[] };
  return requests.filter((r) => r.actionName === "run").sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
}

/** The person's line a request carries. */
const lineOf = (request: RequestRow) =>
  (request.items ?? [])
    .filter((item) => item.type === "message" && item.role === "user")
    .map((item) => (item.content ?? []).map((c) => c.text ?? "").join(""))
    .join("");

async function send(page: Page, text: string) {
  await byTestId(page, "message-input").fill(text);
  await byTestId(page, "message-submit").click();
  // The box clears once the line is sent or waiting.
  await expect(byTestId(page, "message-input")).toHaveValue("");
}

test("a line sent while a turn runs waits, marked, and the lines run in the order typed", async ({
  page,
  sessionId,
  consoleErrors: _consoleErrors,
}) => {
  test.setTimeout(HELD_MS + 60_000);
  await openKitchenSink(page, sessionId);

  await send(page, "[scenario:held-turn] Start the long one.");
  await expect(byTestId(page, "streaming-indicator")).toBeVisible();

  // The text box takes text mid-turn, with Stop beside Send, and two lines wait, marked, in the order typed.
  await expect(byTestId(page, "message-input")).toBeEnabled();
  await expect(byTestId(page, "turn-stop")).toBeVisible();
  await send(page, "[scenario:line] [line:two] The second line.");
  await send(page, "[scenario:line] [line:three] The third line.");
  const waiting = byTestId(page, "waiting-line");
  await expect(waiting).toHaveCount(2);
  await expect(waiting.nth(0)).toContainText("The second line.");
  await expect(waiting.nth(1)).toContainText("The third line.");
  for (const line of await waiting.all()) await expect(line).toContainText("runs when this turn ends");

  // The first answer keeps streaming: the view stays on it, and no later answer has come.
  await expect(byTestId(page, "streaming-indicator")).toBeVisible();
  const assistant = page.locator('[data-testid="message"][data-message-role="assistant"]:visible');
  await expect(assistant).toHaveCount(0);

  // While it runs, the session holds one waiting `run` beside it, not two.
  for (let sample = 0; sample < 5; sample++) {
    const inProgress = await runRequests(page, sessionId, "&status=in_progress");
    expect(inProgress.length, JSON.stringify(inProgress.map(({ id, status }) => ({ id, status })))).toBe(2);
    await page.waitForTimeout(1_000);
  }

  // After it ends, the second line's answer comes, then the third's.
  await expect(assistant.filter({ hasText: "[answer:held]" })).toHaveCount(1, { timeout: HELD_MS + 10_000 });
  await expect(assistant.filter({ hasText: "[answer:two]" })).toHaveCount(1, { timeout: 20_000 });
  await expect(assistant.filter({ hasText: "[answer:three]" })).toHaveCount(1, { timeout: 20_000 });
  const answers = (await assistant.allTextContents()).map((text) => /\[answer:([a-z]+)\]/.exec(text)?.[1]);
  expect(answers).toEqual(["held", "two", "three"]);
  await expect(waiting).toHaveCount(0);

  // The session has three completed `run` requests, in the order typed.
  await expect
    .poll(async () => (await runRequests(page, sessionId)).map((r) => r.status), { timeout: 20_000 })
    .toEqual(["completed", "completed", "completed"]);
  const runs = await runRequests(page, sessionId, "&include_items=true");
  expect(runs.map(lineOf)).toEqual([
    "[scenario:held-turn] Start the long one.",
    "[scenario:line] [line:two] The second line.",
    "[scenario:line] [line:three] The third line.",
  ]);
});
