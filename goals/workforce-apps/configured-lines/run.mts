/**
 * Goal check: Teammates and Shift Manager draw a conversation's lines from
 * the UI registry's items, configured by each app's own line context, and
 * keep what is their own. See goal.md.
 *
 * One scripted Lab (`lab.config.mts`, the Teammates host with only the model
 * scripted), served twice on fresh stores: by Teammates (`fsdev dev
 * --config`) and by Shift Manager's command (`--config`). Each leg plays the
 * same conversation with Chief of Staff through the public client, then opens
 * it in Chromium and reads the lines on the page:
 *
 *   t  Teammates: failed with Retry, stopped, sent, received, the live task
 *      card and its result, steps; the avatars on the lines; a sent line and a
 *      result line open their popups
 *   s  Shift Manager: failed with Retry, stopped, sent, received, task,
 *      result, steps; the Messages link on a line between workers
 *
 * Each app's pages are built from a scratch copy of its source, so a control's
 * patch lands only in that copy.
 *
 * Run:     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/workforce-apps/configured-lines/run.mts
 * Control: GOAL_CONTROL=no-line-context, same command: each app's line
 *          context provider is handed an empty value. It FAILs on Retry, the
 *          avatars and the click-through; any other red, or one of those
 *          green, is WRONG.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import type { Browser, Page } from "playwright";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, refuseIfAnswering, repoPath, runGoal, sleep, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerCopy, openShiftManager, startShiftManager, type Patch } from "../../lib/shift-manager.mts";
import { ANSWER, ASK, CHIEF, CHIEF_NAME } from "./ids.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = goalTmpDir("configured-lines");
const CONFIG = repoPath("goals", "workforce-apps", "configured-lines", "lab.config.mts");
const TEAMMATES = repoPath("labs", "teammates");
const USER = "you";
const NO_MODEL = { AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };
const NODE_ENV_AT_LOAD = process.env.NODE_ENV;
const say = (s: string) => console.error(`[configured-lines] ${s}`);

// ---- the checks, and what the control must fail ------------------------------

const CHECKS = {
  "t:failed": "Teammates: a failed turn is its line, with Retry",
  "t:stopped": "Teammates: a stopped turn is its line",
  "t:sent": "Teammates: a message Chief of Staff sent is its line",
  "t:received": "Teammates: researcher's answer is its line",
  "t:task": "Teammates: the filed task is its live card, read from the board once it ended",
  "t:result": "Teammates: the task's ending is its line",
  "t:steps": "Teammates: a tool call is a steps line",
  "t:avatar": "Teammates: the lines between workers carry each worker's avatar",
  "t:opens-sent": "Teammates: a sent line opens its exchange in a popup",
  "t:opens-result": "Teammates: a result line opens its task in a popup",
  "s:failed": "Shift Manager: a failed turn is its line, with Retry",
  "s:stopped": "Shift Manager: a stopped turn is its line",
  "s:sent": "Shift Manager: a message Chief of Staff sent is its line",
  "s:received": "Shift Manager: researcher's answer is its line",
  "s:task": "Shift Manager: the filed task is its line",
  "s:result": "Shift Manager: the task's ending is its line",
  "s:steps": "Shift Manager: a tool call is one tool group",
  "s:messages-link": "Shift Manager: a line between workers links to Messages",
} as const;
type CheckId = keyof typeof CHECKS;

type AppPatch = Patch & { app: "teammates" | "shift-manager" };
const CONTROLS: Record<string, { patches: AppPatch[]; fails: CheckId[] }> = {
  "no-line-context": {
    patches: [
      { app: "teammates", file: "src/components/Conversation.tsx", from: "<LineContext.Provider value={screenOfLines}>", to: "<LineContext.Provider value={{}}>", why: "the conversation's line context is empty" },
      { app: "shift-manager", file: "src/components/Conversation.tsx", from: "<LineContext.Provider value={lineActions}>", to: "<LineContext.Provider value={{}}>", why: "the conversation's line context is empty" },
    ],
    fails: ["t:failed", "t:avatar", "t:opens-sent", "t:opens-result", "s:failed"],
  },
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
const patchesFor = (app: AppPatch["app"]) => (CONTROLS[CONTROL]?.patches ?? []).filter((p) => p.app === app);

const record = new Map<CheckId, string>();
const check = (id: CheckId, ok: boolean, seen: string) => record.set(id, `${ok ? "PASS" : "FAIL"} ${CHECKS[id]}: ${seen}`);

// ---- the conversation, played through the public client ------------------------

/** Wait until `done` holds, polling every half second. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number, what: string): Promise<T> {
  let value = await read();
  for (const end = Date.now() + ms; !done(value); value = await read()) {
    if (Date.now() > end) throw new Error(`setup: ${what} within ${ms / 1000}s`);
    await sleep(500);
  }
  return value;
}

/**
 * Chief of Staff's conversation on the Lab at `origin`: a message and its
 * answer, a task for researcher to its end, a tool call, a turn stopped, and last a
 * turn that fails, so its Retry is the newest turn's.
 */
async function playConversation(origin: string): Promise<string> {
  const fsd = createClient({ userId: USER, baseUrl: origin });
  const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker: CHIEF });
  const flow = fsd.flow(session.flowId ?? session.flowKind);
  const items = async () =>
    ((await fsd.sessions.state(session.id, { includeItems: true, limit: 500 })) as { items?: Array<{ type: string; dataType?: string; role?: string; content?: { text?: string }[] }> }).items ?? [];
  const has = (dataType: string) => (list: Awaited<ReturnType<typeof items>>) => list.some((i) => i.type === "data" && i.dataType === dataType);
  const said = (text: string) => (list: Awaited<ReturnType<typeof items>>) => list.some((i) => i.type === "message" && i.role === "assistant" && i.content?.some((c) => c.text?.includes(text)));
  const tell = async (ask: string) => {
    const sent = await flow.send("respond", { message: `${ask}-${randomInt(1_000, 9_999)}` }, { sessionId: session.id });
    return sent;
  };
  const settle = async (ask: string) => {
    const end = await (await tell(ask)).wait({ timeoutMs: 60_000 });
    if (end.status !== "completed") throw new Error(`setup: the ${ask} turn ended ${end.status}`);
  };

  await settle(ASK.message);
  await until(items, (l) => has("workforce:received")(l) && said("Thanks, noted.")(l), 60_000, `researcher's answer ("${ANSWER}") never landed and was answered`);
  await settle(ASK.file);
  await until(items, has("workforce:result"), 120_000, "the task never ended").catch(async (error: Error) => {
    const seen = (await items()).map((i) => (i.type === "data" ? `data:${i.dataType}` : i.type === "message" ? `${i.role}:${i.content?.map((c) => c.text).join("").slice(0, 80)}` : i.type));
    throw new Error(`${error.message}; the conversation holds ${seen.join(" | ")}`);
  });
  await sleep(3_000);
  await settle(ASK.look);
  const held = await tell(ASK.hold);
  await sleep(2_000);
  await held.abort();
  await held.wait({ timeoutMs: 60_000 }).catch(() => undefined);
  const failed = await (await tell(ASK.fail)).wait({ timeoutMs: 60_000 });
  if (failed.status !== "failed") throw new Error(`setup: the ${ASK.fail} turn ended ${failed.status}, not failed`);
  await sleep(2_000);
  return session.id;
}

// ---- builds ----------------------------------------------------------------------

/** Teammates' pages built from a scratch copy of its source with `patches` applied. */
function buildTeammatesCopy(patches: readonly Patch[]): { pages: string; diff: string[] } {
  const root = join(SCRATCH, "teammates", "source");
  cpSync(TEAMMATES, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist-client|\.fsdev)$/.test(src) });
  symlinkSync(join(TEAMMATES, "node_modules"), join(root, "node_modules"));
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  // Its Vite config imports the workspace's build-inputs script by a relative path.
  const viteConfig = join(root, "vite.config.ts");
  writeFileSync(viteConfig, readFileSync(viteConfig, "utf8").replace('"../../scripts/build-inputs.mjs"', JSON.stringify(join(REPO_ROOT, "scripts", "build-inputs.mjs"))));
  const diff: string[] = [];
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup [teammates]: ${patch.why}, but ${patch.file} has nothing to patch`);
    writeFileSync(path, after);
    diff.push(`teammates ${patch.file}: ${patch.why}`);
  }
  const pages = join(SCRATCH, "teammates", "pages");
  const built = spawnSync(join(TEAMMATES, "node_modules", ".bin", "vite"), ["build", "--config", join(root, "vite.config.ts"), "--outDir", pages, "--emptyOutDir", "--logLevel", "error"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (built.status !== 0) throw new Error(`setup [teammates]: vite build failed: ${(built.stderr || built.stdout).slice(-1500)}`);
  return { pages, diff };
}

/** Vite leaves `NODE_ENV=production` behind, which every Lab this run boots would inherit. */
function restoreNodeEnv() {
  if (NODE_ENV_AT_LOAD === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_AT_LOAD;
}

/** A fresh store and an empty git checkout for one leg's Lab. */
function labEnv(leg: string): Record<string, string> {
  const dir = join(SCRATCH, leg);
  const workdir = join(dir, "workdir");
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(workdir, "README.md"), "Relay keps your team in sync.\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", workdir, "-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args]);
  execFileSync("git", ["init", "-q", "-b", "main", workdir]);
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return { ...NO_MODEL, GOAL_STORE: join(dir, "lab.sqlite"), GOAL_USER: USER, GOAL_WORKDIR: workdir };
}

// ---- leg t: Teammates --------------------------------------------------------------

async function startTeammatesLab(pages: string, env: Record<string, string>): Promise<{ child: ChildProcess; origin: string }> {
  const port = 46_000 + randomInt(0, 9_000);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  let log = "";
  const child = spawn("npx", ["tsx", "../../packages/fsdev/bin/fsdev.ts", "dev", "--app", pages, "--config", CONFIG, "--port", String(port), "--no-open"], {
    cwd: TEAMMATES,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: intentFreeEnv(process.env, { GOAL_CONTROL: "", ...env }),
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  for (const end = Date.now() + 120_000; Date.now() < end; await sleep(500)) {
    if (child.exitCode !== null) throw new Error(`setup: Teammates exited (${child.exitCode}); log tail:\n${log.slice(-2000)}`);
    if (await fetch(origin, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)) return { child, origin };
  }
  stopProcessGroup(child);
  throw new Error(`setup: Teammates did not answer on ${origin}; log tail:\n${log.slice(-2000)}`);
}

const count = (page: Page, selector: string) => page.locator(selector).count();

/** Whether clicking the first button matching `selector` opens a dialog, which Esc then closes. */
async function opensPopup(page: Page, selector: string): Promise<string> {
  const line = page.locator(`button${selector}`).first();
  if ((await line.count()) === 0) return `no ${selector} line is a button`;
  await line.click();
  const dialog = page.getByRole("dialog");
  const opened = await dialog.first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  const name = opened ? ((await dialog.first().getAttribute("aria-label")) ?? "(unnamed)") : "";
  await page.keyboard.press("Escape");
  await dialog.first().waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
  return opened ? `opened "${name}"` : "the click opened nothing";
}

async function legT(browser: Browser, pages: string) {
  const lab = await startTeammatesLab(pages, labEnv("t"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await playConversation(lab.origin);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(lab.origin);
    await page.locator(`nav[aria-label="Workers"] button[data-worker="${CHIEF_NAME}"]`).click();
    await page.locator("[data-line=failed]").first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    const retry = await count(page, "[data-line=failed] button:has-text('Retry')");
    check("t:failed", (await count(page, "[data-line=failed]")) > 0 && retry > 0, `${await count(page, "[data-line=failed]")} failed line(s), ${retry} Retry`);
    check("t:stopped", (await count(page, "[data-line=stopped]")) > 0, `${await count(page, "[data-line=stopped]")} stopped line(s)`);
    check("t:sent", (await count(page, "[data-line=sent]")) > 0, `${await count(page, "[data-line=sent]")} sent line(s)`);
    check("t:received", (await count(page, "[data-line=received]")) > 0, `${await count(page, "[data-line=received]")} received line(s)`);
    // The card reads its task from the board: "done" is the board's word, never the filing's.
    const card = page.locator("[data-entry=task]").first();
    const status = (await card.count()) === 0 ? "no card" : ((await card.locator("[data-task-status]").first().textContent({ timeout: 20_000 }).catch(() => null)) ?? "no status");
    check("t:task", /done/i.test(status), `card status "${status}"`);
    check("t:result", (await count(page, "[data-line=result]")) > 0, `${await count(page, "[data-line=result]")} result line(s)`);
    check("t:steps", (await count(page, "[data-line=steps]")) > 0, `${await count(page, "[data-line=steps]")} steps line(s)`);
    const avatars = await count(page, "[data-line=sent] [data-avatar], [data-line=received] [data-avatar]");
    check("t:avatar", avatars >= 2, `${avatars} avatar(s) on the sent and received lines`);
    const sent = await opensPopup(page, "[data-line=sent]");
    check("t:opens-sent", sent.startsWith("opened"), sent);
    const result = await opensPopup(page, "[data-line=result]");
    check("t:opens-result", result.startsWith("opened"), result);
  } finally {
    await context.close();
    stopProcessGroup(lab.child);
  }
}

// ---- leg s: Shift Manager ----------------------------------------------------------

async function legS(browser: Browser, pages: string) {
  const served = await startShiftManager({ scratch: SCRATCH, label: "s", config: CONFIG, pages, env: labEnv("s"), timeoutMs: 180_000 });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const sessionId = await playConversation(served.origin);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await openShiftManager(page, served.origin, `/s/${encodeURIComponent(sessionId)}`);
    await page.locator("[data-line=failed]").first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    const retry = await count(page, "[data-line=failed] button:has-text('Retry')");
    check("s:failed", (await count(page, "[data-line=failed]")) > 0 && retry > 0, `${await count(page, "[data-line=failed]")} failed line(s), ${retry} Retry`);
    check("s:stopped", (await count(page, "[data-line=stopped]")) > 0, `${await count(page, "[data-line=stopped]")} stopped line(s)`);
    check("s:sent", (await count(page, "[data-line=sent]")) > 0, `${await count(page, "[data-line=sent]")} sent line(s)`);
    check("s:received", (await count(page, "[data-line=received]")) > 0, `${await count(page, "[data-line=received]")} received line(s)`);
    check("s:task", (await count(page, "[data-line=task]")) > 0, `${await count(page, "[data-line=task]")} task line(s)`);
    check("s:result", (await count(page, "[data-line=result]")) > 0, `${await count(page, "[data-line=result]")} result line(s)`);
    check("s:steps", (await count(page, "[data-testid=tool-group]")) > 0, `${await count(page, "[data-testid=tool-group]")} tool group(s)`);
    const links = await count(page, "[data-testid=messages-link]");
    check("s:messages-link", links > 0, `${links} Messages link(s)`);
  } finally {
    await context.close();
    await served.stop();
  }
}

// ---- the run -----------------------------------------------------------------------

await runGoal(async (failures) => {
  say(`scratch ${SCRATCH}${CONTROL === "" ? "" : `; control ${CONTROL}`}`);
  const tm = buildTeammatesCopy(patchesFor("teammates"));
  const sm = await buildShiftManagerCopy(SCRATCH, "shift-manager", patchesFor("shift-manager"));
  restoreNodeEnv();
  const diff = [...tm.diff, ...sm.diff.map((d) => `shift-manager ${d}`)];
  if (diff.length > 0) say(`patched:\n  ${diff.join("\n  ")}`);
  const browser = await launchChromium();
  try {
    for (const [leg, run] of [["t", () => legT(browser, tm.pages)], ["s", () => legS(browser, sm.pages)]] as const) {
      try {
        await run();
      } catch (error) {
        failures.push(`leg ${leg} setup: ${(error as Error).message.slice(0, 800)}`);
      }
    }
  } finally {
    await browser.close();
  }

  const lines = (Object.keys(CHECKS) as CheckId[]).map((id) => {
    const note = record.get(id) ?? `FAIL ${CHECKS[id]}: never ran`;
    return { id, red: note.startsWith("FAIL"), line: `${id} ${note}` };
  });
  const expected = new Set(CONTROLS[CONTROL]?.fails ?? []);
  for (const l of lines) {
    if (l.red && expected.has(l.id)) failures.push(`(expected under ${CONTROL}) ${l.line}`);
    else if (l.red) failures.push(`${CONTROL === "" ? "" : "WRONG: "}${l.line}`);
    else if (expected.has(l.id)) failures.push(`WRONG: ${l.id} stayed green under ${CONTROL}: ${l.line}`);
  }
  return { failures, evidence: [...lines.map((l) => l.line), ...(diff.length > 0 ? ["patched:", ...diff] : [])].join("\n") };
});
