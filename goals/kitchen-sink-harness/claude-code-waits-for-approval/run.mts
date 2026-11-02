/**
 * Goal check: in Kitchen Sink's Claude Code mode a tool call that isn't
 * read-only waits for the user, and their answer reaches the same
 * conversation, also after a server restart. See goal.md for the contract.
 *
 * Scripted Claude Code in test mode, `next dev`, one real browser. Out of CI.
 *
 * Legs:
 *
 *   a   the turn waits on an approval card naming the command and the worktree, with Allow for this run; the notice
 *       says so; the request is suspended.
 *   c   after a server restart and a reload, the card is still there; Approve on it resumes the conversation the turn
 *       started, and the page follows it to the end.
 *   b   the call didn't run while the turn waited or across the restart, and ran exactly once, after the click.
 *   e   a message sent while the next call waits is refused, the page says why, and the card stays.
 *   d   that call is rejected on the card; its turn ends, and it never ran.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-waits-for-approval/run.mts
 * Control:  GOAL_CONTROL=no-approval (must FAIL at a, and nothing else)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { createClient } from "@flow-state-dev/client";
import { KITCHEN_SINK, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";
import { locateSessionWorktree } from "../../../apps/kitchen-sink/lib/harness-worktree.ts";
import { KITCHEN_SINK_USER_ID } from "../../../apps/kitchen-sink/lib/kitchen-sink-principal.ts";

const PORT = 3053;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FLOW_KIND = "claude-code-session";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const WAIT_MS = 60_000;
/**
 * How long the resumed turn may take after a restart: the stopped server's
 * hold on the worktree is taken over only once it goes stale, about a minute.
 */
const RESUME_MS = 150_000;

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = { "no-approval": ["a"] };
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** `next dev` in test mode, on the scripted Claude Code, the durable store, and `workspace` as the repository. */
async function startDev(workspace: string): Promise<{ stop: () => Promise<void>; log: () => string }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    KITCHEN_SINK_TEST_MODE: "1",
    NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
    STORE_TYPE: "filesystem",
    KITCHEN_SINK_HARNESS_WORKSPACE: workspace,
    ...(CONTROL === "" ? {} : { GOAL_CONTROL: CONTROL }),
  };
  delete env.KITCHEN_SINK_REAL_HARNESS;
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    cwd: KITCHEN_SINK,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  const stop = async () => {
    stopProcessGroup(child);
    for (let i = 0; i < 60 && (await fetch(`${ORIGIN}/api/flows`).then(() => true, () => false)); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  for (let i = 0; i < 240; i += 1) {
    const status = await fetch(`${ORIGIN}/api/flows`).then((r) => r.status, () => undefined);
    if (status === 200) return { stop, log: () => log };
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`next dev never served ${ORIGIN}/api/flows:\n${log}`);
}

const notice = (page: Page) => page.getByTestId("turn-notice");
const bound = async (page: Page) => ((await page.getByTestId("bound-conversation").textContent()) ?? "").trim();
/** The open approval card naming `command`. */
const card = (page: Page, command: string) => page.locator("[data-suspension]:not([data-resolved])").filter({ hasText: command });

/** Send a prompt from the composer. */
async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
}

/** The session's newest request status, through the client, as the session's request list reports it. */
async function turnStatus(sessionId: string): Promise<string | null> {
  const client = createClient({ userId: KITCHEN_SINK_USER_ID, baseUrl: ORIGIN });
  const requests = await client.sessions.requests(sessionId, { limit: 5 });
  return requests[0]?.status ?? null;
}

/** When each run of the call on `file` happened: the lines the scripted Claude Code appended, one per run. */
function runsOf(worktree: string, file: string): number[] {
  const path = join(worktree, file);
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(Number) : [];
}

/** How many times the call on `file` ran. */
const timesRan = (worktree: string, file: string) => runsOf(worktree, file).length;

/** A throwaway repository for the sessions' worktrees. */
function scratchRepo(): { repo: string; dispose: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ks-goal-approval-")));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "goal\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=goal@example.com", "-c", "user.name=goal", "commit", "-qm", "init"]);
  return { repo, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const token = randomBytes(5).toString("hex");
  const file = `approved-${token}.txt`;
  const denied = `denied-${token}.txt`;
  const { repo, dispose } = scratchRepo();

  let server = await startDev(repo);
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.goto(`${ORIGIN}/claude-code`);
    await page.getByTestId("new-session").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
    const sessionId = (await page.getByTestId("stream").getAttribute("data-session-id"))!;
    const worktree = locateSessionWorktree(repo, { flowKind: FLOW_KIND, sessionId });
    evidence.push(`session ${sessionId}, worktree ${worktree}`);

    // ---- a: the call waits on the card
    await send(page, `[touch:${file}] make the file`);
    const shown = await card(page, `touch ${file}`)
      .waitFor({ timeout: WAIT_MS })
      .then(() => true, () => false);
    if (!shown) {
      fail("a", `no approval card for \`touch ${file}\` showed; the call ran ${timesRan(worktree, file)} times`);
      return { failures, evidence: evidence.join("; ") };
    }
    const cardText = (await card(page, `touch ${file}`).textContent()) ?? "";
    if (!cardText.includes(worktree)) fail("a", `the card doesn't name the worktree ${worktree}: ${JSON.stringify(cardText)}`);
    if ((await card(page, `touch ${file}`).getByRole("button", { name: "Allow for this run" }).count()) !== 1) {
      fail("a", "the card offers no Allow for this run");
    }
    const kind = await notice(page).getAttribute("data-kind", { timeout: WAIT_MS }).catch(() => null);
    if (kind !== "waiting") fail("a", `the notice reads ${JSON.stringify(kind)} (want waiting)`);
    const waitingStatus = await turnStatus(sessionId);
    if (waitingStatus !== "suspended") fail("a", `the turn's request is ${JSON.stringify(waitingStatus)} (want suspended)`);
    if (timesRan(worktree, file) !== 0) fail("b", `${file} ran before any answer`);
    const conversation = await bound(page);
    evidence.push(`waiting on ${conversation}, notice ${kind}, request ${waitingStatus}`);

    // ---- c: restart the server while the card waits, then Allow
    await server.stop();
    server = await startDev(repo);
    // The new server compiles the page on first load, which can abort the first navigation.
    const url = page.url();
    for (let attempt = 0; ; attempt += 1) {
      const loaded = await page.goto(url, { timeout: WAIT_MS }).then(() => true, () => false);
      if (loaded || attempt === 2) break;
    }
    if (timesRan(worktree, file) !== 0) fail("b", `${file} ran across the restart, before any answer`);
    const still = await card(page, `touch ${file}`)
      .waitFor({ timeout: WAIT_MS })
      .then(() => true, () => false);
    if (!still) {
      fail("c", "after the restart and a reload, the approval card is gone");
    } else {
      const clickedAt = Date.now();
      await card(page, `touch ${file}`).getByRole("button", { name: "Approve" }).click();
      const done = await page
        .waitForFunction(() => document.querySelector('[data-testid="turn-notice"]')?.getAttribute("data-kind") === "continued", undefined, {
          timeout: RESUME_MS,
        })
        .then(() => true, () => false);
      const after = await bound(page);
      if (!done) fail("c", `after Allow the notice reads ${JSON.stringify(await notice(page).getAttribute("data-kind").catch(() => null))} (want continued)`);
      if (after !== conversation) fail("c", `the conversation moved from ${conversation} to ${after}`);
      evidence.push(`resumed ${after}`);

      // ---- b: it ran once, after the answer
      const runs = runsOf(worktree, file);
      if (runs.length !== 1) {
        fail("b", `after Allow ${file} ran ${runs.length} times (want 1)`);
      } else {
        if (!(runs[0]! >= clickedAt)) fail("b", `${file} ran at ${runs[0]}, before the click at ${clickedAt}`);
        evidence.push(`ran once, ${runs[0]! - clickedAt} ms after the click`);
      }
    }

    // ---- e and d: a message while the next call waits is refused, then Reject
    await send(page, `[touch:${denied}] make another`);
    const asked = await card(page, `touch ${denied}`)
      .waitFor({ timeout: WAIT_MS })
      .then(() => true, () => false);
    if (!asked) {
      fail("d", `no approval card for \`touch ${denied}\` showed`);
      fail("e", "nothing waited, so no message could be refused");
    } else {
      await send(page, "are you there?");
      const refused = await page
        .getByTestId("conversation")
        .getByText("Another turn of this session is waiting for an answer about a tool call")
        .first()
        .waitFor({ timeout: WAIT_MS })
        .then(() => true, () => false);
      if (!refused) fail("e", "the page never said why the message sent while the turn waits was refused");
      const stillWaiting = await card(page, `touch ${denied}`).count();
      if (stillWaiting !== 1) fail("e", "the refused message took the waiting card away");
      await card(page, `touch ${denied}`).getByRole("button", { name: "Reject" }).click();
      const ended = await page
        .waitForFunction(
          () => {
            const kind = document.querySelector('[data-testid="turn-notice"]')?.getAttribute("data-kind");
            return kind !== undefined && kind !== null && kind !== "waiting";
          },
          undefined,
          { timeout: WAIT_MS },
        )
        .then(() => true, () => false);
      if (!ended) fail("d", "the rejected turn never ended");
      if (timesRan(worktree, denied) !== 0) fail("d", `${denied} ran ${timesRan(worktree, denied)} times after Reject`);
    }
  } finally {
    await browser.close();
    await server.stop();
    dispose();
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
