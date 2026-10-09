/**
 * Goal check: a person opens Roster in Shift Manager and sees every worker the
 * Lab has, each on shift, on call or off shift as the Lab's own records say,
 * with the tasks it holds and what it waits on, for all teams and for each.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Shift Manager is built with Vite into a scratch directory, then served by its
 * own command over the shift-lab (`lab/`), once per spread in the fixture:
 * which worker holds a running row, a parked row, a queued row, or a pending
 * ask. Chromium clicks Roster, then each team. What the page draws is graded
 * against the Lab's store, read through the Lab's HTTP routes by this script,
 * with this script's own status rule and its own seat matching (a row's
 * assignee equals the seat's id or its name). Shift Manager's modules are never
 * imported.
 *
 * Legs (each failure is tagged `[spread <n>] <leg>`):
 *
 *   store     the store holds what the spread built, and holds still (a precondition)
 *   roster    Roster lists exactly the inventory's seats, or exactly a team's
 *   status    each worker's group equals the store's
 *   slots     each worker's slots equal its held rows
 *   holding   each worker's HOLDING chips are exactly its held rows
 *   waits     each worker's waits-on entries are exactly its parked rows and asks
 *   summary   the counts at the top equal the store's, for the workers shown
 *   sidebar   the Roster entry's and the footer's counts equal the store's
 *   TEAMS     one row per team, Staff first, a square per seat with its status
 *   filter    a TEAMS row opens Roster for exactly that team
 *
 * Controls rebuild Shift Manager with `src/lib/derive.ts` swapped for a module
 * under `controls/` (a Vite `resolveId` plugin; the build fails if the swap
 * never fired):
 *
 *   ignore-asks   status reads board rows only. Must fail at "status" on the
 *                 worker whose only wait is an ask.
 *   count-queued  queued rows count as slots. Must fail at "slots" on the
 *                 worker with a queued row.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=<pool> pnpm tsx goals/shift-manager/it-shows-who-is-on-shift/run.mts
 * Control:  GOAL_CONTROL=ignore-asks pnpm tsx goals/shift-manager/it-shows-who-is-on-shift/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, loadFixture, runGoal } from "../../lib/index.mts";
import { SHIFT_MANAGER_COMMAND, pendingSeatAsks, servedAddresses } from "../../lib/shift-manager.mts";
import { launchChromium } from "../../lib/playwright.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["ignore-asks", "count-queued"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

type ShiftState = "held" | "parked" | "queued" | "ask";
const fixture = loadFixture<{ spreads: Array<Record<string, ShiftState[]>> }>(import.meta.url);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "packages", "shift-manager");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("shift-manager-roster");
const CONFIG = join(HERE, "lab", "fsdev.config.mts");

/** The group a seat with no team sits in, as the design names it. */
const STAFF = "Staff";
const STATUSES = ["on shift", "on call", "off shift"] as const;
type Status = (typeof STATUSES)[number];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diff = (want: Iterable<string>, got: Iterable<string>) => {
  const w = new Set(want);
  const g = new Set(got);
  return `missing [${[...w].filter((x) => !g.has(x)).join(", ")}], extra [${[...g].filter((x) => !w.has(x)).join(", ")}]`;
};

// ---- building Shift Manager ----------------------------------------------------

/** Build Shift Manager's pages into a scratch directory, with the control's swap if one is set. */
async function buildShiftManager(control: string): Promise<string> {
  const outDir = join(SCRATCH, `pages-${control === "" ? "as-written" : control}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const swap = control === "" ? undefined : { target: join(SHIFT_MANAGER, "src", "lib", "derive.ts"), with: join(HERE, "controls", `${control}.ts`) };
  let swapped = 0;
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
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

type Running = { origin: string; child: ChildProcess; exited: Promise<void> };

/** Shift Manager's command over the shift-lab, booted under `spread`. */
async function startLab(pages: string, spread: Record<string, ShiftState[]>): Promise<Running> {
  mkdirSync(join(SCRATCH, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(SCRATCH, "labs", "shift-lab-"));
  let log = "";
  const child = spawn(TSX, [SHIFT_MANAGER_COMMAND, "--config", CONFIG, "--port", "0", "--no-open", "--assets", pages], {
    cwd: workDir,
    env: intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "", SHIFT_LAB_SPREAD: JSON.stringify(spread) }),
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
    if (served !== undefined) return { origin: served.origin, child, exited };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's command never served the shift-lab. Log tail:\n${log.slice(-2000)}`);
}

// ---- the store, read by this script ------------------------------------------

function labApi(origin: string) {
  const get = async (path: string): Promise<any> => {
    const response = await fetch(`${origin}/api/flows${path}`);
    const text = await response.text();
    if (response.status !== 200) throw new Error(`GET ${path}: ${response.status} ${text.slice(0, 200)}`);
    return JSON.parse(text);
  };
  const collection = async (sessionId: string, ref: string): Promise<Array<Record<string, any>>> => {
    const rows: Array<Record<string, any>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const body = await get(
        `/sessions/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      rows.push(...((body.items ?? []) as Array<{ clientData?: Record<string, any> }>).map((i) => i.clientData ?? {}));
      if (body.nextCursor == null || body.nextCursor === cursor) break;
      cursor = body.nextCursor;
    }
    return rows;
  };
  const items = async (sessionId: string, types: string[]): Promise<Array<Record<string, any>>> => {
    const out: Array<Record<string, any>> = [];
    for (let offset = 0, page = 0; page < 100; page += 1) {
      const body = await get(`/sessions/${encodeURIComponent(sessionId)}/state?include_items=true&item_types=${types.join(",")}&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  return { get, collection, items };
}
type LabApi = ReturnType<typeof labApi>;

/** One worker, as the store says. */
type Worker = {
  id: string;
  team: string;
  status: Status;
  /** `<boardRef>/<taskId>` of each row it holds that is running or parked. */
  held: string[];
  /** Task ids of its parked rows, and suspension ids of its pending asks. */
  waits: string[];
  /** How many of its rows are queued (pending or blocked). */
  queued: number;
};
type Store = { workers: Worker[]; teams: string[]; asks: number; signature: string };

/** The seat this script's own rule gives an assignee: its id, or its name after the team. Exactly one, or none. */
function seatOf(seats: string[], assignee: string): string | undefined {
  const found = seats.filter((id) => id === assignee || id.slice(id.indexOf(".") + 1) === assignee);
  return found.length === 1 ? found[0] : undefined;
}

async function readStore(api: LabApi, userId: string): Promise<Store & { unmatched: string[] }> {
  const sessions = ((await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&limit=500`)).sessions ?? []) as Array<Record<string, any>>;
  // The inventory, through a mailbox's session, by its published key patterns.
  const mailboxIds: string[] = [];
  let seatRows: Array<{ id: string; kind: string | null }> = [];
  for (const host of sessions.filter((s) => s.flowKind === "mailbox" && String(s.id).includes("."))) {
    const manifest = await api.get(`/sessions/${encodeURIComponent(host.id)}/manifest`);
    const refOf = (pattern: string) => (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find((r) => r.kind === "collection" && r.pattern === pattern)?.ref;
    const seatsRef = refOf("inventory/seats/*");
    const mailboxesRef = refOf("inventory/mailboxes/*");
    if (seatsRef === undefined || mailboxesRef === undefined) continue;
    seatRows = (await api.collection(host.id, seatsRef)).map((r) => ({ id: String(r.id), kind: r.kind == null ? null : String(r.kind) }));
    mailboxIds.push(...(await api.collection(host.id, mailboxesRef)).map((r) => String(r.id)));
    break;
  }
  // Every row on every board a mailbox's manifest lists for it.
  const rows: Array<{ key: string; id: string; status: string; assignee: string }> = [];
  for (const mailboxId of mailboxIds) {
    const manifest = await api.get(`/sessions/${encodeURIComponent(mailboxId)}/manifest`);
    const refs = (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>)
      .filter((r) => r.kind === "collection" && r.ref.startsWith(`${mailboxId}.`) && r.pattern === `${r.ref}/**`)
      .map((r) => r.ref);
    for (const ref of refs) {
      for (const row of await api.collection(mailboxId, ref)) {
        rows.push({ key: `${ref}/${row.id}`, id: String(row.id), status: String(row.status), assignee: String(row.assignee ?? "") });
      }
    }
  }
  const seats = seatRows.map((s) => s.id);
  // Pending person-asks on the seats' sessions, by the seat each session names.
  const asks = (await pendingSeatAsks(api, sessions, seatRows)).map((a) => ({ seat: a.seatId, id: a.suspensionId }));
  const unmatched = rows.filter((r) => seatOf(seats, r.assignee) === undefined).map((r) => `${r.key} (${r.assignee})`);
  const workers = seats.map((id): Worker => {
    const mine = rows.filter((r) => seatOf(seats, r.assignee) === id);
    const word = (s: string) => (s === "awaiting_review" ? "parked" : s);
    const running = mine.filter((r) => word(r.status) === "in_progress");
    const parked = mine.filter((r) => word(r.status) === "parked");
    const myAsks = asks.filter((a) => a.seat === id);
    return {
      id,
      team: id.includes(".") ? id.slice(0, id.indexOf(".")) : STAFF,
      status: running.length > 0 ? "on shift" : parked.length > 0 || myAsks.length > 0 ? "on call" : "off shift",
      held: [...running, ...parked].map((r) => r.key),
      waits: [...parked.map((r) => r.id), ...myAsks.map((a) => a.id)],
      queued: mine.filter((r) => r.status === "pending" || r.status === "blocked").length,
    };
  });
  const teams = [...new Set(workers.map((w) => w.team))];
  return {
    workers,
    teams: [...teams.filter((t) => t === STAFF), ...teams.filter((t) => t !== STAFF)],
    asks: asks.length,
    signature: JSON.stringify([rows.map((r) => [r.key, r.status, r.assignee]).sort(), asks.map((a) => a.id).sort(), [...seats].sort()]),
    unmatched,
  };
}

const counts = (workers: Worker[]) => ({
  onShift: workers.filter((w) => w.status === "on shift").length,
  onCall: workers.filter((w) => w.status === "on call").length,
  offShift: workers.filter((w) => w.status === "off shift").length,
  waiting: workers.reduce((n, w) => n + w.waits.length, 0),
});

// ---- the page ----------------------------------------------------------------

async function open(page: Page, origin: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"));
}

/** Grade the Roster page as it stands, for `team` (null: All). */
async function gradeRoster(page: Page, store: Store, team: string | null, fail: (leg: string, why: string) => void) {
  const where = team === null ? "All" : `team ${team}`;
  await page.locator(`[data-testid=roster][data-team="${team ?? ""}"]`).waitFor({ timeout: 10_000 });
  const want = store.workers.filter((w) => team === null || w.team === team);
  const rows = page.getByTestId("roster-worker");
  const shown = (await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-seat-id") ?? ""))) as string[];
  if (!same(shown, want.map((w) => w.id))) fail("roster", `${where}: ${diff(want.map((w) => w.id), shown)}`);

  for (const worker of want) {
    const row = page.locator(`[data-testid=roster-worker][data-seat-id="${worker.id}"]`);
    if ((await row.count()) !== 1) continue;
    const status = await row.getAttribute("data-status");
    const group = await page.locator(`[data-testid=roster-group]:has([data-testid=roster-worker][data-seat-id="${worker.id}"])`).getAttribute("data-status");
    if (status !== worker.status || group !== worker.status) {
      fail("status", `${where}: ${worker.id} is drawn under "${group}" (row says "${status}"), the store says "${worker.status}"`);
    }
    const slots = await row.getByTestId("roster-slots").textContent();
    const squares = await row.getByTestId("roster-slot").count();
    if (slots !== `${worker.held.length} in use` || squares !== worker.held.length) {
      fail("slots", `${where}: ${worker.id} shows "${slots}" and ${squares} square(s); it holds ${worker.held.length} row(s)${worker.queued > 0 ? ` (and ${worker.queued} queued)` : ""}`);
    }
    const chips = (await row.getByTestId("roster-holding").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`))) as string[];
    if (!same(chips, worker.held)) fail("holding", `${where}: ${worker.id}: ${diff(worker.held, chips)}`);
    if (worker.held.length === 0 && (await row.getByTestId("roster-nothing").count()) !== 1) fail("holding", `${where}: ${worker.id} holds nothing and doesn't say so`);
    const waits = (await row.getByTestId("roster-wait").evaluateAll((els) => els.map((e) => e.getAttribute("data-id") ?? ""))) as string[];
    if (!same(waits, worker.waits)) fail("waits", `${where}: ${worker.id}: ${diff(worker.waits, waits)}`);
  }

  const c = counts(want);
  const summary = (await page.getByTestId("roster-summary").textContent()) ?? "";
  const wantSummary = `${c.onShift} on shift · ${c.onCall} on call · ${c.offShift} off shift · ${c.waiting} waiting on you`;
  if (summary !== wantSummary) fail("summary", `${where}: "${summary}", the store gives "${wantSummary}"`);
  if (team !== null) {
    const title = (await page.getByTestId("roster-title").textContent()) ?? "";
    if (!title.endsWith(team)) fail("filter", `${where}: the title "${title}" doesn't name the team`);
  }
}

// ---- one spread --------------------------------------------------------------

async function checkSpread(n: number, spread: Record<string, ShiftState[]>, pages: string, failures: string[], evidence: string[]) {
  const fail = (leg: string, why: string) => failures.push(`[spread ${n}] ${leg}: ${why}`);
  const served = await startLab(pages, spread);
  // Launched inside the cleanup scope: a browser that fails to start must not leave the Lab running.
  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(served.origin);
    const userId = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__?.userId ?? null)) as string | null;
    if (userId === null) throw new Error("the page was handed no userId");
    const api = labApi(served.origin);

    // ---- store: what the spread built, settled ------------------------------
    const built = (state: ShiftState) => Object.values(spread).flat().filter((s) => s === state).length;
    const settled = (s: Store) => s.workers.reduce((k, w) => k + w.held.length, 0) === built("held") + built("parked") && s.asks === built("ask");
    let store = await readStore(api, userId);
    for (let waited = 0; waited < 30_000 && !settled(store); waited += 250) {
      await sleep(250);
      store = await readStore(api, userId);
    }
    const heldStored = store.workers.reduce((k, w) => k + w.held.length, 0);
    const queuedStored = store.workers.reduce((k, w) => k + w.queued, 0);
    if (heldStored !== built("held") + built("parked")) fail("store", `${heldStored} running or parked row(s), the spread built ${built("held") + built("parked")}`);
    if (queuedStored !== built("queued")) fail("store", `${queuedStored} queued row(s), the spread built ${built("queued")}`);
    if (store.asks !== built("ask")) fail("store", `${store.asks} pending ask(s), the spread built ${built("ask")}`);
    if (store.unmatched.length > 0) fail("store", `rows whose assignee names no single seat: ${store.unmatched.join(", ")}`);
    if (!store.teams.includes(STAFF) || store.teams.length < 3) fail("store", `the inventory's groups are [${store.teams.join(", ")}]; the check needs Staff and two teams`);
    for (const status of STATUSES) if (!store.workers.some((w) => w.status === status)) fail("store", `no worker is ${status}, so that group goes ungraded`);

    // ---- sidebar ---------------------------------------------------------------
    await open(page, served.origin, "/inbox");
    const all = counts(store.workers);
    const navCount = await page.getByTestId("nav-roster-count").textContent();
    if (navCount !== `${all.onShift}·${all.onCall}`) fail("sidebar", `the Roster entry says "${navCount}", the store gives ${all.onShift} on shift · ${all.onCall} on call`);
    const footer = [await page.getByTestId("footer-on-shift").textContent(), await page.getByTestId("footer-on-call").textContent()];
    if (footer[0] !== `${all.onShift} on shift` || footer[1] !== `${all.onCall} on call`) fail("sidebar", `the footer says "${footer.join(" · ")}"`);

    const teamRows = (await page.getByTestId("team").evaluateAll((els) => els.map((e) => e.getAttribute("data-team") ?? ""))) as string[];
    if (JSON.stringify(teamRows) !== JSON.stringify(store.teams)) fail("TEAMS", `rows [${teamRows.join(", ")}], the store's groups are [${store.teams.join(", ")}]`);
    for (const team of store.teams) {
      const members = store.workers.filter((w) => w.team === team);
      const squares = (await page
        .locator(`[data-testid=team][data-team="${team}"] [data-testid=worker]`)
        .evaluateAll((els) => els.map((e) => `${e.getAttribute("data-seat-id")}=${e.getAttribute("data-status")}`))) as string[];
      const wantSquares = members.map((w) => `${w.id}=${w.status}`);
      if (!same(squares, wantSquares)) fail("TEAMS", `${team}: ${diff(wantSquares, squares)}`);
      const meta = await page.locator(`[data-testid=team][data-team="${team}"] [data-testid=team-on-shift]`).textContent();
      const wantMeta = `${members.filter((w) => w.status === "on shift").length}/${members.length}`;
      if (meta !== wantMeta) fail("TEAMS", `${team} says "${meta}", the store gives ${wantMeta}`);
    }

    // ---- Roster: All, then each team by the picker ------------------------------
    await page.getByTestId("nav-roster").click();
    await gradeRoster(page, store, null, fail);
    for (const team of store.teams) {
      await page.locator(`[data-testid=roster-team-option][data-team="${team}"]`).click();
      await gradeRoster(page, store, team, fail);
    }

    // ---- filter: each TEAMS row opens Roster for that team ----------------------
    for (const team of store.teams) {
      await page.locator(`[data-testid=team][data-team="${team}"]`).click();
      await gradeRoster(page, store, team, fail);
      if ((await page.locator(`[data-testid=team][data-team="${team}"]`).getAttribute("aria-current")) !== "page") {
        fail("filter", `the ${team} row isn't marked current on its Roster`);
      }
    }

    // The store must not have moved under the screen.
    const after = await readStore(api, userId);
    if (after.signature !== store.signature) fail("store", "the store changed while the page was graded, so the grade is not of one state");
    if (pageErrors.length > 0) fail("roster", `the page threw: ${pageErrors.join(" | ")}`);
    evidence.push(
      `spread ${n}: ${store.workers.length} workers in [${store.teams.join(", ")}]; ${store.workers
        .map((w) => `${w.id} ${w.status} ${w.held.length} held ${w.waits.length} waits${w.queued > 0 ? ` ${w.queued} queued` : ""}`)
        .join("; ")}`,
    );
  } finally {
    await browser?.close();
    served.child.kill("SIGTERM");
    await served.exited;
  }
}

await runGoal(async () => {
  const pages = await buildShiftManager(CONTROL);
  const failures: string[] = [];
  const evidence: string[] = [];
  for (const [i, spread] of fixture.spreads.entries()) await checkSpread(i + 1, spread, pages, failures, evidence);
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its command over the shift-lab under ${fixture.spreads.length} spreads; Roster, each team and the sidebar graded in Chromium against the store read through the Lab's routes. ${evidence.join(" | ")}`,
  };
});
