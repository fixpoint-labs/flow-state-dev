/**
 * Goal check: Claude Code mode in Kitchen Sink keeps one conversation per
 * session, works in the session's own worktree, survives a stop and a reload,
 * shows its steps while it runs, and shows what it recorded of its plan.
 *
 * Real path: real Claude Code on a signed-in host, `next dev`, one real
 * browser. Out of CI. See goal.md for the contract.
 *
 * Legs:
 *
 *   host   Claude Code mode is available here; otherwise the picker's reason, and nothing else is graded.
 *   l      one of Claude Code's items shows before turn 1 completes.
 *   w      turn 1's file is in the session's worktree, on the session's branch; the main checkout is unchanged.
 *   p      turn 1 asked for a plan, so the panel shows its rows: never "no plan recorded" or "reports no plan".
 *   c      turn 2 names the token without being told it, under turn 1's id.
 *   s      a stopped turn says so, and the next turn names the token under the same id.
 *   r      a reload lands back in the same session, which shows the same id, and its next turn names the token.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-continues-its-conversation/run.mts
 * Controls: GOAL_CONTROL=no-resume     (must FAIL at c, s and r, and nothing else)
 *           GOAL_CONTROL=no-record     (must FAIL at p, and nothing else)
 *           GOAL_CONTROL=main-checkout (must FAIL at w, and nothing else)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { KITCHEN_SINK, REPO_ROOT, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";
import { locateSessionWorktree, sessionBranch } from "../../../apps/kitchen-sink/lib/harness-worktree.ts";

const PORT = 3047;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FLOW_KIND = "claude-code-session";
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** How long one real Claude Code turn may take. */
const TURN_MS = 240_000;

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  "no-resume": ["c", "s", "r"],
  "no-record": ["p"],
  "main-checkout": ["w"],
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

/** How many times `token` shows in the conversation, as drawn. */
async function tokenCount(page: Page, token: string): Promise<number> {
  const text = (await page.getByTestId("conversation").textContent()) ?? "";
  return text.split(token).length - 1;
}

/** Send a turn and wait for it to end. Returns whether a Claude Code item showed while it ran. */
async function turn(page: Page, prompt: string): Promise<{ sawStepWhileRunning: boolean }> {
  const conversationText = async () => (await page.getByTestId("conversation").textContent()) ?? "";
  // What the page draws for the prompt alone: what was there, and the prompt.
  const withPrompt = (await conversationText()).length + prompt.length;
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
  await stopButton(page).waitFor({ state: "visible", timeout: 30_000 });
  let sawStepWhileRunning = false;
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline) {
    const running = await stopButton(page).isVisible();
    if (!running) break;
    // Text beyond the prompt while the turn still runs: one of Claude Code's items.
    if ((await conversationText()).length > withPrompt) sawStepWhileRunning = true;
    await page.waitForTimeout(500);
  }
  await page.getByTestId("turn-notice").waitFor({ state: "visible", timeout: 30_000 });
  return { sawStepWhileRunning };
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const token = `ks-goal-${randomBytes(6).toString("hex")}`;
  const file = `kitchen-sink-goal-${token}.txt`;
  const statusBefore = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain"], { encoding: "utf8" });

  const server = await startDev();
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();

    // ---- host: the mode is available here
    await page.goto(`${ORIGIN}/`);
    const card = page.locator('[data-mode-id="claude-code"]');
    await card.waitFor({ timeout: 60_000 });
    if ((await card.getAttribute("data-available")) !== "true") {
      fail("host", `Claude Code mode is unavailable here: ${await card.getByTestId("mode-reason").textContent()}`);
      return { failures, evidence: "" };
    }

    await page.goto(`${ORIGIN}/claude-code`);
    await page.getByTestId("new-session").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
    const sessionId = (await page.getByTestId("stream").getAttribute("data-session-id"))!;
    evidence.push(`session ${sessionId}, token ${token}`);

    // ---- turn 1: the token, a file, a plan
    const first = await turn(
      page,
      `Remember this token for later: ${token}. Use your task list to plan two small steps, then create a file named ${file} in the current directory containing the token, and reply "noted".`,
    );
    if (!first.sawStepWhileRunning) fail("l", "nothing of Claude Code's showed before turn 1 completed");
    const id1 = await boundId(page);
    evidence.push(`turn 1 bound ${id1}`);

    // ---- w: the worktree holds the file, on the session's branch; the main checkout is untouched
    const place = { flowKind: FLOW_KIND, sessionId };
    const worktree = locateSessionWorktree(REPO_ROOT, place);
    const branch = existsSync(worktree)
      ? execFileSync("git", ["-C", worktree, "branch", "--show-current"], { encoding: "utf8" }).trim()
      : "(no worktree)";
    if (!existsSync(join(worktree, file))) fail("w", `${file} is not in the session's worktree ${worktree}`);
    if (branch !== sessionBranch(place)) fail("w", `the worktree is on ${branch} (want ${sessionBranch(place)})`);
    const statusAfter = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain"], { encoding: "utf8" });
    if (statusAfter !== statusBefore) fail("w", `the main checkout's git status changed:\n${statusAfter}`);
    evidence.push(`worktree ${worktree} on ${branch}`);

    // ---- p: turn 1 asked for a plan, so the panel shows the rows Claude Code recorded
    const panel = page.getByTestId("plan-panel");
    await panel.getByTestId("plan-row").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const planState = await panel.locator("[data-plan-state]").getAttribute("data-plan-state", { timeout: 15_000 }).catch(() => null);
    const planRows = await panel.getByTestId("plan-row").count();
    if ((planState !== "rows" && planState !== "incomplete") || planRows === 0) {
      fail("p", `turn 1 asked for a plan, and the panel reads ${JSON.stringify(await panel.textContent())} (want its rows)`);
    }
    evidence.push(`panel ${planState} (${planRows} rows)`);

    // ---- c: turn 2 names the token without being told it, under the same id
    const seen = await tokenCount(page, token);
    await turn(page, "What token did I ask you to remember? Answer with the token only.");
    const id2 = await boundId(page);
    if ((await tokenCount(page, token)) <= seen) fail("c", "turn 2's reply did not name the token");
    if (id2 !== id1) fail("c", `the conversation moved from ${id1} to ${id2}`);

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
    if ((await boundId(page)) !== id1) fail("s", `after the stop the conversation is ${await boundId(page)} (want ${id1})`);

    // ---- r: a reload lands back in the session, on its conversation
    await page.reload();
    const back = await page
      .waitForFunction((id) => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id") === id, sessionId, {
        timeout: 30_000,
      })
      .then(() => true, () => false);
    if (!back) {
      fail("r", `after a reload the page is not back in session ${sessionId}: ${JSON.stringify(await page.getByTestId("stream").textContent())}`);
    } else {
      await bound(page).waitFor({ timeout: 30_000 });
      if ((await boundId(page)) !== id1) fail("r", `after a reload the session shows ${await boundId(page)} (want ${id1})`);
      const seenR = await tokenCount(page, token);
      await turn(page, "One more time: the token, only.");
      if ((await tokenCount(page, token)) <= seenR) fail("r", "after a reload, the next turn did not name the token");
      if ((await boundId(page)) !== id1) fail("r", `after a reload the conversation moved to ${await boundId(page)}`);
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
