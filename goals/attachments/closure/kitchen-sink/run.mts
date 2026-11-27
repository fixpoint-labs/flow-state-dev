/**
 * The closure's legs in Kitchen Sink (FIX-2565): Flow State chat and the
 * Claude Code, Codex and Cursor pages, each walked by `../legs.mts` →
 * `walkSurface` in one real browser against `next dev`.
 *
 *   Host:  `next dev` on its own default store (SQLite, the app's
 *          `.fsdev/data`; the app honours a scratch store file only in test
 *          mode, which the closure refuses), its harness worktrees cut from a
 *          scratch checkout, `KITCHEN_SINK_REAL_HARNESS=1`. The restart stops
 *          the server's process group and starts it again on the same store.
 *   Model: Flow State's own (through the AI Gateway), each harness's own
 *          default on this machine's sign-in. A mode the picker says is
 *          unavailable, or whose model or harness can't run here, is named
 *          and not run: a FAIL.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/closure/kitchen-sink/run.mts
 *       GOAL_CONTROL=strip-file-parts (legs a and b must FAIL on names-both and code-word)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { KITCHEN_SINK, goalTmpDir, intentFreeEnv, runGoal, sleep } from "../../../lib/index.mts";
import { launchChromium } from "../../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../../lib/server.mts";
import { controlName, draw, harnessReadiness, missingModel, plantControl, refuseStubs, walkSurface, type Surface } from "../legs.mts";

refuseStubs();
const CONTROL = controlName();
const PORT = Number(process.env.GOAL_KS_PORT ?? 3055);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRATCH = goalTmpDir("attachments-closure-kitchen-sink");

const MODES = [
  { id: "flow-state", tag: "ks-fs", label: "Flow State", harness: undefined },
  { id: "claude-code", tag: "ks-cc", label: "Claude Code", harness: "claude-code" },
  { id: "codex", tag: "ks-cx", label: "Codex", harness: "codex" },
  { id: "cursor", tag: "ks-cu", label: "Cursor", harness: "cursor" },
] as const;

const say = (s: string) => console.error(`[closure kitchen-sink ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** The checkout a harness session's worktree is cut from: one commit, never this repository. */
function scratchCheckout(): string {
  const repo = join(SCRATCH, "repo");
  if (existsSync(join(repo, ".git"))) return repo;
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "A throwaway repository for the attachments closure.\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  return repo;
}

let server: ChildProcess | undefined;

async function start(): Promise<void> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env = intentFreeEnv(process.env, {
    NODE_ENV: "development",
    KITCHEN_SINK_REAL_HARNESS: "1",
    KITCHEN_SINK_HARNESS_WORKSPACE: scratchCheckout(),
    XDG_STATE_HOME: join(SCRATCH, "state"),
    GOAL_CONTROL: "",
  });
  server = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], { cwd: KITCHEN_SINK, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout?.on("data", (c: Buffer) => (log += c.toString()));
  server.stderr?.on("data", (c: Buffer) => (log += c.toString()));
  for (let i = 0; i < 480; i += 1) {
    if ((await fetch(`${ORIGIN}/api/flows`).then((r) => r.status, () => 0)) === 200) return;
    if (server.exitCode !== null) throw new Error(`setup: next dev exited (${server.exitCode}):\n${log.slice(-2000)}`);
    await sleep(500);
  }
  throw new Error(`setup: next dev never served ${ORIGIN}/api/flows:\n${log.slice(-2000)}`);
}

/** Stop the server's whole process group, wait until the port is free, and start it again on the same store. */
async function restart(): Promise<void> {
  stopProcessGroup(server);
  for (let i = 0; i < 100 && (await fetch(`${ORIGIN}/api/flows`).then(() => true, () => false)); i += 1) await sleep(200);
  await start();
}

const box = (page: Page) => page.locator('[data-testid="message-input"]:visible').first();

function surfaceOf(mode: (typeof MODES)[number]): Surface {
  return {
    tag: mode.tag,
    label: mode.label,
    box,
    replyScope: (page) => page.locator('[data-testid="conversation"]:visible').first(),
    origin: () => ORIGIN,
    restart,
    async open(page) {
      await page.goto(`${ORIGIN}/${mode.id}`, { timeout: 300_000 });
      if (mode.id !== "flow-state") await page.getByTestId("new-session").click();
      for (const end = Date.now() + 120_000; !(await box(page).isEnabled().catch(() => false)); await page.waitForTimeout(250)) {
        if (Date.now() > end) throw new Error(`${mode.label}: the message box never became ready`);
      }
    },
  };
}

const putBack = plantControl(CONTROL);
await runGoal(async (failures, tell) => {
  const d = draw();
  say(`words ${d.words.join(", ")}; code word ${d.codeWord}${CONTROL ? `; control ${CONTROL}` : ""}`);
  const evidence: string[] = [];
  const ready = await harnessReadiness();
  let browser: Browser | undefined;
  try {
    await start();
    browser = await launchChromium();
    const picker = await browser.newPage();
    await picker.goto(`${ORIGIN}/`, { timeout: 300_000 });
    for (const mode of MODES) {
      const card = picker.locator(`[data-mode-id="${mode.id}"]`);
      await card.waitFor({ timeout: 60_000 });
      const why =
        (await card.getAttribute("data-available")) !== "true"
          ? `the picker says ${mode.label} is unavailable: ${(await card.getByTestId("mode-reason").textContent().catch(() => null)) ?? "(no reason drawn)"}`
          : mode.harness === undefined
            ? missingModel()
            : ready[mode.harness];
      if (why !== undefined) {
        failures.push(`[${mode.tag}:host] not run: ${why}`);
        continue;
      }
      say(mode.label);
      const page = await browser.newPage();
      try {
        await walkSurface(page, surfaceOf(mode), d, failures, tell, evidence);
      } catch (error) {
        failures.push(`[${mode.tag}] threw: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    stopProcessGroup(server);
    putBack();
  }
  return { failures, evidence: evidence.join(" · ") };
});
