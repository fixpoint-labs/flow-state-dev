/**
 * Goal check: a person opens one task in Shift Manager, watches that task's own run
 * live, and can stop it. Every other act and value on the task screen either
 * works from a shipped read or says what arrives and who ships it.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Shift Manager is built with Vite into a scratch directory and served by its own
 * command over the run-lab's `fsdev.config.mts`, devtool included: a
 * mailbox-attached board whose rows hand off to scripted runs that narrate a
 * step a second and hold until aborted. Chromium reaches each row by clicking,
 * from Tasks or from a board card. What the page draws is graded against the
 * tree on disk and the store, read by this script through the Lab's routes and
 * through each run's own flow, never against Shift Manager's reads.
 *
 * Legs (each failure is tagged `[<row>] <leg>`):
 *
 *   store         the board holds a held run on the drainer's flow, a held run
 *                 on a flow of its own, a finished run, and a row no run has
 *                 claimed (a precondition)
 *   items equal the run session's
 *                 the Session's items equal, by id and in order, the items the
 *                 run session and its request stream hold for this task
 *   live          a new item the request stores is drawn within 2 s, no reload
 *   the request reads aborted first
 *                 after Interrupt, the view reads *interrupted* only once the
 *                 request record, read through its own flow, is `aborted`
 *   inspector     worker, start time and recorded plan and files equal the
 *                 store's; the trace link is the devtool Shift Manager serves,
 *                 opening the run's session, and following it lands there
 *   gaps          Diff, Checks, Hand off, reassign, Open PR, *also post* and
 *                 the inspector's unread values each carry a gap line naming
 *                 its owner, or saying it is not planned in the first cut; the
 *                 composer is disabled because this Lab's kinds take no message
 *   no run        the unclaimed row says no run has started and can't be stopped
 *   reach         the page throws nothing
 *
 * Controls rebuild Shift Manager with `src/lib/run.ts` swapped for a module under
 * `controls/` (a Vite `resolveId` plugin; the build fails if the swap never
 * fired):
 *
 *   worker-session        the Session reads the seat's newest other session.
 *                         Must fail at "items equal the run session's".
 *   optimistic-interrupt  Interrupt draws *interrupted* without aborting. Must
 *                         fail at "the request reads aborted first".
 *   board-flow            the run is opened through the board's flow. Must fail
 *                         at "items equal the run session's" on the row whose
 *                         run is on a flow of its own.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-and-stops-a-task-run/run.mts
 * Control:  GOAL_CONTROL=board-flow PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-and-stops-a-task-run/run.mts
 * Before:   GOAL_PAGES=<pages built from another commit> … serves those pages instead of building.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { compareItemOrder, createSSEClient } from "@flow-state-dev/client";
import { itemsForTask, type OutputItem } from "@flow-state-dev/core/items";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { SHIFT_MANAGER_COMMAND, servedAddresses } from "../../lib/shift-manager.mts";
import { launchChromium } from "../../lib/playwright.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["worker-session", "optimistic-interrupt", "board-flow"] as const;
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
const SCRATCH = goalTmpDir("shift-manager-task-run");
const CONFIG = join(HERE, "lab", "fsdev.config.mts");
const TREE = join(HERE, "lab", "workforce");
/** A gap line names who ships the missing piece, or says it isn't coming in the first cut. */
const OWNED = /\bFIX-\d+\b|not planned in the first cut/;
/** How soon a stored item must be drawn. */
const LIVE_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- the tree on disk ----------------------------------------------------------

type Tree = { mailboxId: string; boardRef: string; drainerId: string; members: string[] };

async function readTree(): Promise<Tree> {
  const roster = await readDeclaredRoster(TREE);
  if (roster.problems.length > 0) throw new Error(`the tree did not load: ${roster.problems.map((p) => p.path).join(", ")}`);
  const mailbox = roster.mailboxes.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  if (mailbox === undefined) throw new Error("the tree declares no mailbox holding a board");
  const members = (mailbox.declared.members as string[] | undefined) ?? [];
  const drainer = roster.workers.find((w) => members.includes(w.id) && w.declared.flow !== undefined && w.declared.handoff === undefined);
  if (drainer === undefined) throw new Error("the tree's mailbox has no member that drains its board");
  return { mailboxId: mailbox.id, boardRef: `${mailbox.id}.${(mailbox.declared.boards as string[])[0]}`, drainerId: drainer.id, members };
}

// ---- building Shift Manager --------------------------------------------------------

async function buildShiftManager(control: string, boardFlow: string): Promise<string> {
  const outDir = join(SCRATCH, `pages-${control === "" ? "as-written" : control}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const swap = control === "" ? undefined : { target: join(SHIFT_MANAGER, "src", "lib", "run.ts"), with: join(HERE, "controls", `${control}.ts`) };
  let swapped = 0;
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
    define: { __BOARD_FLOW__: JSON.stringify(boardFlow), __STATIC_SEATS__: "[]" },
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

// ---- serving the Lab ---------------------------------------------------------

type Running = { origin: string; devtool: string; child: ChildProcess; exited: Promise<void> };

async function startLab(pages: string): Promise<Running> {
  mkdirSync(join(SCRATCH, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(SCRATCH, "labs", "run-lab-"));
  let log = "";
  const child = spawn(TSX, [SHIFT_MANAGER_COMMAND, "--config", CONFIG, "--port", "0", "--no-open", "--assets", pages], {
    cwd: workDir,
    env: intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "" }),
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
  for (let waited = 0; waited < 90_000; waited += 250) {
    const served = servedAddresses(log);
    if (served !== undefined && served.devtool === null) {
      child.kill("SIGTERM");
      throw new Error(`Shift Manager served no devtool; build its pages with pnpm build:assets. Log tail:\n${log.slice(-2000)}`);
    }
    if (served !== undefined) return { origin: served.origin, devtool: served.devtool!, child, exited };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's command never served the run-lab. Log tail:\n${log.slice(-2000)}`);
}

// ---- the store, read by this script -----------------------------------------

type Row = {
  id: string;
  status: string;
  assignee: string | null;
  startedAt: number | null;
  run: { sessionId: string; requestId: string } | null;
};

function labApi(origin: string) {
  const get = async (path: string): Promise<any> => {
    const response = await fetch(`${origin}/api/flows${path}`);
    const text = await response.text();
    if (response.status !== 200) throw new Error(`GET ${path}: ${response.status} ${text}`);
    return text.length === 0 ? null : JSON.parse(text);
  };
  const enc = encodeURIComponent;
  const rows = async (tree: Tree): Promise<Row[]> => {
    const body = await get(`/sessions/${enc(tree.mailboxId)}/resources/${enc(tree.boardRef)}?limit=200`);
    return ((body.items ?? []) as Array<{ clientData?: Record<string, any> }>).map(({ clientData: r = {} }) => ({
      id: String(r.id),
      status: String(r.status),
      assignee: typeof r.assignee === "string" ? r.assignee : null,
      startedAt: typeof r.startedAt === "number" ? r.startedAt : null,
      run: r.run == null ? null : { sessionId: String(r.run.sessionId), requestId: String(r.run.requestId) },
    }));
  };
  /** The flow a session records as its owner. */
  const ownerOf = async (sessionId: string): Promise<string> => {
    const body = await get(`/sessions/${enc(sessionId)}`);
    return String((body.session ?? body).flowId);
  };
  const requestStatus = async (flowId: string, requestId: string): Promise<string> =>
    String((await get(`/${enc(flowId)}/requests/${enc(requestId)}/status`)).status);
  const sessionItems = async (sessionId: string): Promise<OutputItem[]> => {
    const out: OutputItem[] = [];
    for (let offset = 0, page = 0; page < 20; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/state?include_items=true&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  /** The rows a run recorded under its own request id, per recorded collection; `null` when its flow records none. */
  const recorded = async (run: NonNullable<Row["run"]>, pattern: string): Promise<string[] | null> => {
    const manifest = await get(`/sessions/${enc(run.sessionId)}/manifest`);
    const ref = (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find((r) => r.kind === "collection" && r.pattern === pattern)?.ref;
    if (ref === undefined) return null;
    const prefix = `${pattern.slice(0, -"/**".length)}/${run.requestId}/`;
    const body = await get(`/sessions/${enc(run.sessionId)}/resources/${enc(ref)}?limit=200&topicPrefix=${enc(prefix)}`);
    return ((body.items ?? []) as Array<{ topic: string }>).map((i) => i.topic.split("/").slice(2).join("/"));
  };
  return { rows, ownerOf, requestStatus, sessionItems, recorded };
}
type LabApi = ReturnType<typeof labApi>;

/**
 * Follow a request's stream through the flow that owns it: its replay, then
 * what it stores live. Finished, non-transient items only.
 */
function follow(origin: string, flowId: string, requestId: string, onItem: (item: OutputItem) => void) {
  return createSSEClient({
    baseUrl: origin,
    url: `/api/flows/${encodeURIComponent(flowId)}/requests/${encodeURIComponent(requestId)}/stream`,
    fetcher: fetch,
    onItemDone: (event) => {
      const item = event.item as OutputItem & { transient?: boolean };
      if (item.transient !== true) onItem(item);
    },
  });
}

/** What the store holds for one task: its run session's items and its request's stream, this task's only, in stored order. */
async function storedItems(origin: string, api: LabApi, tree: Tree, row: Row): Promise<string[]> {
  const run = row.run!;
  const owner = await api.ownerOf(run.sessionId);
  const streamed: OutputItem[] = [];
  const handle = follow(origin, owner, run.requestId, (item) => streamed.push(item));
  await sleep(700);
  handle.close();
  const byKey = new Map<string, OutputItem>();
  for (const item of [...(await api.sessionItems(run.sessionId)), ...streamed]) byKey.set(`${item.requestId}\u0000${item.id}`, item);
  // The attribution contract the substrate and every UI share, from core: this
  // task's items, board bookkeeping left out.
  const kept = [...byKey.values()].filter((item) => (item as { transient?: boolean }).transient !== true).sort(compareItemOrder);
  return itemsForTask(kept, tree.boardRef, row.id).map((item) => item.id);
}

// ---- the page ----------------------------------------------------------------

const drawnIds = (page: Page) =>
  page.getByTestId("session-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id") ?? "")) as Promise<string[]>;

async function visible(page: Page, testId: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Row id -> how many items its Session drew when graded, for the evidence line. */
const drawn = new Map<string, number>();

const startsWith = (whole: string[], prefix: string[]) => prefix.every((id, i) => whole[i] === id);

/** Reach a row by clicking: from Tasks while it's open, from its board card once it's done. */
async function reach(page: Page, origin: string, tree: Tree, row: Row) {
  await page.goto(`${origin}/tasks`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
  if (row.status === "completed" || row.status === "cancelled") {
    await page.getByTestId(`nav-workstream-${tree.mailboxId}`).click();
    await page.locator("[role=tab][data-tab=board]").click();
    await page.locator(`[data-testid=board-card][data-task-id="${row.id}"]`).click();
  } else {
    await page.getByTestId("tasks-table").waitFor({ timeout: 20_000 });
    // Tasks hides queued rows until Queued is on; a person looking for any open row turns it on.
    const queued = page.getByTestId("tasks-queued-toggle");
    if ((await queued.getAttribute("aria-pressed")) !== "true") await queued.click();
    await page.locator(`[data-testid=task-row][data-task-id="${row.id}"]`).click();
  }
  await page.locator(`[data-testid=task-frame][data-task-id="${row.id}"]`).waitFor({ timeout: 10_000 });
}

// ---- one row -----------------------------------------------------------------

type Ctx = { page: Page; origin: string; devtool: string; api: LabApi; tree: Tree; fail: (leg: string, why: string) => void; evidence: string[] };

async function checkItems({ page, origin, api, tree, fail }: Ctx, row: Row, running: boolean): Promise<void> {
  if (!(await visible(page, "session", 15_000))) {
    fail("items equal the run session's", `the Session never opened the run (${(await page.getByTestId("task-slot").textContent())?.slice(0, 200)})`);
    return;
  }
  // Store first, then the screen, then the store again: the screen must hold
  // everything the first read held, and nothing the second read doesn't, in order.
  const first = await storedItems(origin, api, tree, row);
  for (let waited = 0; waited < 3_000; waited += 100) {
    const shown = new Set(await drawnIds(page));
    if (first.every((id) => shown.has(id))) break;
    await sleep(100);
  }
  const shown = await drawnIds(page);
  const second = await storedItems(origin, api, tree, row);
  drawn.set(row.id, shown.length);
  if (first.length === 0) fail("items equal the run session's", "the store holds no item for this task, so there is nothing to compare");
  else if (!startsWith(shown, first) || !startsWith(second, shown)) {
    fail("items equal the run session's", `drawn [${shown.join(", ")}], stored [${second.join(", ")}]`);
  }
  if (!running) return;

  // Live: the next item the request stores is drawn within 2 s.
  const owner = await api.ownerOf(row.run!.sessionId);
  const known = new Set(await drawnIds(page));
  const next = await new Promise<OutputItem | undefined>((resolve) => {
    const timer = setTimeout(() => {
      handle.close();
      resolve(undefined);
    }, 5_000);
    const handle = follow(origin, owner, row.run!.requestId, (item) => {
      if (item.taskId !== row.id || known.has(item.id) || item.type === "component") return;
      clearTimeout(timer);
      handle.close();
      resolve(item);
    });
  });
  if (next === undefined) {
    fail("live", "the request stored no new item for this task in 5 s");
    return;
  }
  try {
    await page.locator(`[data-testid=session-item][data-item-id="${next.id}"]`).waitFor({ timeout: LIVE_MS });
  } catch {
    fail("live", `item ${next.id} was stored and not drawn within ${LIVE_MS} ms`);
  }
}

async function checkInterrupt({ page, api, fail }: Ctx, row: Row): Promise<void> {
  const owner = await api.ownerOf(row.run!.sessionId);
  const button = page.getByTestId("task-interrupt");
  try {
    await page.locator("[data-testid=task-interrupt]:not([disabled])").waitFor({ timeout: 10_000 });
  } catch {
    fail("the request reads aborted first", "Interrupt never became available on a running task");
    return;
  }
  await button.click();
  try {
    await page.locator("[data-testid=run-state][data-state=aborted]").waitFor({ timeout: 15_000 });
  } catch {
    fail("the request reads aborted first", `the view never read interrupted (${await page.getByTestId("run-state").textContent()})`);
    return;
  }
  const record = await api.requestStatus(owner, row.run!.requestId);
  if (record !== "aborted") fail("the request reads aborted first", `the view reads interrupted while the request record reads ${record}`);
  const word = await page.getByTestId("run-state").textContent();
  if (word !== "interrupted") fail("the request reads aborted first", `the view's word is "${word}"`);
}

async function checkInspector({ page, devtool, api, tree, fail }: Ctx, row: Row): Promise<void> {
  const seat = tree.members.find((m) => m.split(".").at(-1) === row.assignee);
  const shownSeat = await page.getByTestId("inspector-worker-id").getAttribute("data-seat-id");
  if (shownSeat !== seat) fail("inspector", `worker ${shownSeat}, the row is assigned ${seat}`);
  const started = await page.getByTestId("inspector-started-at").getAttribute("data-started-at");
  if (started !== String(row.startedAt ?? "")) fail("inspector", `started ${started}, stored ${row.startedAt}`);

  const plan = await api.recorded(row.run!, "observed-plan/**");
  const files = await api.recorded(row.run!, "observed-file-ops/**");
  const sectionAgrees = async (stored: string[] | null, item: string, attr: string, none: string, what: string) => {
    if (stored === null) {
      if (!(await visible(page, none, 5_000))) fail("inspector", `the run's flow records no ${what}, and the inspector doesn't say so`);
      return;
    }
    try {
      await page.getByTestId(item).first().waitFor({ timeout: 5_000 });
    } catch {
      /* compared below */
    }
    const shown = (await page.getByTestId(item).evaluateAll((els, a) => els.map((e) => e.getAttribute(a) ?? ""), attr)) as string[];
    if (JSON.stringify([...shown].sort()) !== JSON.stringify([...stored].sort())) fail("inspector", `${what}: shown [${shown.join(", ")}], recorded [${stored.join(", ")}]`);
  };
  await sectionAgrees(plan, "inspector-plan-step", "data-step-id", "inspector-plan-none", "plan");
  await sectionAgrees(files, "inspector-file", "data-path", "inspector-files-none", "file operations");

  // The link opens the run's session in the devtool (`?session=<id>`), not the
  // devtool's front page with the id left to paste.
  const href = await page.getByTestId("inspector-trace-link").getAttribute("href").catch(() => null);
  const wanted = `${devtool}?session=${encodeURIComponent(row.run!.sessionId)}`;
  if (href !== wanted) fail("inspector", `the trace link is ${href}, wanted ${wanted} (the devtool Shift Manager serves, plus the run's session)`);
  const traced = await page.getByTestId("inspector-trace-session").textContent().catch(() => null);
  if (traced !== row.run!.sessionId) fail("inspector", `the trace names session ${traced}, the run's is ${row.run!.sessionId}`);

  // Following the link lands on the run: the devtool opens the run's session,
  // which it can only do reading the store the run is in.
  if (href !== wanted) return;
  const [opened] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 10_000 }),
    page.getByTestId("inspector-trace-link").click(),
  ]);
  try {
    const badge = opened.locator(`button[title^="Session ID: ${row.run!.sessionId}"]`);
    const refused = opened.getByTestId("session-address-error");
    const landed = await Promise.race([
      badge.waitFor({ timeout: 15_000 }).then(() => "opened" as const),
      refused.waitFor({ timeout: 15_000 }).then(async () => `refused: ${await refused.textContent()}`),
    ]).catch(() => "nothing within 15 s");
    if (landed !== "opened") fail("inspector", `following Open trace did not open session ${row.run!.sessionId} in the devtool (${landed})`);
  } finally {
    await opened.close();
  }
}

async function checkGaps({ page, fail }: Ctx): Promise<void> {
  const owned = async (testId: string, disabled: boolean) => {
    const els = page.getByTestId(testId);
    const count = await els.count();
    if (count === 0) return fail("gaps", `${testId} is not on the screen`);
    for (let i = 0; i < count; i += 1) {
      const el = els.nth(i);
      const text = `${(await el.getAttribute("data-gap")) ?? ""} ${(await el.textContent()) ?? ""}`;
      if (!OWNED.test(text)) fail("gaps", `${testId} carries no owner: "${text.trim()}"`);
      if (disabled && !(await el.isDisabled())) fail("gaps", `${testId} is enabled`);
    }
  };
  await owned("task-disabled-action", true);
  if ((await page.getByTestId("task-disabled-action").count()) !== 3) fail("gaps", "Hand off, reassign and Open PR are not all there");
  // No kind in this Lab declares a door, so the composer says the worker takes no message.
  if (!(await page.getByTestId("task-composer-input").isDisabled())) fail("gaps", "the composer is enabled");
  const blocked = (await page.getByTestId("task-composer-blocked").textContent().catch(() => null)) ?? "";
  if (!blocked.includes("takes no message.")) fail("gaps", `the composer doesn't say the worker takes no message: "${blocked}"`);
  await owned("task-also-post", true);
  await owned("inspector-harness-gap", false);
  await owned("inspector-acceptance-gap", false);
  await owned("inspector-review-gap", false);
  for (const [tab, testId] of [
    ["diff", "task-diff-empty"],
    ["checks", "task-checks-empty"],
  ] as const) {
    await page.locator(`[role=tab][data-tab=${tab}]`).click();
    if (!(await visible(page, testId, 5_000))) fail("gaps", `the ${tab} tab shows no empty state`);
    else await owned(testId, false);
  }
  await page.locator("[role=tab][data-tab=brief]").click();
  await owned("brief-acceptance-gap", false);
  await owned("brief-fields-gap", false);
  await page.locator("[role=tab][data-tab=session]").click();
}

// ---- the goal ----------------------------------------------------------------

await runGoal(async () => {
  const tree = await readTree();
  // GOAL_PAGES serves pages built elsewhere, e.g. from the commit before this
  // screen existed, to record the before-state.
  const pages = process.env.GOAL_PAGES ?? (await buildShiftManager(CONTROL, tree.drainerId));
  const failures: string[] = [];
  const evidence: string[] = [];
  const served = await startLab(pages);
  const browser = await launchChromium();
  try {
    const api = labApi(served.origin);
    // The held runs are linked once the drain has handed them off.
    let rows: Row[] = [];
    for (let waited = 0; waited < 30_000; waited += 250) {
      rows = await api.rows(tree);
      if (rows.filter((r) => r.status === "in_progress" && r.run !== null).length >= 2 && rows.some((r) => r.status === "completed")) break;
      await sleep(250);
    }
    const owners = new Map<string, string>();
    for (const row of rows) if (row.run !== null) owners.set(row.id, await api.ownerOf(row.run.sessionId));
    const held = rows.filter((r) => r.status === "in_progress" && r.run !== null);
    const onDrainer = held.find((r) => owners.get(r.id) === tree.drainerId);
    const ownFlow = held.find((r) => owners.get(r.id) !== tree.drainerId);
    const finished = rows.find((r) => r.status === "completed" && r.run !== null);
    const unclaimed = rows.find((r) => r.run === null && r.status !== "in_progress");
    if (onDrainer === undefined || ownFlow === undefined || finished === undefined || unclaimed === undefined) {
      throw new Error(`store: the board does not hold the rows the goal reads: ${rows.map((r) => `${r.id} ${r.status} ${r.run === null ? "no run" : owners.get(r.id)}`).join("; ")}`);
    }

    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const cases: Array<{ name: string; row: Row; running: boolean }> = [
      { name: `held on ${tree.drainerId}`, row: onDrainer, running: true },
      { name: `held on ${owners.get(ownFlow.id)}`, row: ownFlow, running: true },
      { name: "finished", row: finished, running: false },
    ];
    // Anything the screen doesn't draw is a failure of the leg that looked for
    // it, not a crash that hides the legs after it.
    page.setDefaultTimeout(5_000);
    const leg = async (fail: Ctx["fail"], name: string, check: () => Promise<void>) => {
      try {
        await check();
      } catch (error) {
        fail(name, `the screen doesn't draw it: ${String((error as Error).message ?? error).split("\n")[0]}`);
      }
    };
    for (const { name, row, running } of cases) {
      const fail = (leg: string, why: string) => failures.push(`[${name}] ${leg}: ${why}`);
      const ctx: Ctx = { page, origin: served.origin, devtool: served.devtool, api, tree, fail, evidence };
      await reach(page, served.origin, tree, row);
      await leg(fail, "items equal the run session's", () => checkItems(ctx, row, running));
      await leg(fail, "inspector", () => checkInspector(ctx, row));
      await leg(fail, "gaps", () => checkGaps(ctx));
      if (running) await leg(fail, "the request reads aborted first", () => checkInterrupt(ctx, row));
      evidence.push(`${name}: ${drawn.get(row.id) ?? 0} items drawn = stored, run-state ${await page.getByTestId("run-state").getAttribute("data-state").catch(() => "none")}`);
    }
    // After the interrupts, each link still names the stopped run: Shift Manager wrote nothing to a row.
    const after = await api.rows(tree);
    for (const { name, row } of cases) {
      const now = after.find((r) => r.id === row.id);
      if (JSON.stringify(now?.run) !== JSON.stringify(row.run)) failures.push(`[${name}] reach: the row's run link changed to ${JSON.stringify(now?.run)}`);
    }

    // The row no run has claimed.
    await reach(page, served.origin, tree, unclaimed);
    const unclaimedFail = (name: string, why: string) => failures.push(`[unclaimed] ${name}: ${why}`);
    await leg(unclaimedFail, "no run", async () => {
      if (!(await visible(page, "session-no-run", 5_000))) unclaimedFail("no run", "the Session doesn't say no run has started");
      if (!(await page.getByTestId("task-interrupt").isDisabled())) unclaimedFail("no run", "Interrupt is enabled with nothing running");
    });

    if (pageErrors.length > 0) failures.push(`[page] reach: the page threw: ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
    served.child.kill("SIGTERM");
    await served.exited;
  }
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its command over the run-lab; each row reached by clicking in Chromium and graded against the store, read through each run's own flow. ${evidence.join("; ")}`,
  };
});
