/**
 * Goal check: Codex mode in Kitchen Sink keeps one Codex thread per session,
 * survives a stop and a reload, shows a thread Codex no longer has as refused
 * without replacing it, shows its steps while it runs, and says Codex reports
 * no plan.
 *
 * Real path: real Codex on a signed-in host, `next dev`, one real browser.
 * Out of CI. See goal.md for the contract.
 *
 * Legs:
 *
 *   host   Codex mode is available here; otherwise the picker's reason, and nothing else is graded.
 *   l      a step of Codex's shows before turn 1 completes.
 *   p      the panel says "Codex reports no plan"; never "No plan recorded for this turn".
 *   c      turn 2 names the token without being told it, under turn 1's id.
 *   s      a stopped turn says so, and the next turn names the token under the same id.
 *   r      a reload lands back in the same session, which shows the same id, and its next turn names the token.
 *   x      in a second session, with its thread's record removed from the Codex home between turns,
 *          the next turn shows Codex refused that id and keeps it, and the turn after asks for it again.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/codex-continues-its-thread/run.mts
 * Control:  GOAL_CONTROL=no-resume (must FAIL at c, s, r and x, and nothing else)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { KITCHEN_SINK, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";

const PORT = 3049;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** How long one real Codex turn may take. */
const TURN_MS = 240_000;
/** The Codex home the server's runs use: Kitchen Sink hands Codex `CODEX_HOME` and `HOME` as they are here. */
const CODEX_HOME = process.env.CODEX_HOME !== undefined && process.env.CODEX_HOME !== "" ? process.env.CODEX_HOME : join(homedir(), ".codex");

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  "no-resume": ["c", "s", "r", "x"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** `next dev`, so the unset workspace setting means "the checkout the server runs in". */
async function startDev(): Promise<{ stop: () => void; log: () => string }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    KITCHEN_SINK_TEST_MODE: "1",
    NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
    KITCHEN_SINK_REAL_HARNESS: "1",
    STORE_TYPE: "filesystem",
    ...(CONTROL === "" ? {} : { GOAL_CONTROL: CONTROL }),
  };
  delete env.KITCHEN_SINK_HARNESS_WORKSPACE;
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    cwd: KITCHEN_SINK,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  for (let i = 0; i < 240; i += 1) {
    const status = await fetch(`${ORIGIN}/api/flows`).then((r) => r.status, () => undefined);
    if (status === 200) return { stop: () => stopProcessGroup(child), log: () => log };
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopProcessGroup(child);
  throw new Error(`next dev never served ${ORIGIN}/api/flows:\n${log}`);
}

const bound = (page: Page) => page.getByTestId("bound-conversation");
const notice = (page: Page) => page.getByTestId("turn-notice");
const stopButton = (page: Page) => page.getByRole("button", { name: "Stop" });

async function boundId(page: Page): Promise<string> {
  return ((await bound(page).textContent()) ?? "").trim();
}

/** The bound id once a freshly loaded page has read it: it draws "none yet" until the session's state arrives. */
async function loadedBoundId(page: Page): Promise<string> {
  await page
    .waitForFunction(
      () => {
        const text = document.querySelector('[data-testid="bound-conversation"]')?.textContent?.trim();
        return text !== undefined && text !== "none yet";
      },
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  return boundId(page);
}

/** How many times `token` shows in the conversation, as drawn. */
async function tokenCount(page: Page, token: string): Promise<number> {
  const text = (await page.getByTestId("conversation").textContent()) ?? "";
  return text.split(token).length - 1;
}

/** Open a new session at `/codex`, and return its id. */
async function newSession(page: Page): Promise<string> {
  await page.goto(`${ORIGIN}/codex`);
  await page.getByTestId("new-session").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
  return (await page.getByTestId("stream").getAttribute("data-session-id"))!;
}

/** Send a turn and wait for it to end. Returns whether a Codex step showed while it ran, and the notice's kind. */
async function turn(page: Page, prompt: string): Promise<{ sawStepWhileRunning: boolean; kind: string | null }> {
  const commandRows = () => page.getByTestId("conversation").locator('[data-testid="tool-group"], [data-testid="tool-row"]').count();
  const rowsBefore = await commandRows();
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
  await stopButton(page).waitFor({ state: "visible", timeout: 30_000 });
  let sawStepWhileRunning = false;
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline) {
    if (!(await stopButton(page).isVisible())) break;
    // A command row while the turn still runs: one of Codex's steps, not the working indicator.
    if ((await commandRows()) > rowsBefore) sawStepWhileRunning = true;
    await page.waitForTimeout(500);
  }
  await notice(page).waitFor({ state: "visible", timeout: 30_000 });
  return { sawStepWhileRunning, kind: await notice(page).getAttribute("data-kind") };
}

/** Every file under `dir`, or none when it doesn't exist. */
function filesUnder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Remove `threadId`'s record from the Codex home, the way a person's cleared
 * history loses it: Codex keeps each thread as a rollout file named with its id.
 * Only a thread this run created is ever touched.
 */
function forgetThread(threadId: string): string[] {
  const removed = ["sessions", "archived_sessions"]
    .flatMap((folder) => filesUnder(join(CODEX_HOME, folder)))
    .filter((path) => path.endsWith(".jsonl") && path.includes(threadId));
  for (const path of removed) rmSync(path);
  return removed;
}

/** How many to-do lists Codex reported in the session's turns, read from their items (BR-14). */
async function todoLists(page: Page, sessionId: string): Promise<number> {
  const requests = (await page.evaluate(async (id) => {
    const res = await fetch(`/api/flows/sessions/${encodeURIComponent(id)}/requests?include_items=true`);
    return ((await res.json()) as { requests: unknown[] }).requests;
  }, sessionId)) as Array<{ items?: Array<Record<string, unknown>> }>;
  return requests
    .flatMap((request) => request.items ?? [])
    .filter((item) => (item.toolCall as { name?: string } | undefined)?.name === "todo_list").length;
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const token = `ks-goal-${randomBytes(6).toString("hex")}`;

  const server = await startDev();
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();

    // ---- host: the mode is available here
    await page.goto(`${ORIGIN}/`);
    const card = page.locator('[data-mode-id="codex"]');
    await card.waitFor({ timeout: 60_000 });
    if ((await card.getAttribute("data-available")) !== "true") {
      fail("host", `Codex mode is unavailable here: ${await card.getByTestId("mode-reason").textContent()}`);
      return { failures, evidence: "" };
    }

    const sessionId = await newSession(page);
    evidence.push(`session ${sessionId}, token ${token}, Codex home ${CODEX_HOME}`);

    // ---- turn 1: the token, and a command
    const first = await turn(
      page,
      `Remember this token for later: ${token}. Then run the shell command \`ls\` in the current directory, and reply "noted".`,
    );
    if (!first.sawStepWhileRunning) fail("l", "nothing of Codex's showed before turn 1 completed");
    const id1 = await boundId(page);
    evidence.push(`turn 1 ${first.kind}, bound ${id1}`);

    // ---- p: the panel says Codex reports no plan
    const panel = page.getByTestId("plan-panel");
    const planState = await panel.locator("[data-plan-state]").getAttribute("data-plan-state", { timeout: 15_000 }).catch(() => null);
    const panelText = ((await panel.textContent()) ?? "").trim();
    if (planState !== "undeclared" || !panelText.includes("Codex reports no plan")) {
      fail("p", `the panel (${planState}) reads ${JSON.stringify(panelText)} (want "Codex reports no plan")`);
    }
    evidence.push(`panel ${planState}`);

    // ---- c: turn 2 names the token without being told it, under the same id
    const seen = await tokenCount(page, token);
    await turn(page, "What token did I ask you to remember? Answer with the token only.");
    const id2 = await boundId(page);
    if ((await tokenCount(page, token)) <= seen) fail("c", "turn 2's reply did not name the token");
    if (id2 !== id1) fail("c", `the thread moved from ${id1} to ${id2}`);

    // ---- s: stop a long turn; the next turn continues
    const input = page.getByTestId("message-input");
    await input.fill("Run the shell command `sleep 120`, then reply done.");
    await input.press("Enter");
    await stopButton(page).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(8_000);
    await stopButton(page).click();
    const stopped = await notice(page).getAttribute("data-kind", { timeout: 30_000 }).catch(() => null);
    if (stopped !== "stopped") fail("s", `after the stop the notice reads ${JSON.stringify(stopped)} (want stopped)`);
    const seenS = await tokenCount(page, token);
    await turn(page, "Which token was it again? Answer with the token only.");
    if ((await tokenCount(page, token)) <= seenS) fail("s", "after the stop, the next turn did not name the token");
    if ((await boundId(page)) !== id1) fail("s", `after the stop the thread is ${await boundId(page)} (want ${id1})`);

    // ---- r: a reload lands back in the session, on its thread
    await page.reload();
    const back = await page
      .waitForFunction((id) => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id") === id, sessionId, {
        timeout: 30_000,
      })
      .then(() => true, () => false);
    if (!back) {
      fail("r", `after a reload the page is not back in session ${sessionId}: ${JSON.stringify(await page.getByTestId("stream").textContent())}`);
    } else {
      const reloaded = await loadedBoundId(page);
      if (reloaded !== id1) fail("r", `after a reload the session shows ${reloaded} (want ${id1})`);
      const seenR = await tokenCount(page, token);
      await turn(page, "One more time: the token, only.");
      if ((await tokenCount(page, token)) <= seenR) fail("r", "after a reload, the next turn did not name the token");
      if ((await boundId(page)) !== id1) fail("r", `after a reload the thread moved to ${await boundId(page)}`);
    }
    evidence.push(`ids ${id1} → ${id2} → ${await boundId(page)}`);
    const lists = await todoLists(page, sessionId);
    evidence.push(`to-do lists Codex reported in session 1: ${lists}`);

    // ---- x: a thread Codex no longer has is shown refused, kept, and asked for again
    const second = await newSession(page);
    await turn(page, 'Reply "hello".');
    const idX = await loadedBoundId(page);
    const removed = idX === "none yet" ? [] : forgetThread(idX);
    evidence.push(`session ${second} bound ${idX}; removed ${removed.length} record(s)`);
    if (removed.length === 0) {
      fail("x", `no record of thread ${idX} was found under ${CODEX_HOME} to remove`);
    } else {
      const refused = await turn(page, 'Reply "again".');
      const text = ((await notice(page).textContent()) ?? "").trim();
      if (refused.kind !== "refused" || !text.includes(idX)) {
        fail("x", `after the record was removed the notice is ${refused.kind}: ${JSON.stringify(text)} (want refused, naming ${idX})`);
      }
      if ((await boundId(page)) !== idX) fail("x", `after the refusal the session shows ${await boundId(page)} (want ${idX})`);
      const retried = await turn(page, 'Reply "once more".');
      const retriedText = ((await notice(page).textContent()) ?? "").trim();
      if (retried.kind !== "refused" || !retriedText.includes(idX)) {
        fail("x", `the turn after the refusal is ${retried.kind}: ${JSON.stringify(retriedText)} (want refused again, naming ${idX})`);
      }
      if ((await boundId(page)) !== idX) fail("x", `the turn after the refusal moved the session to ${await boundId(page)}`);
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
