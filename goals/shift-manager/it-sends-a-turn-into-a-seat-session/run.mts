/**
 * Goal check: a person's line, typed in shift-manager, reaches a worker's running
 * coding run. The run stops, and its next attempt continues the same coding
 * session with the line. See goal.md for the contract.
 *
 * Real path, no model. shift-manager is built with Vite and served by its own start
 * script over two Labs: DevTeam on this goal's recording harness
 * (`lab/fsdev.config.mts`), with two coder rows running, and a fixture Lab
 * whose one seat asks and hears (`lab/asker/`). Chromium sends a fresh token
 * three ways: the task composer, `@coder` in the workstream, and Inbox's
 * reply. What happened is read from the store, through each Lab's routes with
 * this script's own requests, and from the file the harness writes each
 * attempt to. Never from shift-manager's state.
 *
 * Legs (each failure is tagged `[<route>] <leg>`):
 *
 *   delivered    the run session the task links to holds the line as a user
 *                item, the composer showed *delivered* only once it did, and
 *                the next attempt's run link names that same session
 *   stopped      the attempt that was running reads `aborted`
 *   continued    the harness recorded a next attempt whose prompt holds the
 *                line and whose resume id is the previous attempt's session
 *   standing     the row's retry standing (attempts, less the re-entries
 *                it isn't charged for) is unchanged by the turn, read from
 *                the stored row
 *   picker       `@coder` asks which of the coder's two tasks, and the line
 *                reaches the one chosen and not the other
 *   no door      Inbox's reply to DevTeam's EM ask is disabled, naming the seat
 *   heard        Inbox's reply to the fixture seat's ask is in the ask's
 *                session, and the seat says it heard it
 *   reach        the pages throw nothing
 *
 * Controls:
 *
 *   optimistic-turn  shift-manager built with `src/lib/send.ts` swapped for
 *                    `controls/optimistic-turn.ts`: delivered without calling
 *                    the door. Must fail at "delivered".
 *   fresh-session    the harness drops the resume id it is offered. Must fail
 *                    at "continued", naming the resume id.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-sends-a-turn-into-a-seat-session/run.mts
 * Control:  GOAL_CONTROL=fresh-session … (same command)
 * Before:   GOAL_PAGES=<pages built from another commit> … serves those pages instead of building.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { channelBoard } from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { LAB_ORG_ID } from "../../devteam-lab/lab/host.mts";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { heardLine } from "./lab/asker/asker.mts";
import type { RecordedAttempt } from "./lab/recording-harness.mts";
import { ROWS, STORE_ENV } from "./lab/rows.mts";

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
const SHIFT_MANAGER = join(REPO_ROOT, "labs", "shift-manager");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("shift-manager-turn");
const RUNS_FILE = join(SCRATCH, `runs-${Date.now()}.ndjson`);
const STORE_FILE = join(SCRATCH, `devforce-${Date.now()}.db`);
const LABS = {
  devforce: { config: join(HERE, "lab", "fsdev.config.mts"), tree: join(REPO_ROOT, "goals", "devteam-lab", "lab", "workforce") },
  asker: { config: join(HERE, "lab", "asker", "fsdev.config.mts"), tree: join(HERE, "lab", "asker", "workforce") },
} as const;
type LabName = keyof typeof LABS;
/** How long a composer may take to say what became of a line. The door waits up to a minute for a run to stop. */
const SEND_MS = 90_000;
/** How long the next attempt may take to start after the line is delivered. */
const NEXT_ATTEMPT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const token = (route: string) => `${route}-${randomBytes(4).toString("hex")}`;

// ---- building shift-manager --------------------------------------------------------

async function buildAppLab(control: string): Promise<string> {
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
  const child = spawn(TSX, [join(SHIFT_MANAGER, "bin", "start.mts"), "--config", LABS[name].config, "--port", "0", "--assets", pages], {
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
    child.on("exit", () => {
      gone = true;
      resolve();
    }),
  );
  for (let waited = 0; waited < 120_000; waited += 250) {
    const match = /shift-manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) return { origin: match[1]!, child, exited, log: () => log };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`shift-manager's start script never served ${name}. Log tail:\n${log.slice(-2000)}`);
}

// ---- the store, read by this script -----------------------------------------

type Row = {
  id: string;
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
  const rows = async (channelId: string, boardRef: string): Promise<Row[]> => {
    const body = await get(`/sessions/${enc(channelId)}/resources/${enc(boardRef)}?limit=200`);
    return ((body.items ?? []) as Array<{ clientData?: Record<string, any> }>).map(({ clientData: r = {} }) => ({
      id: String(r.id),
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
type Counters = { attempts: number; abandonments: number; turnReentries: number };
/** Retry standing: the attempts the row has been charged for (BR-9). */
const standing = (c: Counters) => c.attempts - c.abandonments - c.turnReentries;

async function storedCounters(ledgerId: string, taskId: string): Promise<Counters | undefined> {
  const stores = createSQLiteStores({ filename: STORE_FILE, skipSchemaInit: true });
  try {
    const record = (await stores.resourceState.get("org", LAB_ORG_ID, `${ledgerId}/${taskId}`)) as { state?: Record<string, unknown> } | undefined;
    const state = record?.state;
    if (state === undefined) return undefined;
    return {
      attempts: Number(state.attempts ?? 0),
      abandonments: Number(state.abandonments ?? 0),
      turnReentries: Number(state.turnReentries ?? 0),
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
const attemptsOf = (issue: string) => attempts().filter((a) => a.row.startsWith(`Row ${issue},`));

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
type Where = { channelId: string; boardRef: string; ledgerId: string };

/** Read a row's state, and the harness's last attempt for it, before a turn. */
async function before(api: LabApi, where: Where, issue: string, route: string): Promise<Turn> {
  const row = (await api.rows(where.channelId, where.boardRef)).find((r) => r.id.startsWith(`${issue.toLowerCase()}--`));
  if (row === undefined || row.status !== "in_progress" || row.run === null) {
    throw new Error(`store: ${issue} is not running (${row === undefined ? "no row" : `${row.status}, ${row.run === null ? "no run" : "linked"}`})`);
  }
  const counters = await storedCounters(where.ledgerId, row.id);
  if (counters === undefined) throw new Error(`store: ${row.id} is not stored under ${where.ledgerId} in ${STORE_FILE}`);
  return {
    route,
    line: token(route),
    row,
    counters,
    issue,
    owner: await api.ownerOf(row.run.sessionId),
    previousSession: attemptsOf(issue).at(-1)?.session ?? null,
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

  // stopped
  let record = await api.requestStatus(turn.owner, run.requestId);
  for (let waited = 0; record === "in_progress" && waited < 5_000; waited += 250) {
    await sleep(250);
    record = await api.requestStatus(turn.owner, run.requestId);
  }
  if (record !== "aborted") fail("stopped", `the running attempt's request ${run.requestId} reads ${record}`);

  // continued
  let next: RecordedAttempt | undefined;
  for (const until = Date.now() + NEXT_ATTEMPT_MS; Date.now() < until && next === undefined; await sleep(250)) {
    next = attemptsOf(turn.issue).find((a) => a.prompt.includes(turn.line));
  }
  if (next === undefined) fail("continued", `the harness recorded no attempt on ${turn.issue} whose prompt holds the line`);
  else if (next.resume !== turn.previousSession) {
    fail("continued", `the next attempt resumed ${next.resume ?? "nothing"} (the resume id), wanted the previous attempt's session ${turn.previousSession}`);
  }

  // standing: once the next attempt is claimed, the stored counters say the
  // turn's re-entry wasn't charged.
  let after: Counters | undefined;
  for (const until = Date.now() + NEXT_ATTEMPT_MS; Date.now() < until; await sleep(250)) {
    after = await storedCounters(where.ledgerId, turn.row.id);
    if (after === undefined || after.attempts > turn.counters.attempts) break;
  }
  if (after === undefined) fail("standing", `the row ${turn.row.id} is no longer stored`);
  else if (after.attempts === turn.counters.attempts) fail("standing", `no next attempt was claimed (attempts still ${after.attempts})`);
  else if (standing(after) !== standing(turn.counters)) {
    fail("standing", `retry standing went ${standing(turn.counters)} → ${standing(after)} (attempts ${after.attempts}, abandonments ${after.abandonments}, turn re-entries ${after.turnReentries})`);
  }
  // delivered, read again after delivery: the next attempt's run link still
  // names the session the line was delivered into, so the task's Session view
  // keeps showing it. A run that moved to a new session drops the line from it.
  let linked: Row["run"] = null;
  for (const until = Date.now() + NEXT_ATTEMPT_MS; Date.now() < until; await sleep(250)) {
    linked = (await api.rows(where.channelId, where.boardRef)).find((r) => r.id === turn.row.id)?.run ?? null;
    if (linked !== null && linked.requestId !== run.requestId) break;
  }
  if (linked === null || linked.requestId === run.requestId) {
    fail("delivered", `after delivery, no next attempt linked on ${turn.row.id}`);
  } else if (linked.sessionId !== run.sessionId) {
    fail("delivered", `after delivery the task links session ${linked.sessionId}, not ${run.sessionId} where the line was delivered`);
  }

  evidence.push(
    `${turn.route} → ${turn.row.id}: ${sent.state}${sent.heldAtDelivered === true ? " (held when drawn)" : ""}, linked after ${linked?.sessionId === run.sessionId ? "same session" : (linked?.sessionId ?? "none")}, request ${record}, ` +
      `next attempt resume=${next?.resume ?? "none"} (previous ${turn.previousSession}), standing ${standing(turn.counters)} → ${after === undefined ? "?" : `${standing(after)} (attempts ${after.attempts}, turn re-entries ${after.turnReentries})`}`,
  );
}

// ---- the goal ----------------------------------------------------------------

await runGoal(async () => {
  const devforce = await readDeclaredRoster(LABS.devforce.tree);
  const channel = devforce.channels[0]!;
  const boardName = (channel.declared.boards as string[])[0]!;
  const where: Where = { channelId: channel.id, boardRef: `${channel.id}.${boardName}`, ledgerId: channelBoard(channel.id, boardName).id };
  const coder = devforce.workers.find((w) => w.declared.flow === "coder" && (channel.declared.members as string[]).includes(w.id) && w.id.endsWith(".coder"))!;
  const em = devforce.workers.find((w) => w.declared.flow === "em")!;
  const asker = (await readDeclaredRoster(LABS.asker.tree)).workers[0]!;

  const pages = process.env.GOAL_PAGES ?? (await buildAppLab(CONTROL));
  const failures: string[] = [];
  const evidence: string[] = [];
  const served = { devforce: await startLab("devforce", pages), asker: await startLab("asker", pages) };
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.setDefaultTimeout(10_000);

    // ---- DevTeam ------------------------------------------------------------
    await open(page, served.devforce.origin, "/tasks");
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { bearerToken?: string } | null;
    const api = labApi(served.devforce.origin, injected?.bearerToken);
    for (let waited = 0; waited < 60_000; waited += 250) {
      const running = (await api.rows(where.channelId, where.boardRef)).filter((r) => r.status === "in_progress" && r.run !== null);
      if (running.length === ROWS.length && ROWS.every((r) => attemptsOf(r.issue).length > 0)) break;
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
      const turn = await before(api, where, ROWS[0].issue, "task");
      await page.getByTestId("nav-tasks").click();
      await page.locator(`[data-testid=task-row][data-task-id="${turn.row.id}"]`).click();
      await page.locator(`[data-testid=task-frame][data-task-id="${turn.row.id}"]`).waitFor();
      const input = page.getByTestId("task-composer-input");
      await page.waitForFunction(() => !(document.querySelector("[data-testid=task-composer-input]") as HTMLTextAreaElement | null)?.disabled);
      await input.fill(turn.line);
      const sent = await sendAndWatch(page, "task-composer", () => api.holds(turn.row.run!.sessionId, "user", turn.line));
      await grade(api, where, turn, sent, fail, evidence);
    });

    // @coder in the workstream, on the second row, chosen from the picker.
    await leg("@coder", async (fail) => {
      const turn = await before(api, where, ROWS[1].issue, "at-coder");
      const other = (await api.rows(where.channelId, where.boardRef)).find((r) => r.id !== turn.row.id && r.run !== null)!;
      await page.getByTestId(`nav-workstream-${where.channelId}`).click();
      await page.locator("[role=tab][data-tab=stream]").click();
      await page.getByTestId("composer-input").fill(`@${coder.id.split(".").at(-1)} ${turn.line}`);
      const picker = page.getByTestId("composer-task-picker");
      if (!(await picker.isVisible().catch(() => false))) {
        fail("picker", "the composer asked nothing with two running tasks on the coder");
        return;
      }
      const offered = (await picker.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))).filter((v) => v !== "");
      if (!offered.includes(turn.row.id) || !offered.includes(other.id)) fail("picker", `the picker offers [${offered.join(", ")}], wanted both of the coder's running tasks`);
      await picker.selectOption(turn.row.id);
      const sent = await sendAndWatch(page, "composer", () => api.holds(turn.row.run!.sessionId, "user", turn.line));
      await grade(api, where, turn, sent, fail, evidence);
      if (await api.holds(other.run!.sessionId, "user", turn.line)) fail("picker", `the line also reached ${other.id}, which was not chosen`);
    });

    // Inbox, on DevTeam's EM ask: a seat whose kind takes no message.
    await leg("Inbox, no door", async (fail) => {
      await open(page, served.devforce.origin, "/inbox");
      await page.getByTestId("inbox-item").first().click();
      const input = page.getByTestId("inbox-reply-input");
      await input.waitFor();
      if (!(await input.isDisabled())) fail("no door", "the reply box is enabled on a seat whose kind takes no message");
      const line = (await page.getByTestId("inbox-reply-blocked").textContent().catch(() => null)) ?? "";
      if (!line.includes(em.id)) fail("no door", `the reply box doesn't say why, naming ${em.id}: "${line}"`);
      evidence.push(`Inbox on ${em.id}: reply disabled, "${line}"`);
    });

    // ---- the fixture seat ----------------------------------------------------
    await leg("Inbox reply", async (fail) => {
      await open(page, served.asker.origin, "/inbox");
      const config = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string } | null;
      const askerApi = labApi(served.asker.origin, undefined);
      const askSession = `s_turn_goal_${randomBytes(3).toString("hex")}`;
      const posted = await askerApi.call("POST", `/${encodeURIComponent(asker.id)}/${encodeURIComponent(askSession)}/actions/ask`, {
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
    evidence: `shift-manager built with Vite and served by its start script over DevTeam (recording harness) and the fixture asker; each line typed in Chromium and graded against the store and the harness's own record. ${evidence.join("; ")}`,
  };
});
