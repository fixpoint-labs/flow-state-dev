/**
 * Goal check: Cursor mode in Kitchen Sink keeps one Cursor agent per session,
 * survives a stop and a reload, shows its steps while it runs, and shows the
 * to-do list Cursor last confirmed.
 *
 * Real path: real Cursor on a host with a Cursor key or stored login,
 * `next dev`, one real browser. Out of CI. See goal.md for the contract.
 *
 * Legs:
 *
 *   host   Cursor mode is available here; otherwise the picker's reason, and nothing else is graded.
 *   l      one of Cursor's items shows before turn 1 completes.
 *   p      the panel equals turn 1's last confirmed to-do list, read from its items; or says empty / none recorded; never "reports no plan".
 *   c      turn 2 names the token without being told it, under turn 1's id.
 *   s      a stopped turn says so, and the next turn names the token under the same id.
 *   r      a reload lands back in the same session, which shows the same id, and its next turn names the token.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/cursor-continues-its-agent/run.mts
 * Controls: GOAL_CONTROL=no-resume (must FAIL at c, s and r, and nothing else)
 *           GOAL_CONTROL=no-record (must FAIL at p, and nothing else)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Page } from "playwright";
import { KITCHEN_SINK, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";

const PORT = 3048;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** How long one real Cursor turn may take. */
const TURN_MS = 240_000;

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  "no-resume": ["c", "s", "r"],
  "no-record": ["p"],
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

/** Send a turn and wait for it to end. Returns whether a Cursor item showed while it ran. */
async function turn(page: Page, prompt: string): Promise<{ sawStepWhileRunning: boolean }> {
  const conversationText = async () => (await page.getByTestId("conversation").textContent()) ?? "";
  const withPrompt = (await conversationText()).length + prompt.length;
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
  await stopButton(page).waitFor({ state: "visible", timeout: 30_000 });
  let sawStepWhileRunning = false;
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline) {
    if (!(await stopButton(page).isVisible())) break;
    // Text beyond the prompt while the turn still runs: one of Cursor's items.
    if ((await conversationText()).length > withPrompt) sawStepWhileRunning = true;
    await page.waitForTimeout(500);
  }
  await page.getByTestId("turn-notice").waitFor({ state: "visible", timeout: 30_000 });
  return { sawStepWhileRunning };
}

/** A to-do item as Cursor's `updateTodos` result carries it. */
interface Todo {
  readonly content?: string;
  readonly status?: string;
}

/**
 * The session's latest turn's last confirmed to-do list, from its own items:
 * the last settled `updateTodos` step whose result succeeded. `null` when the
 * turn has no such step. Read through the app's own API, from the page, as the
 * app reads it.
 */
async function lastConfirmedList(page: Page, sessionId: string): Promise<{ list: Todo[] | null; calls: number }> {
  const requests = (await page.evaluate(async (id) => {
    const res = await fetch(`/api/flows/sessions/${encodeURIComponent(id)}/requests?include_items=true`);
    return ((await res.json()) as { requests: unknown[] }).requests;
  }, sessionId)) as Array<{ actionName: string; startedAtMs?: number; items?: Array<Record<string, unknown>> }>;
  const latest = requests
    .filter((r) => r.actionName === "turn")
    .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0))
    .at(-1);
  let list: Todo[] | null = null;
  let calls = 0;
  for (const item of latest?.items ?? []) {
    const call = item.toolCall as { name?: string } | undefined;
    if (item.type !== "tool_output" || call?.name !== "updateTodos") continue;
    calls += 1;
    const output = item.output as { status?: string; value?: { todos?: Todo[] } } | null;
    if (item.status === "completed" && output?.status === "success" && Array.isArray(output.value?.todos)) {
      list = output.value.todos;
    }
  }
  return { list, calls };
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
    const card = page.locator('[data-mode-id="cursor"]');
    await card.waitFor({ timeout: 60_000 });
    if ((await card.getAttribute("data-available")) !== "true") {
      fail("host", `Cursor mode is unavailable here: ${await card.getByTestId("mode-reason").textContent()}`);
      return { failures, evidence: "" };
    }

    await page.goto(`${ORIGIN}/cursor`);
    await page.getByTestId("new-session").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
    const sessionId = (await page.getByTestId("stream").getAttribute("data-session-id"))!;
    evidence.push(`session ${sessionId}, token ${token}`);

    // ---- turn 1: the token, and a plan
    const first = await turn(
      page,
      `Remember this token for later: ${token}. Use your to-do list to plan three small steps for listing the files in the current directory, work through them, and reply "noted".`,
    );
    if (!first.sawStepWhileRunning) fail("l", "nothing of Cursor's showed before turn 1 completed");
    const id1 = await boundId(page);
    evidence.push(`turn 1 bound ${id1}`);

    // ---- p: the panel equals the turn's last confirmed list, or says why there is none
    const panel = page.getByTestId("plan-panel");
    const { list, calls } = await lastConfirmedList(page, sessionId);
    evidence.push(`turn 1 sent ${calls} updateTodos call(s); last confirmed list ${list === null ? "none" : `of ${list.length}`}`);
    await page.waitForTimeout(2_000);
    const panelText = (await panel.textContent()) ?? "";
    const planState = await panel.locator("[data-plan-state]").getAttribute("data-plan-state", { timeout: 15_000 }).catch(() => null);
    if (/reports no plan/i.test(panelText)) fail("p", `the panel reads ${JSON.stringify(panelText)}`);
    if (list === null) {
      if (planState !== "none") fail("p", `turn 1 has no confirmed list, but the panel is ${planState} (want none)`);
    } else if (list.length === 0) {
      if (planState !== "empty") fail("p", `turn 1's confirmed list is empty, but the panel is ${planState} (want empty)`);
    } else {
      const rows = await panel.getByTestId("plan-row").evaluateAll((lis) =>
        lis.map((li) => ({
          title: li.firstElementChild?.textContent?.trim() ?? "",
          status: li.querySelector('[data-testid="plan-row-status"]')?.textContent?.trim() ?? "",
        })),
      );
      const want = list.map((t) => ({ title: t.content ?? "", status: t.status ?? "no status" }));
      if (planState !== "rows" || JSON.stringify(rows) !== JSON.stringify(want)) {
        fail("p", `the panel (${planState}) shows ${JSON.stringify(rows)}; Cursor confirmed ${JSON.stringify(want)}`);
      }
    }
    evidence.push(`panel ${planState} (${await panel.getByTestId("plan-row").count()} rows)`);

    // ---- c: turn 2 names the token without being told it, under the same id
    const seen = await tokenCount(page, token);
    await turn(page, "What token did I ask you to remember? Answer with the token only.");
    const id2 = await boundId(page);
    if ((await tokenCount(page, token)) <= seen) fail("c", "turn 2's reply did not name the token");
    if (id2 !== id1) fail("c", `the agent moved from ${id1} to ${id2}`);

    // ---- s: stop a long turn; the next turn continues
    const input = page.getByTestId("message-input");
    await input.fill("Run the shell command `sleep 120`, then reply done.");
    await input.press("Enter");
    await stopButton(page).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(8_000);
    await stopButton(page).click();
    const stopped = await page.getByTestId("turn-notice").getAttribute("data-kind", { timeout: 30_000 }).catch(() => null);
    if (stopped !== "stopped") fail("s", `after the stop the notice reads ${JSON.stringify(stopped)} (want stopped)`);
    const seenS = await tokenCount(page, token);
    await turn(page, "Which token was it again? Answer with the token only.");
    if ((await tokenCount(page, token)) <= seenS) fail("s", "after the stop, the next turn did not name the token");
    if ((await boundId(page)) !== id1) fail("s", `after the stop the agent is ${await boundId(page)} (want ${id1})`);

    // ---- r: a reload lands back in the session, on its agent
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
      if ((await boundId(page)) !== id1) fail("r", `after a reload the agent moved to ${await boundId(page)}`);
    }
    evidence.push(`ids ${id1} → ${id2} → ${await boundId(page)}`);
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
