/**
 * Goal check: a person's line, typed in Shift Manager, reaches a worker's running
 * coding run. The run stops, and its next attempt continues the same coding
 * session with the line. See goal.md for the contract.
 *
 * Real path, no model. Shift Manager is built with Vite and served by its own start
 * script over two Labs: DevTeam on this goal's recording harness
 * (`lab/fsdev.config.mts`), with two coder rows running, and a fixture Lab
 * whose one seat asks and hears (`lab/asker/`). Chromium sends a fresh token
 * three ways: the task composer, and Inbox's reply on each Lab's ask. What happened is read from the store, through each Lab's routes with
 * this script's own requests, and from the file the harness writes each
 * attempt to. Never from Shift Manager's state.
 *
 * Legs (each failure is tagged `[<route>] <leg>`):
 *
 *   delivered    the run session the task links to holds the line as a user
 *                item, the composer showed *delivered* only once it did, and
 *                the task's run link still names that session and request
 *   stopped      the running run ended for the line (a steer, FIX-2086), not
 *                its request: the request still runs the next run
 *   continued    the harness recorded a next run whose prompt holds the
 *                line and whose resume id is the previous run's session
 *   standing     the row's attempts and retry standing are unchanged by
 *                the line, read from the stored row
 *   only that    the line reaches the task it was typed on, not the other
 *                task running beside it
 *   em door      Inbox's reply to DevTeam's EM ask lands in the EM's session, and the EM answers it
 *   heard        Inbox's reply to the fixture seat's ask is in the ask's
 *                session, the seat says it heard it, and Inbox then draws it
 *                under the ask as the person's reply
 *   reach        the pages throw nothing
 *
 * Controls:
 *
 *   optimistic-turn  Shift Manager built with `src/lib/send.ts` swapped for
 *                    `controls/optimistic-turn.ts`: delivered without calling
 *                    the door. Must fail at "delivered".
 *   fresh-session    the harness drops the resume id it is offered. Must fail
 *                    at "continued", naming the resume id.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-sends-a-turn-into-a-seat-session/run.mts
 * Control:  GOAL_CONTROL=fresh-session … (same command)
 * Before:   GOAL_PAGES=<pages built from another commit> … serves those pages instead of building.
 */
import { onClosed } from "../../lib/server.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import { sessionIdOfFiling } from "@flow-state-dev/workforce/browser";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { LAB_ORG_ID, LAB_USER_ID } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { workerSessionId } from "../../../packages/shift-manager/teams/devteam/ask.mts";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { SHIFT_MANAGER_COMMAND, servedAddresses } from "../../lib/shift-manager.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { ASKER_FLOW, heardLine } from "./lab/asker/asker.mts";
import type { RecordedAttempt } from "./lab/recording-harness.mts";
import { EM_ANSWER, ROWS, STORE_ENV } from "./lab/rows.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["optimistic-turn", "fresh-session"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "packages", "shift-manager");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("shift-manager-turn");
const RUNS_FILE = join(SCRATCH, `runs-${Date.now()}.ndjson`);
const STORE_FILE = join(SCRATCH, `devteam-${Date.now()}.db`);
const LABS = {
  devteam: { config: join(HERE, "lab", "fsdev.config.mts"), tree: join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam", "workforce") },
  asker: { config: join(HERE, "lab", "asker", "fsdev.config.mts"), tree: join(HERE, "lab", "asker", "workforce") },
} as const;
type LabName = keyof typeof LABS;
/** How long a composer may take to say what became of a line. The door waits up to a minute for a run to stop. */
const SEND_MS = 90_000;
/** How long the next attempt may take to start after the line is delivered. */
const NEXT_ATTEMPT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const token = (route: string) => `${route}-${randomBytes(4).toString("hex")}`;

// ---- building Shift Manager --------------------------------------------------------

async function buildShiftManager(control: string): Promise<string> {
  const outDir = join(SCRATCH, `pages-${control === "optimistic-turn" ? control : "as-written"}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const swap =
    control === "optimistic-turn"
      ? { target: join(SHIFT_MANAGER, "src", "lib", "send.ts"), with: join(HERE, "controls", "optimistic-turn.ts") }
      : undefined;
  let swapped = 0;
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
    define: { __STATIC_SEATS__: "[]" },
    plugins:
      swap === undefined
        ? []
        : [
            {
              name: "goal-control-swap",
              enforce: "pre",
              async resolveId(this: any, source: string, importer: string | undefined, options: Record<string, unknown>) {
                if (importer === undefined || importer === swap.with) return null;
                const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
                if (resolved?.id !== swap.target) return null;
                swapped += 1;
                return swap.with;
              },
            },
          ],
  });
  if (swap !== undefined && swapped === 0) throw new Error(`control ${control}: the build never imported ${swap.target}, so nothing was swapped`);
  return outDir;
}

// ---- serving a Lab -----------------------------------------------------------

type Running = { origin: string; child: ChildProcess; exited: Promise<void>; log: () => string };

async function startLab(name: LabName, pages: string): Promise<Running> {
  mkdirSync(join(SCRATCH, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(SCRATCH, "labs", `${name}-`));
  let log = "";
  const child = spawn(TSX, [SHIFT_MANAGER_COMMAND, "--config", LABS[name].config, "--port", "0", "--no-open", "--assets", pages], {
    cwd: workDir,
    env: intentFreeEnv(process.env, {
      INIT_CWD: workDir,
      GOAL_CONTROL: "",
      TURN_GOAL_RUNS: RUNS_FILE,
      [STORE_ENV]: STORE_FILE,
      TURN_GOAL_CONTROL: CONTROL === "fresh-session" ? CONTROL : "",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    onClosed(child, () => {
      gone = true;
      resolve();
    }),
  );
  for (let waited = 0; waited < 120_000; waited += 250) {
    const served = servedAddresses(log);
    if (served !== undefined) return { origin: served.origin, child, exited, log: () => log };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's command never served ${name}. Log tail:\n${log.slice(-2000)}`);
}

// ---- the store, read by this script -----------------------------------------

type Row = {
  id: string;
  /** Where the row is stored in the person's conversation ledger: `<partition>/<taskId>`. */
  topic: string;
  /** What the row is, as filed: the board's view carries no payload, so a filed row is found by it. */
  goal: string;
  status: string;
  title: string;
  attempts: number;
  run: { sessionId: string; requestId: string } | null;
};

function labApi(origin: string, bearer: string | undefined) {
  const enc = encodeURIComponent;
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: { "content-type": "application/json", ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  };
  const get = async (path: string): Promise<any> => {
    const { status, body } = await call("GET", path);
    if (status !== 200) throw new Error(`GET ${path}: ${status} ${JSON.stringify(body)}`);
    return body;
  };
  /** One conversation's board: the person's conversation ledger read through it, its own rows kept. */
  const rows = async (sessionId: string): Promise<Row[]> => {
    const body = await get(`/sessions/${enc(sessionId)}/resources/tasks?limit=200`);
    const items = (body.items ?? []) as Array<{ topic: string; clientData?: Record<string, any> }>;
    return items
      .filter((item) => sessionIdOfFiling(decodeURIComponent(item.topic.split("/")[0] ?? "")) === sessionId)
      .map(({ topic, clientData: r = {} }) => ({
        id: String(r.id),
        topic,
        goal: String(r.goal ?? ""),
        status: String(r.status),
        title: String(r.title ?? r.id),
        attempts: Number(r.attempts ?? 0),
        run: r.run == null ? null : { sessionId: String(r.run.sessionId), requestId: String(r.run.requestId) },
      }));
  };
  const ownerOf = async (sessionId: string): Promise<string> => {
    const body = await get(`/sessions/${enc(sessionId)}`);
    return String((body.session ?? body).flowId);
  };
  const requestStatus = async (flowId: string, requestId: string): Promise<string> =>
    String((await get(`/${enc(flowId)}/requests/${enc(requestId)}/status`)).status);
  /** Every message item in one session, oldest first. */
  const messages = async (sessionId: string): Promise<Array<{ role?: string; content?: unknown; text?: unknown }>> => {
    const out: Array<Record<string, any>> = [];
    for (let offset = 0, page = 0; page < 50; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/state?include_items=true&item_types=message&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  /** Whether the session holds a message of `role` whose text contains `needle`. */
  const holds = async (sessionId: string, role: string, needle: string): Promise<boolean> =>
    (await messages(sessionId)).some((m) => m.role === role && JSON.stringify(m.content ?? m.text ?? m).includes(needle));
  return { call, get, rows, ownerOf, requestStatus, holds };
}
type LabApi = ReturnType<typeof labApi>;

/** The stored row's retry counters, read from DevTeam's store file. */
type Counters = { attempts: number; abandonments: number };
/** Retry standing: the attempts the row has been charged for (BR-9). */
const standing = (c: Counters) => c.attempts - c.abandonments;

/** The lab user's storage cell, where the conversation ledger is kept. */
const USER_CELL = resolveUserStorageKey(LAB_USER_ID, LAB_ORG_ID, { id: "", isolateUserState: false });

async function storedCounters(topic: string): Promise<Counters | undefined> {
  const stores = createSQLiteStores({ filename: STORE_FILE, skipSchemaInit: true });
  try {
    const record = (await stores.resourceState.get("user", USER_CELL, `tasks/${topic}`)) as { state?: Record<string, unknown> } | undefined;
    const state = record?.state;
    if (state === undefined) return undefined;
    return {
      attempts: Number(state.attempts ?? 0),
      abandonments: Number(state.abandonments ?? 0),
    };
  } finally {
    stores.close();
  }
}

/** What the harness recorded, read from disk. */
function attempts(): RecordedAttempt[] {
  if (!existsSync(RUNS_FILE)) return [];
  return readFileSync(RUNS_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordedAttempt);
}
/** A row's attempts, by the row line of the prompt each was handed. */
const attemptsOf = (rowId: string) => attempts().filter((a) => a.row.startsWith(`Row ${rowId},`));

// ---- the page ----------------------------------------------------------------

async function open(page: Page, origin: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
}

/**
 * Click Send, then watch the composer's status until it settles. The moment it
 * first reads *delivered*, read the store: the line must already be there.
 */
async function sendAndWatch(
  page: Page,
  composer: string,
  heldNow: () => Promise<boolean>,
): Promise<{ state: string; heldAtDelivered: boolean | null; error: string | null }> {
  await page.getByTestId(`${composer}-send`).click();
  for (const until = Date.now() + SEND_MS; Date.now() < until; await sleep(50)) {
    const state = (await page.getByTestId(`${composer}-status`).getAttribute("data-state")) ?? "";
    if (state === "delivered") return { state, heldAtDelivered: await heldNow(), error: null };
    const error = await page.getByTestId(`${composer}-error`).textContent({ timeout: 50 }).catch(() => null);
    if (error !== null) return { state: state || "error", heldAtDelivered: null, error };
  }
  return { state: "sending", heldAtDelivered: null, error: `nothing settled within ${SEND_MS / 1000}s` };
}

// ---- one turn into a coding run ----------------------------------------------

type Turn = { route: string; line: string; row: Row; counters: Counters; issue: string; owner: string; previousSession: string | null };
/** The conversation whose board holds the rows: the EM worker's own session. */
type Where = { sessionId: string };

/** Read a row's state, and the harness's last attempt for it, before a turn. */
async function before(api: LabApi, where: Where, filed: { issue: string; goal: string }, route: string): Promise<Turn> {
  const { issue } = filed;
  const row = (await api.rows(where.sessionId)).find((r) => r.goal === filed.goal);
  if (row === undefined || row.status !== "in_progress" || row.run === null) {
    throw new Error(`store: ${issue} is not running (${row === undefined ? "no row" : `${row.status}, ${row.run === null ? "no run" : "linked"}`})`);
  }
  const counters = await storedCounters(row.topic);
  if (counters === undefined) throw new Error(`store: ${row.id} is not stored at tasks/${row.topic} in ${STORE_FILE}`);
  return {
    route,
    line: token(route),
    row,
    counters,
    issue,
    owner: await api.ownerOf(row.run.sessionId),
    previousSession: attemptsOf(row.id).at(-1)?.session ?? null,
  };
}

/** Grade one turn after its composer settled. */
async function grade(
  api: LabApi,
  where: Where,
  turn: Turn,
  sent: Awaited<ReturnType<typeof sendAndWatch>>,
  fail: (leg: string, why: string) => void,
  evidence: string[],
): Promise<void> {
  const run = turn.row.run!;
  // delivered
  if (sent.state !== "delivered") fail("delivered", `the composer never read delivered: ${sent.state}${sent.error === null ? "" : `, "${sent.error}"`}`);
  else if (sent.heldAtDelivered !== true) fail("delivered", `the composer read delivered while ${run.sessionId} held no user item with the line`);
  const held = await api.holds(run.sessionId, "user", turn.line);
  if (!held) fail("delivered", `the run session ${run.sessionId} holds no user item with the line`);

  // continued: the running run ended and the next run took the line, in the
  // same coding session (FIX-2086: a steer ends the run, not the request).
  let next: RecordedAttempt | undefined;
  for (const until = Date.now() + NEXT_ATTEMPT_MS; Date.now() < until && next === undefined; await sleep(250)) {
    next = attemptsOf(turn.row.id).find((a) => a.prompt.includes(turn.line));
  }
  if (next === undefined) fail("continued", `the harness recorded no run on ${turn.issue} whose prompt holds the line`);
  else if (next.resume !== turn.previousSession) {
    fail("continued", `the next run resumed ${next.resume ?? "nothing"} (the resume id), wanted the previous run's session ${turn.previousSession}`);
  }

  // stopped: the run was stopped for the line, not its request. The request
  // that was running runs the next run: still in_progress, never aborted.
  const record = await api.requestStatus(turn.owner, run.requestId);
  if (next !== undefined && record !== "in_progress") fail("stopped", `the running attempt's request ${run.requestId} reads ${record}, wanted it running the next run`);

  // standing: the line used no attempt and charged nothing.
  const after = await storedCounters(turn.row.topic);
  if (after === undefined) fail("standing", `the row ${turn.row.id} is no longer stored`);
  else if (after.attempts !== turn.counters.attempts || standing(after) !== standing(turn.counters)) {
    fail("standing", `the line cost the task: attempts ${turn.counters.attempts} → ${after.attempts}, standing ${standing(turn.counters)} → ${standing(after)}`);
  }
  // delivered, read again after delivery: the task's run link still names the
  // session and the request the line was delivered into, so the task's
  // Session view keeps showing it.
  const linked = (await api.rows(where.sessionId)).find((r) => r.id === turn.row.id)?.run ?? null;
  if (linked === null || linked.sessionId !== run.sessionId || linked.requestId !== run.requestId) {
    fail("delivered", `after delivery the task links ${linked === null ? "nothing" : `${linked.sessionId} / ${linked.requestId}`}, not ${run.sessionId} / ${run.requestId} where the line was delivered`);
  }

  evidence.push(
    `${turn.route} → ${turn.row.id}: ${sent.state}${sent.heldAtDelivered === true ? " (held when drawn)" : ""}, linked after ${linked?.sessionId === run.sessionId ? "same session" : (linked?.sessionId ?? "none")}, request ${record}, ` +
      `next run resume=${next?.resume ?? "none"} (previous ${turn.previousSession}), standing ${standing(turn.counters)} → ${after === undefined ? "?" : `${standing(after)} (attempts ${after.attempts}, abandonments ${after.abandonments})`}`,
  );
}

// ---- the goal ----------------------------------------------------------------

await runGoal(async (failures) => {
  const devteam = await readDeclaredRoster(LABS.devteam.tree);
  const em = devteam.workers.find((w) => w.declared.flow === "em")!;
  // The rows are filed through the EM's own action, on its own session's board.
  const where: Where = { sessionId: workerSessionId(em.id) };
  // The asker lab's one worker on the asker kind; its coordinator, `desk.front`, is another worker file.
  const asker = (await readDeclaredRoster(LABS.asker.tree)).workers.find((w) => w.declared.flow === ASKER_FLOW)!;

  const pages = process.env.GOAL_PAGES ?? (await buildShiftManager(CONTROL));
  const evidence: string[] = [];
  const served = { devteam: await startLab("devteam", pages), asker: await startLab("asker", pages) };
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.setDefaultTimeout(10_000);

    // ---- DevTeam ------------------------------------------------------------
    await open(page, served.devteam.origin, "/tasks");
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { bearerToken?: string } | null;
    const api = labApi(served.devteam.origin, injected?.bearerToken);
    for (let waited = 0; waited < 60_000; waited += 250) {
      const running = (await api.rows(where.sessionId)).filter((r) => r.status === "in_progress" && r.run !== null);
      if (running.length === ROWS.length && running.every((r) => attemptsOf(r.id).length > 0)) break;
      await sleep(250);
    }

    const leg = async (route: string, run: (fail: (leg: string, why: string) => void) => Promise<void>) => {
      const fail = (name: string, why: string) => failures.push(`[${route}] ${name}: ${why}`);
      try {
        await run(fail);
      } catch (error) {
        fail("reach", String((error as Error).message ?? error).split("\n")[0]!);
      }
    };

    // The task composer, on the first row.
    await leg("task composer", async (fail) => {
      const turn = await before(api, where, ROWS[0], "task");
      await page.getByTestId("nav-tasks").click();
      await page.locator(`[data-testid=task-row][data-task-id="${turn.row.id}"]`).click();
      await page.locator(`[data-testid=task-frame][data-task-id="${turn.row.id}"]`).waitFor();
      const input = page.getByTestId("task-composer-input");
      await page.waitForFunction(() => !(document.querySelector("[data-testid=task-composer-input]") as HTMLTextAreaElement | null)?.disabled);
      await input.fill(turn.line);
      const other = (await api.rows(where.sessionId)).find((r) => r.id !== turn.row.id && r.run !== null);
      const sent = await sendAndWatch(page, "task-composer", () => api.holds(turn.row.run!.sessionId, "user", turn.line));
      await grade(api, where, turn, sent, fail, evidence);
      if (other === undefined) fail("only that", "no second task was running beside it");
      else if (await api.holds(other.run!.sessionId, "user", turn.line)) fail("only that", `the line also reached ${other.id}, which it was not typed on`);
    });

    // Inbox, on DevTeam's EM ask: every worker flow has a door, the EM's too. Its
    // turn is scripted to say it filed nothing; the leg grades that it answered there.
    await leg("Inbox, EM door", async (fail) => {
      await open(page, served.devteam.origin, "/inbox");
      await page.getByTestId("inbox-item").first().click();
      const emSession = workerSessionId(em.id);
      const line = token("em");
      await page.getByTestId("inbox-reply-input").fill(line);
      const sent = await sendAndWatch(page, "inbox-reply", () => api.holds(emSession, "user", line));
      if (sent.state !== "delivered") fail("em door", `the reply never read delivered: ${sent.state}${sent.error === null ? "" : `, "${sent.error}"`}`);
      if (!(await api.holds(emSession, "user", line))) fail("em door", `${emSession} holds no user item with the reply`);
      let answered = false;
      for (const until = Date.now() + 15_000; !answered && Date.now() < until; await sleep(250)) answered = await api.holds(emSession, "assistant", EM_ANSWER);
      if (!answered) fail("em door", `${em.id} never answered the line in ${emSession}`);
      evidence.push(`Inbox reply on ${em.id}: ${sent.state}, in ${emSession}, answered`);
    });

    // ---- the fixture seat ----------------------------------------------------
    await leg("Inbox reply", async (fail) => {
      await open(page, served.asker.origin, "/inbox");
      const config = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string } | null;
      const askerApi = labApi(served.asker.origin, undefined);
      const askSession = `s_turn_goal_${randomBytes(3).toString("hex")}`;
      // A worker has no flow address of its own: the ask runs in a session of the flow its file names, created naming it.
      const askerFlow = String(asker.declared.flow);
      const opened = await askerApi.call("POST", `/${encodeURIComponent(askerFlow)}/sessions`, { userId: config?.userId, sessionId: askSession, state: { workerId: asker.id } });
      if (opened.status !== 201) throw new Error(`a session with ${asker.id} on "${askerFlow}": ${opened.status} ${JSON.stringify(opened.body)}`);
      const posted = await askerApi.call("POST", `/${encodeURIComponent(askerFlow)}/${encodeURIComponent(askSession)}/actions/ask`, {
        userId: config?.userId,
        input: { what: "ship the farewell module" },
      });
      if (posted.status !== 202) throw new Error(`raising the ask: ${posted.status} ${JSON.stringify(posted.body)}`);
      await open(page, served.asker.origin, "/inbox");
      await page.getByTestId("inbox-item").first().waitFor({ timeout: 20_000 });
      await page.getByTestId("inbox-item").first().click();
      const line = token("reply");
      await page.getByTestId("inbox-reply-input").fill(line);
      const sent = await sendAndWatch(page, "inbox-reply", () => askerApi.holds(askSession, "user", line));
      if (sent.state !== "delivered") fail("heard", `the reply never read delivered: ${sent.state}${sent.error === null ? "" : `, "${sent.error}"`}`);
      else if (sent.heldAtDelivered !== true) fail("delivered", `the reply read delivered while the ask's session held no user item with it`);
      if (!(await askerApi.holds(askSession, "user", line))) fail("heard", `the ask's session ${askSession} holds no user item with the reply`);
      if (!(await askerApi.holds(askSession, "assistant", heardLine(line)))) fail("heard", `the seat never said "${heardLine(line)}" in the ask's session`);
      // Read back from the session, the reply sits under the ask as the person's own.
      const drawn = await page
        .locator("[data-testid=inbox-reply-line-text]", { hasText: line })
        .first()
        .waitFor({ timeout: 10_000 })
        .then(() => true, () => false);
      if (!drawn) fail("heard", `Inbox doesn't draw the reply under the ask once the session holds it`);
      evidence.push(`Inbox reply on ${asker.id}: ${sent.state}, in the ask's session, heard`);
    });

    if (pageErrors.length > 0) failures.push(`[page] reach: the page threw: ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
    for (const lab of Object.values(served)) lab.child.kill("SIGTERM");
    await Promise.all(Object.values(served).map((lab) => lab.exited));
  }
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its command over DevTeam (recording harness) and the fixture asker; each line typed in Chromium and graded against the store and the harness's own record. ${evidence.join("; ")}`,
  };
});
