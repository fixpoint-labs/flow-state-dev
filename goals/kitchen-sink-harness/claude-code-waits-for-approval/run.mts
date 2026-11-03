/**
 * Goal check: in Kitchen Sink's Claude Code mode a turn stops at a tool call
 * that isn't pre-allowed, the conversation shows it waiting on the user, and
 * their answer reaches the same conversation, also after a server restart. No
 * call runs that nobody allowed. See goal.md for the contract.
 *
 * `next dev` in test mode on the scripted Claude Code, a durable store
 * (`STORE_TYPE=filesystem`), one real browser, and a scratch git repository as
 * the harness workspace, so the checkout is never touched.
 *
 * Legs:
 *
 *   a:waits              the turn's request is suspended; the page shows the approval card naming the tool, the
 *                        command and the session's worktree, with Allow for this run, and the notice reads waiting.
 *   b:ran-after          the command had not run while the turn waited; after Allow it ran exactly once.
 *   c:same-conversation  after a restart and a reload the card is still there; Approve on it resumes the conversation
 *                        that asked, and the page follows the turn to its end without another reload.
 *   d:never-ran          in a second session, Reject on the page's card: the command never ran, and the turn ended.
 *   e:one-at-a-time      a message sent while a turn waits is refused, and the page says why.
 *   s:stop               while a third call waits, the page offers Stop; it ends the turn, the call never ran, and the
 *                        next turn continues the conversation.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness/claude-code-waits-for-approval/run.mts
 * Control:  GOAL_CONTROL=no-approval (the mode leaves `approveTools` off): must FAIL every leg, since nothing waits.
 *           By hand: take `SuspensionResolverProvider` off the harness page and c fails (the page stays on waiting);
 *           show Stop only while streaming and s fails.
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
const LEGS = ["a", "b", "c", "d", "e", "s"];
/** How long a resumed turn may take to start after a restart: the stopped server's worktree hold goes stale first. */
const RESUME_MS = 150_000;

/** The legs each control must redden. */
const EXPECTED: Record<string, string[]> = { "no-approval": LEGS };
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

/** A scratch repository for the sessions' worktrees, and a state home for them. */
function scratch(): { repo: string; stateHome: string; root: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ks-goal-approval-")));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "scratch\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=g@g", "-c", "user.name=g", "commit", "-qm", "init"]);
  return { repo, stateHome: join(root, "state"), root };
}

/** `next dev` in test mode on the scripted Claude Code and the filesystem store. */
async function startDev(repo: string, stateHome: string): Promise<{ stop: () => Promise<void>; log: () => string }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    KITCHEN_SINK_TEST_MODE: "1",
    NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
    STORE_TYPE: "filesystem",
    KITCHEN_SINK_HARNESS_WORKSPACE: repo,
    XDG_STATE_HOME: stateHome,
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
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  for (let i = 0; i < 240; i += 1) {
    const status = await fetch(`${ORIGIN}/api/flows`).then((r) => r.status, () => undefined);
    if (status === 200) {
      return {
        stop: async () => {
          stopProcessGroup(child);
          await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
        },
        log: () => log,
      };
    }
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopProcessGroup(child);
  throw new Error(`next dev never served ${ORIGIN}/api/flows:\n${log}`);
}

const client = createClient({ userId: KITCHEN_SINK_USER_ID, baseUrl: ORIGIN });

/** The session's requests, newest first. An index only: what is graded is read on the page or on disk. */
async function requests(sessionId: string): Promise<Array<{ id: string; status: string }>> {
  return (await client.sessions.requests(sessionId, { limit: 20 })) as Array<{ id: string; status: string }>;
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    value = await read();
  }
  return value;
}

/** How many times the command ran: the lines the scripted Claude Code's call appended to its file. */
function timesRan(worktree: string, file: string): number {
  const path = join(worktree, file);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).length : 0;
}

/** Open a new Claude Code session and return its id. */
async function newSession(page: Page): Promise<string> {
  await page.goto(`${ORIGIN}/claude-code`);
  await page.getByTestId("new-session").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
  return (await page.getByTestId("stream").getAttribute("data-session-id"))!;
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
}

/** The open approval card, once it shows; `null` if none shows in time. */
async function openCard(page: Page) {
  const card = page.locator('[data-testid="conversation"] [data-suspension]:not([data-resolved])').first();
  return (await card.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false)) ? card : null;
}

const noticeKind = (page: Page) => page.getByTestId("turn-notice").getAttribute("data-kind", { timeout: 15_000 }).catch(() => null);

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const { repo, stateHome, root } = scratch();
  // So this process finds the sessions' worktrees where the server makes them.
  process.env.XDG_STATE_HOME = stateHome;
  const token = randomBytes(4).toString("hex");
  const allowFile = `allow-${token}.txt`;
  const denyFile = `deny-${token}.txt`;

  let server = await startDev(repo, stateHome);
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    // `next dev` compiles each page on its first load, which can take minutes on a busy host.
    page.setDefaultNavigationTimeout(300_000);

    // ---- a: the turn stops at the call, and the page shows it waiting
    const sessionA = await newSession(page);
    const worktreeA = locateSessionWorktree(repo, { flowKind: FLOW_KIND, sessionId: sessionA });
    await send(page, `[ask:${allowFile}] touch a file`);
    const card = await openCard(page);
    const turnA = (await until(() => requests(sessionA), (list) => list.length > 0 && list[0]!.status !== "in_progress", 30_000))[0];
    evidence.push(`session ${sessionA}, turn ${turnA?.id} ${turnA?.status}`);
    let suspensionId: string | null = null;
    if (card === null) {
      fail("a", `no approval card showed; the turn is ${turnA?.status} and the conversation reads ${JSON.stringify(await page.getByTestId("conversation").textContent())}`);
    } else {
      const text = (await card.textContent()) ?? "";
      suspensionId = await card.getAttribute("data-suspension");
      for (const want of ["Bash", `touch ${allowFile}`, worktreeA]) {
        if (!text.includes(want)) fail("a", `the card does not name ${JSON.stringify(want)}: ${JSON.stringify(text)}`);
      }
      if ((await card.getByRole("button", { name: "Allow for this run" }).count()) !== 1) fail("a", "the card offers no Allow for this run");
      if (turnA?.status !== "suspended") fail("a", `the turn's request is ${turnA?.status} (want suspended)`);
      const kind = await noticeKind(page);
      if (kind !== "waiting") fail("a", `the notice reads ${JSON.stringify(kind)} (want waiting)`);
      evidence.push(`card ${JSON.stringify(text.slice(0, 160))}`);
    }
    // The page re-reads the session's state once the turn stops streaming.
    await page
      .waitForFunction(() => /^scripted-/.test(document.querySelector('[data-testid="bound-conversation"]')?.textContent?.trim() ?? ""), undefined, {
        timeout: 15_000,
      })
      .catch(() => undefined);
    const boundA = ((await page.getByTestId("bound-conversation").textContent()) ?? "").trim();
    evidence.push(`bound ${boundA}`);

    // ---- b (first half): nothing ran while it waited
    if (timesRan(worktreeA, allowFile) !== 0) fail("b", `${allowFile} ran before anyone answered`);

    // ---- restart the server, then answer on the page's own card
    await server.stop();
    server = await startDev(repo, stateHome);
    if (timesRan(worktreeA, allowFile) !== 0) fail("b", `${allowFile} ran across the restart, before anyone answered`);
    // The new server compiles the page on its first load, which can abort the first navigation.
    for (let attempt = 0; ; attempt += 1) {
      const loaded = await page.reload().then(() => true, () => false);
      if (loaded || attempt === 2) break;
    }
    const cardAfter = suspensionId === null ? null : await openCard(page);
    if (suspensionId === null || turnA === undefined) {
      fail("b", "nothing waited, so nothing could run after an answer");
      fail("c", "nothing waited, so no answer could resume the conversation");
    } else if (cardAfter === null) {
      fail("b", "the card was gone after the restart, so nothing could run after an answer");
      fail("c", "after the restart and a reload, the approval card is gone");
    } else {
      await cardAfter.getByRole("button", { name: "Approve" }).click();
      // Read off the page, with no reload: a page that stops following the turn stays on waiting.
      const followed = await page
        .waitForFunction(() => document.querySelector('[data-testid="turn-notice"]')?.getAttribute("data-kind") === "continued", undefined, {
          timeout: RESUME_MS,
        })
        .then(() => true, () => false);
      if (!followed) fail("c", `after Approve the notice reads ${JSON.stringify(await noticeKind(page))} (want continued)`);
      const resumedReply = ((await page.getByTestId("conversation").textContent()) ?? "").includes(`of conversation ${boundA}`);
      const ended = (await requests(sessionA)).find((r) => r.id === turnA.id);
      if (ended?.status !== "completed") fail("c", `after Approve the turn is ${ended?.status} (want completed)`);

      // ---- b: it ran exactly once, after the answer
      const ran = timesRan(worktreeA, allowFile);
      if (ran !== 1) fail("b", `after Approve ${allowFile} ran ${ran} times (want 1)`);

      // ---- c: the same conversation, as the page shows it
      const boundAfter = ((await page.getByTestId("bound-conversation").textContent()) ?? "").trim();
      if (!/^scripted-/.test(boundA)) fail("c", `the waiting turn showed no confirmed conversation (${JSON.stringify(boundA)})`);
      if (boundAfter !== boundA) fail("c", `after the restart and Approve the session is on ${boundAfter} (want ${boundA})`);
      if (!resumedReply) fail("c", `the page shows no resumed reply continuing conversation ${boundA}`);
      evidence.push(`after restart + Approve: ${ended?.status}, ran ${ran}, bound ${boundAfter}`);
    }

    // ---- d and e: a second session, a message while it waits, then Reject on the page's card
    const sessionB = await newSession(page);
    const worktreeB = locateSessionWorktree(repo, { flowKind: FLOW_KIND, sessionId: sessionB });
    await send(page, `[ask:${denyFile}] touch a file`);
    const cardB = await openCard(page);
    if (cardB === null) {
      fail("d", "no approval card showed in the second session");
      fail("e", "nothing waited, so no message could be refused");
    } else {
      const waitingTurn = (await requests(sessionB))[0]!;
      await send(page, "are you there?");
      const refused = await page
        .getByText("Another turn of this session is waiting for an answer about a tool call")
        .first()
        .waitFor({ timeout: 30_000 })
        .then(() => true, () => false);
      const second = (await until(() => requests(sessionB), (list) => list.length > 1 && list[0]!.status !== "in_progress", 30_000))[0];
      if (!refused) fail("e", "the page never said why the message sent while the turn waits was refused");
      if (second?.id === waitingTurn.id || second?.status !== "failed") fail("e", `the message sent while the turn waits is ${second?.status} (want refused)`);
      evidence.push(`message while waiting: ${second?.status}`);

      // The refused message took the latest-turn slot; the card is still the waiting turn's.
      await cardB.getByRole("button", { name: "Reject" }).click();
      const ended = (await until(() => requests(sessionB), (list) => ["completed", "failed"].includes(list.find((r) => r.id === waitingTurn.id)?.status ?? ""), 30_000)).find(
        (r) => r.id === waitingTurn.id,
      );
      if (ended?.status !== "completed") fail("d", `after Reject the turn is ${ended?.status} (want completed)`);
      const ranB = timesRan(worktreeB, denyFile);
      if (ranB !== 0) fail("d", `after Reject ${denyFile} ran ${ranB} times`);
      evidence.push(`after Reject: ${ended?.status}, ran ${ranB}`);
    }

    // ---- s: Stop ends a turn that waits, and the session takes the next one
    const stopFile = `stop-${token}.txt`;
    await send(page, `[ask:${stopFile}] touch a file`);
    const cardS = await openCard(page);
    if (cardS === null) {
      fail("s", `no approval card for \`touch ${stopFile}\` showed`);
    } else {
      const stop = page.getByTestId("turn-stop");
      if (!(await stop.isVisible())) {
        fail("s", "while the turn waits, the page offers no Stop");
      } else {
        await stop.click();
        const stopped = await page
          .waitForFunction(() => document.querySelector('[data-testid="turn-notice"]')?.getAttribute("data-kind") === "stopped", undefined, {
            timeout: 30_000,
          })
          .then(() => true, () => false);
        if (!stopped) fail("s", `after Stop the notice reads ${JSON.stringify(await noticeKind(page))} (want stopped)`);
        await send(page, "carry on");
        const next = await page
          .waitForFunction(() => document.querySelector('[data-testid="turn-notice"]')?.getAttribute("data-kind") === "continued", undefined, {
            timeout: 30_000,
          })
          .then(() => true, () => false);
        if (!next) fail("s", `after Stop the next turn's notice reads ${JSON.stringify(await noticeKind(page))} (want continued)`);
      }
      const ranS = timesRan(worktreeB, stopFile);
      if (ranS !== 0) fail("s", `after Stop ${stopFile} ran ${ranS} times`);
      evidence.push(`after Stop: ran ${ranS}`);
    }
  } finally {
    await browser.close();
    await server.stop();
    rmSync(root, { recursive: true, force: true });
  }

  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
