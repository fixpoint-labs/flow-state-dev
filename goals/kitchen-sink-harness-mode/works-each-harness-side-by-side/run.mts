/**
 * Goal check (FIX-1918, the closure of epic FIX-1907): the four Kitchen Sink
 * modes worked side by side, on one server and one store, each on its real
 * model. In each mode turn 2 answers from turn 1 in the same conversation, an
 * item shows before the run completes, the plan panel shows the harness's own
 * plan or says it reports none, and after a reload turn 3 continues the same
 * conversation with the plan still there.
 *
 * Real path: `next dev`, one real browser, one tab per mode. Out of CI. See
 * goal.md for the contract.
 *
 * The modes run interleaved: turn 1 in each, then turn 2 in each, then the
 * job in each harness, then a reload and turn 3 in each, so every binding is
 * read back after the other modes' turns wrote to the same store.
 *
 * Legs, each tagged `<mode>:<leg>` with mode fs, cc, cx or cu:
 *
 *   host   the mode is available on this host; otherwise the picker's reason, and that mode is not walked.
 *   l      one of the run's items shows before turn 1 completes.
 *   c      turn 2 names the token without being told it, in turn 1's conversation.
 *   p      cc, cu: the panel's rows are the job's steps, in order, with this run's names.
 *          cx: "Codex reports no plan." and no row (fixture `codexPlan: "none"`), or Codex's
 *          own rows as cc's (`codexPlan: "rows"`). fs: not graded (ER-8).
 *   r      after a reload, the page is back in the session with the same id, and turn 3 names the token.
 *   kept   after the reload and turn 3, the panel still holds p's rows (or still says Codex reports none).
 *   own    the mode's rail lists none of the other modes' sessions; its panel holds none of their step names.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness-mode/works-each-harness-side-by-side/run.mts
 * Controls: GOAL_CONTROL=no-resume        (must FAIL at c and r of cc, cx and cu; kept may follow)
 *           GOAL_CONTROL=no-record        (must FAIL at p of cc and cu; kept may follow)
 *           GOAL_CONTROL=new-conversation (must FAIL at fs:c; fs:r may follow)
 * The server-side controls run in test mode with the real harnesses, where
 * Flow State's model is scripted, so they walk the three coding modes only.
 *
 * GOAL_SCRIPTED=1 walks the scripted harnesses and model instead: a dry run of
 * the walk's own mechanics on any host, never a verdict on the epic.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { Page, Route } from "playwright";
import { KITCHEN_SINK, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { refuseIfAnswering, stopProcessGroup } from "../../lib/server.mts";

interface ModeFixture {
  readonly id: string;
  readonly tag: string;
  readonly label: string;
  readonly href: string;
  /** What the job's prompt calls the harness's own plan; `null` for Flow State. */
  readonly plan: string | null;
}

const fixture = loadFixture<{ port: number; codexPlan: "none" | "rows"; modes: ModeFixture[] }>(import.meta.url);
const ORIGIN = `http://127.0.0.1:${fixture.port}`;
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** How long one real turn may take. */
const TURN_MS = 240_000;

/** Each control's legs: the ones it must redden, and the ones it may redden as a consequence. */
const EXPECTED: Record<string, { must: string[]; may: string[] }> = {
  "no-resume": { must: ["cc:c", "cc:r", "cx:c", "cx:r", "cu:c", "cu:r"], may: ["cc:kept", "cx:kept", "cu:kept"] },
  "no-record": { must: ["cc:p", "cu:p"], may: ["cc:kept", "cu:kept"] },
  "new-conversation": { must: ["fs:c"], may: ["fs:r"] },
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}
/** A control the server reads: it needs test mode, where Flow State's model is scripted. */
const SERVER_CONTROL = CONTROL === "no-resume" || CONTROL === "no-record";
/** A dry run on the scripted harnesses and model (`GOAL_SCRIPTED=1`). */
const SCRIPTED = process.env.GOAL_SCRIPTED === "1";

/**
 * `next dev`, so the unset workspace setting means "the checkout the server
 * runs in". Outside a server control nothing is in test mode: every harness
 * and Flow State's model are the real ones.
 */
async function startDev(): Promise<{ stop: () => void; log: () => string }> {
  await refuseIfAnswering(ORIGIN);
  let log = "";
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", STORE_TYPE: "filesystem" };
  delete env.KITCHEN_SINK_HARNESS_WORKSPACE;
  delete env.KITCHEN_SINK_TEST_MODE;
  delete env.NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE;
  delete env.GOAL_CONTROL;
  if (SERVER_CONTROL || SCRIPTED) Object.assign(env, { KITCHEN_SINK_TEST_MODE: "1" });
  if (SERVER_CONTROL) Object.assign(env, { GOAL_CONTROL: CONTROL });
  if (!SCRIPTED) Object.assign(env, { KITCHEN_SINK_REAL_HARNESS: "1" });
  const child: ChildProcess = spawn("pnpm", ["exec", "next", "dev", "--port", String(fixture.port)], {
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

/** Flow State draws a mobile and a desktop copy of some handles; only the shown one is the person's. */
const shown = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
const stopButton = (page: Page) => page.locator('button[aria-label="Stop"]:visible');
/** The run's own items in the conversation: an answer, a tool line or a tool group. Never the person's line. */
const RUN_ITEMS = '[data-testid="message"]:not([data-message-role="user"]), [data-testid="tool-row"], [data-testid="tool-group"]';
const TURN_2 = "What token did I ask you to remember? Answer with the token only.";

/** One mode as the walk works it: its tab, its token, and what each turn read. */
interface Walk {
  readonly mode: ModeFixture;
  readonly page: Page;
  readonly token: string;
  /** This run's step names for the job, picked per run. */
  readonly steps: string[];
  /** The session the mode's tab works in. */
  sessionId: string;
  /** The conversation turn 1 bound: the harness's id, or the session for Flow State. */
  bound: string;
  /** The panel's rows after the job. */
  planAfterJob: string[];
  /** Flow State's sessions, read off each action request the tab sends. */
  readonly sentTo: string[];
}

const harness = (walk: Walk) => walk.mode.id !== "flow-state";

/** How many times the run's own items name the token. The person's lines never count: turn 1's names it. */
async function tokenCount(walk: Walk): Promise<number> {
  const texts = await shown(walk.page, "conversation").first().locator(RUN_ITEMS).allTextContents();
  return texts.join("\n").split(walk.token).length - 1;
}

/** Wait until a reloaded tab has drawn its conversation again, up to turn 2's line. */
async function conversationLoaded(page: Page): Promise<boolean> {
  return shown(page, "conversation")
    .first()
    .getByText(TURN_2, { exact: false })
    .first()
    .waitFor({ timeout: 60_000 })
    .then(() => true, () => false);
}

/** The conversation a harness tab shows as bound, once the session's state has arrived. */
async function boundId(page: Page): Promise<string> {
  await page
    .waitForFunction(
      () => {
        const text = document.querySelector('[data-testid="bound-conversation"]')?.textContent?.trim();
        return text !== undefined && text !== "" && text !== "none yet";
      },
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  return ((await page.getByTestId("bound-conversation").textContent()) ?? "").trim();
}

/** Send a turn and wait for it to end. Returns whether one of the run's items showed while it ran. */
async function turn(walk: Walk, prompt: string): Promise<{ sawItemWhileRunning: boolean }> {
  const { page } = walk;
  const items = () => shown(page, "conversation").first().locator(RUN_ITEMS).count();
  const before = await items();
  const input = shown(page, "message-input").first();
  await input.fill(prompt);
  await input.press("Enter");
  // A turn the page never shows running (a control that sent it elsewhere) still ends here.
  await stopButton(page).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  let sawItemWhileRunning = false;
  const deadline = Date.now() + TURN_MS;
  while (Date.now() < deadline) {
    if (!(await stopButton(page).first().isVisible())) break;
    if ((await items()) > before) sawItemWhileRunning = true;
    await page.waitForTimeout(500);
  }
  if (harness(walk)) await page.getByTestId("turn-notice").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  return { sawItemWhileRunning };
}

/** The plan panel, as drawn: its rows' titles and its whole text. */
async function panel(page: Page): Promise<{ titles: string[]; text: string }> {
  const plan = page.getByTestId("plan-panel");
  const titles = await plan
    .getByTestId("plan-row")
    .evaluateAll((lis) => lis.map((li) => li.querySelector('[data-testid="plan-row-title"]')?.textContent?.trim() ?? ""))
    .catch(() => [] as string[]);
  const text = ((await plan.textContent({ timeout: 5_000 }).catch(() => null)) ?? "").trim();
  return { titles, text };
}

/** Whether this mode's plan leg grades rows: Claude Code and Cursor always, Codex when the fixture says so. */
function gradesRows(walk: Walk): boolean {
  return walk.mode.id === "claude-code" || walk.mode.id === "cursor" || (walk.mode.id === "codex" && fixture.codexPlan === "rows");
}

/**
 * Under `new-conversation`, Flow State's turn 2 goes to a fresh session of its
 * flow instead of the tab's own, as a page that started over would send it.
 * The page is not told: its own stream stays on turn 1's session.
 */
async function startOverOnce(walk: Walk): Promise<() => Promise<void>> {
  let armed = false;
  const pattern = /\/api\/flows\/chat-agent\/[^/]+\/actions\//;
  const handler = async (route: Route) => {
    const request = route.request();
    if (!armed || request.method() !== "POST") return route.continue();
    armed = false;
    const fresh = `goal-fresh-${randomUUID()}`;
    await walk.page.request.post(`${ORIGIN}/api/flows/chat-agent/sessions`, { data: { sessionId: fresh } });
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    return route.continue({
      url: request.url().replace(pattern, `/api/flows/chat-agent/${encodeURIComponent(fresh)}/actions/`),
      postData: JSON.stringify({ ...body, sessionId: fresh }),
    });
  };
  await walk.page.route(pattern, handler);
  return async () => {
    armed = true;
  };
}

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const modes = fixture.modes.filter((m) => !SERVER_CONTROL || m.id !== "flow-state");
  if (SERVER_CONTROL) evidence.push(`GOAL_CONTROL=${CONTROL} runs in test mode, where Flow State is scripted: fs not walked`);
  if (SCRIPTED) failures.push("[scripted] GOAL_SCRIPTED=1 walked the scripted harnesses and model: a dry run, not a verdict");

  const server = await startDev();
  const browser = await launchChromium();
  try {
    // ---- host: which modes this host can run, read off the picker
    const picker = await browser.newPage();
    await picker.goto(`${ORIGIN}/`, { timeout: 300_000 });
    const walks: Walk[] = [];
    for (const mode of modes) {
      const card = picker.locator(`[data-mode-id="${mode.id}"]`);
      await card.waitFor({ timeout: 60_000 });
      if ((await card.getAttribute("data-available")) !== "true") {
        const reason = await card.getByTestId("mode-reason").textContent().catch(() => null);
        fail(`${mode.tag}:host`, `${mode.label} mode is unavailable here: ${reason ?? "(no reason drawn)"}`);
        continue;
      }
      const page = await browser.newPage();
      const words = Array.from({ length: 3 }, (_, i) => `${mode.tag}-step-${i + 1}-${randomBytes(3).toString("hex")}`);
      const walk: Walk = {
        mode,
        page,
        token: `ks-${mode.tag}-${randomBytes(6).toString("hex")}`,
        steps: words,
        sessionId: "",
        bound: "",
        planAfterJob: [],
        sentTo: [],
      };
      page.on("request", (request) => {
        const match = /\/api\/flows\/chat-agent\/([^/]+)\/actions\//.exec(request.url());
        if (match !== null && request.method() === "POST") walk.sentTo.push(decodeURIComponent(match[1]!));
      });
      walks.push(walk);
    }
    await picker.close();

    const fsWalk = walks.find((w) => w.mode.id === "flow-state");
    const startOver = CONTROL === "new-conversation" && fsWalk !== undefined ? await startOverOnce(fsWalk) : undefined;

    // ---- turn 1 in each mode: a new session, the token, and l
    for (const walk of walks) {
      const { page, mode } = walk;
      await page.goto(`${ORIGIN}${mode.href}`, { timeout: 300_000 });
      if (harness(walk)) {
        await page.getByTestId("new-session").click();
        await page.waitForFunction(() => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id"));
        walk.sessionId = (await page.getByTestId("stream").getAttribute("data-session-id"))!;
      } else {
        // "New session" sits on the assistant's rail row, drawn once the row is open.
        await page.getByTestId("rail").getByText("chat-agent", { exact: true }).click();
        await page.locator('button[aria-label="New session"]:visible').first().click();
        await page.waitForTimeout(2_000);
      }
      const first = await turn(walk, `Remember this token for later: ${walk.token}. Reply "noted" and nothing else.`);
      if (!first.sawItemWhileRunning) fail(`${mode.tag}:l`, `nothing of ${mode.label}'s showed before turn 1 completed`);
      if (harness(walk)) {
        walk.bound = await boundId(page);
      } else {
        walk.sessionId = walk.sentTo.at(-1) ?? "";
        walk.bound = walk.sessionId;
      }
      if (walk.bound === "") fail(`${mode.tag}:c`, "turn 1 bound no conversation the page shows");
      evidence.push(`${mode.tag} session ${walk.sessionId} bound ${walk.bound}`);
    }

    // ---- c: turn 2 in each mode, by token alone
    for (const walk of walks) {
      const seen = await tokenCount(walk);
      if (walk === fsWalk && startOver !== undefined) await startOver();
      await turn(walk, TURN_2);
      if ((await tokenCount(walk)) <= seen) fail(`${walk.mode.tag}:c`, "turn 2's reply did not name the token");
      const now = harness(walk) ? await boundId(walk.page) : walk.sentTo.at(-1) ?? "";
      if (now !== walk.bound) fail(`${walk.mode.tag}:c`, `the conversation moved from ${walk.bound} to ${now}`);
    }

    // ---- p: the job in each harness; the panel shows its own plan, or says it reports none
    for (const walk of walks.filter(harness)) {
      const { page, mode, steps } = walk;
      await turn(
        walk,
        `Use your ${mode.plan} to plan exactly three steps, with these names in this order: ${steps.join(", ")}. ` +
          `Then mark each one completed in turn. Don't run any commands or edit any files. Reply "done".`,
      );
      await page.getByTestId("plan-row").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
      const drawn = await panel(page);
      walk.planAfterJob = drawn.titles;
      if (gradesRows(walk)) {
        tell.over(`${mode.tag}:p · the panel's rows after the job`, drawn.titles);
        if (JSON.stringify(drawn.titles) !== JSON.stringify(steps)) {
          fail(`${mode.tag}:p`, `the panel's rows are ${JSON.stringify(drawn.titles)} (want ${JSON.stringify(steps)}); it reads ${JSON.stringify(drawn.text)}`);
        }
      } else if (!drawn.text.includes(`${mode.label} reports no plan.`) || drawn.titles.length > 0) {
        fail(`${mode.tag}:p`, `the panel reads ${JSON.stringify(drawn.text)} with ${drawn.titles.length} rows (want "${mode.label} reports no plan." and none)`);
      }
      evidence.push(`${mode.tag} panel ${JSON.stringify(drawn.titles)}`);
    }

    // ---- r and kept: a reload in each mode, then turn 3, then the plan read again
    for (const walk of walks) {
      const { page, mode } = walk;
      await page.reload({ timeout: 300_000 });
      if (harness(walk)) {
        const back = await page
          .waitForFunction((id) => document.querySelector('[data-testid="stream"]')?.getAttribute("data-session-id") === id, walk.sessionId, {
            timeout: 30_000,
          })
          .then(() => true, () => false);
        if (!back) {
          fail(`${mode.tag}:r`, `after a reload the page is not back in session ${walk.sessionId}`);
          continue;
        }
        const reloaded = await boundId(page);
        if (reloaded !== walk.bound) fail(`${mode.tag}:r`, `after a reload the session shows ${reloaded} (want ${walk.bound})`);
      }
      if (!(await conversationLoaded(page))) {
        fail(`${mode.tag}:r`, "after a reload the conversation never drew turn 2 again");
        continue;
      }
      const seen = await tokenCount(walk);
      await turn(walk, "One more time: the token, only.");
      if ((await tokenCount(walk)) <= seen) fail(`${mode.tag}:r`, "after a reload, turn 3 did not name the token");
      const now = harness(walk) ? await boundId(page) : walk.sentTo.at(-1) ?? "";
      if (now !== walk.bound) fail(`${mode.tag}:r`, `after a reload turn 3 went to ${now} (want ${walk.bound})`);

      if (harness(walk)) {
        const drawn = await panel(page);
        if (gradesRows(walk)) {
          if (walk.planAfterJob.length === 0 || JSON.stringify(drawn.titles) !== JSON.stringify(walk.planAfterJob)) {
            fail(`${mode.tag}:kept`, `after the reload and turn 3 the panel's rows are ${JSON.stringify(drawn.titles)} (want ${JSON.stringify(walk.planAfterJob)})`);
          }
        } else if (!drawn.text.includes(`${mode.label} reports no plan.`) || drawn.titles.length > 0) {
          fail(`${mode.tag}:kept`, `after the reload the panel reads ${JSON.stringify(drawn.text)} (want "${mode.label} reports no plan.")`);
        }
      }
    }

    // ---- own: no mode's rail or panel holds another mode's session or steps
    const sessions = tell.over("own · the walked modes' sessions", walks.map((w) => w.sessionId).filter((id) => id !== ""));
    for (const walk of walks) {
      const { page, mode } = walk;
      const others = walks.filter((w) => w !== walk);
      // A rail still loading, erroring or empty has no rows, so it would pass vacuously: its own session must show first.
      if (!harness(walk)) {
        // The reload closed the assistant's rail row, and its sessions are drawn only while it is open.
        const row = shown(page, "rail").first().locator('button[data-kind="chat-agent"]');
        if ((await row.getAttribute("aria-expanded").catch(() => null)) === "false") await row.click();
      }
      const ownRow = harness(walk)
        ? page.getByTestId("session-list").locator(`[data-session-id="${walk.sessionId}"]`)
        : shown(page, "rail").first().locator(`[data-session-id="${walk.sessionId}"]`);
      if (walk.sessionId === "" || !(await ownRow.first().waitFor({ state: "attached", timeout: 15_000 }).then(() => true, () => false))) {
        fail(`${mode.tag}:own`, `the rail never listed this mode's own session ${JSON.stringify(walk.sessionId)}, so it can't show what it leaves out`);
        continue;
      }
      const listed = harness(walk)
        ? await page.getByTestId("session-list").locator("[data-session-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-session-id") ?? ""))
        : await page.locator("[data-session-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-session-id") ?? ""));
      const railText = (await shown(page, harness(walk) ? "session-list" : "rail").first().textContent().catch(() => null)) ?? "";
      const leaked = sessions.filter((id) => id !== walk.sessionId && (listed.includes(id) || railText.includes(id)));
      if (leaked.length > 0) fail(`${mode.tag}:own`, `the rail lists another mode's session: ${leaked.join(", ")}`);
      if (harness(walk)) {
        const text = (await panel(page)).text;
        const foreign = others.flatMap((w) => w.steps).filter((step) => text.includes(step));
        if (foreign.length > 0) fail(`${mode.tag}:own`, `the plan panel holds another mode's steps: ${foreign.join(", ")}`);
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }

  if (CONTROL !== "") {
    const { must, may } = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of must) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left ${leg} green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!must.includes(leg) && !may.includes(leg) && leg !== "control" && !leg.endsWith(":host")) {
        failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened ${leg}`);
      }
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
