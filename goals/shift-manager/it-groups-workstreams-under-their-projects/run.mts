/**
 * Goal check: Shift Manager groups a Lab's workstreams under its projects, each
 * project's four tabs show that project's work, and its Stream is one room
 * its members share and nobody else reads.
 *
 * Real path, out of CI. The screens and room legs need no model; the cos leg
 * runs the chief of staff on a real one. See goal.md for the contract.
 *
 * Built like `it-opens-a-lab`: Shift Manager is built with Vite into a scratch
 * directory and served by its own start script over the DevTeam profile,
 * whose config creates two default projects at boot. Three legs, graded
 * against the tree on disk and the Lab's store read through its HTTP routes:
 *
 *   screens  Chromium, as the projects' owner. PROJECTS equals the rows, then
 *            No project; the cross-team project groups both teams'
 *            workstreams; every project's four tabs show its row, a line
 *            posted from its Stream is in the room, and no gap copy is reached.
 *   room     HTTP, as the owner, the profile's members and an outsider. The
 *            inventory equals the tree's channels; a burst of first joins from
 *            every member at once leaves one talk session per member; two
 *            members read each other's lines by cursor and both see the seat's
 *            answer; an outsider is refused, even from a session it made naming
 *            the project; and a burst of posts from both members lands whole.
 *   restart  the Lab stopped and started on the same store: every project row,
 *            with its talk links, is as it was, and each room reads back
 *            through the same talk session with every line once.
 *   cos      HTTP, as the member, on a real model. Asked for two projects, the
 *            chief of staff creates two rows, each owned by the person who
 *            asked, with them (and whoever they named) as members and their
 *            talk session bound. Runs last, after the restart: its rows are the
 *            member's, and the other legs grade every row as the owner's.
 *
 * Every run, the plain one and each control, serves the Lab with its checked
 * store writes held up to WRITE_LATENCY_MS (`devforce-lab/lab/write-latency.mts`)
 * and releases each burst from a barrier, so the bursts really race.
 *
 * Legs: `GOAL_LEG=model-free` runs screens, room and restart, `GOAL_LEG=cos`
 * runs cos; unset runs all four.
 *
 * Controls (each must fail; the run fails if a swap never fired):
 *
 *   unread    the page's grouping ignores the rows (Vite swap of derive.ts).
 *             Must fail at "PROJECTS equals the store's rows".
 *   gap-tabs  the project level as it was before projects (Vite swap of
 *             Project.tsx). Must fail at "a project's four tabs".
 *   no-gate   the room's membership check removed (Node swap of
 *             membership-gate.ts in the served Lab). Must fail at "the
 *             outsider is refused".
 *   no-retry  the room's own retry removed (Node swap of cas-retry.ts). Must
 *             fail at "a burst of posts lands whole" and "a burst of joins
 *             leaves one session per member".
 *   in-memory the profile's store kept in memory (Node swap of store-sqlite's
 *             index.ts). Must fail at "a restart keeps the projects and their
 *             rooms".
 *   no-tool   the chief of staff without its project tools, as before it had
 *             them (Node swap of the lab's host.mts). Must fail at "cos".
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-groups-workstreams-under-their-projects/run.mts
 * Control:  GOAL_CONTROL=no-gate <the same>
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, intentFreeEnv, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { LAB_CROWD, LAB_USERS } from "../../devforce-lab/lab/host.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["unread", "gap-tabs", "no-gate", "no-retry", "in-memory", "no-tool"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
const LEG = process.env.GOAL_LEG ?? "";
if (!["", "model-free", "cos"].includes(LEG)) {
  console.error(`unknown GOAL_LEG "${LEG}"; known: model-free, cos`);
  process.exit(2);
}
const MODEL_FREE = LEG !== "cos";
const COS_LEG = LEG !== "model-free";
if (CONTROL === "no-tool" && !COS_LEG) {
  console.error("control no-tool grades the cos leg, which GOAL_LEG=model-free leaves out");
  process.exit(2);
}

const fixture = loadFixture<{
  composerLine: string;
  ownerLine: string;
  memberLine: string;
  outsiderLine: string;
  burst: { windows: number; perWindow: number; body: string };
  joins: number;
  cos: { ask: string; titles: [string, string] };
}>(import.meta.url);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "labs", "shift-manager");
const PROJECTS_SRC = join(REPO_ROOT, "packages", "workforce", "src", "projects");
const SQLITE_SRC = join(REPO_ROOT, "packages", "store-sqlite", "src", "index.ts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("shift-manager-projects");
const CONFIG = join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts");
const TREE = join(REPO_ROOT, "goals", "devforce-lab", "lab", "workforce");
const LAB_HOST = join(REPO_ROOT, "goals", "devforce-lab", "lab", "host.mts");
const SEAT_ANSWERS = "eng.em";
/** The most a checked store write is held before it lands. */
const WRITE_LATENCY_MS = 30;
/** The seat Shift Manager finds the chief of staff by. */
const COS = "chief-of-staff";
/** How long one turn of the chief of staff may take: a real model answers it. */
const COS_TURN_MS = 180_000;
const MODEL_KEYS = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diff = (want: Iterable<string>, got: Iterable<string>) => {
  const w = new Set(want);
  const g = new Set(got);
  return `missing [${[...w].filter((x) => !g.has(x)).join(", ")}], extra [${[...g].filter((x) => !w.has(x)).join(", ")}]`;
};
const teamOf = (channelId: string) => channelId.split(".")[0]!;

// ---- the controls' swaps -----------------------------------------------------

/** The page control's module swap: which Shift Manager source, for which module under `controls/`. */
function pageSwapFor(control: string): { target: string; with: string } | undefined {
  if (control === "unread") return { target: join(SHIFT_MANAGER, "src", "lib", "derive.ts"), with: join(HERE, "controls", "unread.ts") };
  if (control === "gap-tabs") {
    return { target: join(SHIFT_MANAGER, "src", "surfaces", "Project.tsx"), with: join(HERE, "controls", "gap-tabs.tsx") };
  }
  return undefined;
}

/** The server control's module swap, made in the Lab process by `controls/swap-hook.mjs`. */
function serverSwapFor(control: string): { target: string; with: string } | undefined {
  if (control === "no-gate") return { target: join(PROJECTS_SRC, "membership-gate.ts"), with: join(HERE, "controls", "no-gate.ts") };
  if (control === "no-retry") return { target: join(PROJECTS_SRC, "cas-retry.ts"), with: join(HERE, "controls", "no-retry.ts") };
  if (control === "no-tool") return { target: LAB_HOST, with: join(HERE, "controls", "no-tool.mts") };
  if (control === "in-memory") return { target: SQLITE_SRC, with: join(HERE, "controls", "in-memory.ts") };
  return undefined;
}

/** Build Shift Manager's pages into a scratch directory, with the page control's swap if one is set. */
async function buildShiftManager(control: string): Promise<string> {
  const swap = pageSwapFor(control);
  const outDir = join(SCRATCH, `pages-${swap === undefined ? "as-written" : control}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  let swapped = 0;
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "error",
    build: { outDir, emptyOutDir: true },
    plugins:
      swap === undefined
        ? []
        : [
            {
              name: "goal-control-swap",
              enforce: "pre",
              async resolveId(this: any, source: string, importer: string | undefined, options: Record<string, unknown>) {
                if (importer === undefined) return null;
                // The control resolves packages (React, its JSX runtime) as the module it replaces would.
                if (importer === swap.with) {
                  return source.startsWith(".") ? null : this.resolve(source, swap.target, { ...options, skipSelf: true });
                }
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

type Running = { origin: string; child: ChildProcess; log: () => string; exited: Promise<void> };

/**
 * Shift Manager's start script over the DevTeam profile, on the store file at
 * `store`, with the server control's swap if one is set.
 */
async function startLab(pages: string, fired: string | undefined, store: string): Promise<Running> {
  mkdirSync(join(SCRATCH, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(SCRATCH, "labs", "devteam-"));
  const swap = serverSwapFor(CONTROL);
  const swapEnv: Record<string, string> =
    swap === undefined || fired === undefined
      ? {}
      : {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(join(HERE, "controls", "swap-hook.mjs")).href}`.trim(),
          GOAL_SWAP_TARGET: swap.target,
          GOAL_SWAP_WITH: swap.with,
          GOAL_SWAP_FIRED: fired,
        };
  let log = "";
  const child = spawn(TSX, [join(SHIFT_MANAGER, "bin", "start.mts"), "--config", CONFIG, "--port", "0", "--assets", pages], {
    cwd: workDir,
    // A fresh store per run, for a profile whose store outlives the process;
    // the restart opens the same one. Every run, the plain one and each control, holds the store's checked writes
    // (`write-latency.mts`), so the bursts really race and a PASS means the room absorbed it.
    env: intentFreeEnv(process.env, {
      INIT_CWD: workDir,
      GOAL_CONTROL: "",
      DEVTEAM_STORE: store,
      DEVFORCE_LAB_WRITE_LATENCY_MS: String(WRITE_LATENCY_MS),
      ...swapEnv,
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
  for (let waited = 0; waited < 90_000; waited += 250) {
    const match = /Shift Manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) {
      if (!log.includes(`holding checked store writes up to ${WRITE_LATENCY_MS}ms`)) {
        child.kill("SIGTERM");
        throw new Error("the Lab did not hold its store writes, so the bursts would not race");
      }
      return { origin: match[1]!, child, log: () => log, exited };
    }
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's start script never served DevTeam. Log tail:\n${log.slice(-2000)}`);
}

// ---- the Lab's routes, as one verified user ----------------------------------

type Settled = { status: string; output: any; error: string | undefined };

function labApi(origin: string, user: { userId: string; bearer: string }) {
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${user.bearer}` },
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
  /** Every row of a collection, through one session, page by page. */
  const collection = async (sessionId: string, ref: string): Promise<Array<Record<string, any>>> => {
    const rows: Array<Record<string, any>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const body = await get(
        `/sessions/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      rows.push(...((body.items ?? []) as Array<{ clientData?: Record<string, any> }>).map((i) => i.clientData ?? {}));
      if (body.nextCursor === undefined || body.nextCursor === null || body.nextCursor === cursor) break;
      cursor = body.nextCursor;
    }
    return rows;
  };
  /** A new session of `kind` owned by this user, with `state` written at create. */
  const createSession = async (kind: string, state?: Record<string, unknown>): Promise<string> => {
    const { status, body } = await call("POST", `/${encodeURIComponent(kind)}/sessions`, {
      userId: user.userId,
      ...(state === undefined ? {} : { state }),
    });
    if (status >= 400) throw new Error(`create a ${kind} session as ${user.userId}: ${status} ${JSON.stringify(body)}`);
    return String(body.session.id);
  };
  /** Run one action and wait for it to end: its status, and its output or error. */
  const act = async (kind: string, sessionId: string, action: string, input: unknown): Promise<Settled> => {
    const posted = await call("POST", `/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(action)}`, {
      userId: user.userId,
      input,
    });
    if (posted.status !== 202) return { status: `http ${posted.status}`, output: undefined, error: JSON.stringify(posted.body) };
    const requestId = String(posted.body?.request?.id);
    let status = "in_progress";
    for (let waited = 0; waited < 60_000 && status === "in_progress"; waited += 50) {
      status = String((await call("GET", `/${encodeURIComponent(kind)}/requests/${encodeURIComponent(requestId)}/status`)).body?.status);
      if (status === "in_progress") await sleep(50);
    }
    for (let offset = 0; offset < 5000; offset += 200) {
      const listed = await get(`/sessions/${encodeURIComponent(sessionId)}/requests?include_result_output=true&limit=200&offset=${offset}`);
      const requests = (listed.requests ?? []) as Array<Record<string, any>>;
      const found = requests.find((r) => r.id === requestId);
      if (found !== undefined) return { status, output: found.result?.output, error: found.result?.error?.message };
      if (requests.length < 200) break;
    }
    return { status, output: undefined, error: undefined };
  };
  return { user, call, get, collection, createSession, act };
}
type LabApi = ReturnType<typeof labApi>;

type RoomLine = { seq: number; userId: string; author: string | null; body: string };

/** Every line of the room after `after`, page by page, through one talk session. Throws on a refused read. */
async function readAll(api: LabApi, kind: string, sessionId: string, after = 0): Promise<{ lines: RoomLine[]; cursor: number }> {
  const lines: RoomLine[] = [];
  let cursor = after;
  for (let page = 0; page < 1000; page += 1) {
    const read = await api.act(kind, sessionId, "read", { after: cursor });
    if (read.status !== "completed") throw new Error(`read refused (${read.status}): ${read.error ?? ""}`);
    lines.push(...((read.output?.lines ?? []) as RoomLine[]).filter((l: RoomLine & { tombstone?: boolean }) => l.tombstone !== true));
    const next = Number(read.output?.nextCursor);
    if (!(next > cursor)) break;
    cursor = next;
  }
  return { lines, cursor };
}

// ---- what the tree and the store hold ---------------------------------------

type Tree = { channels: Array<{ id: string; boards: boolean }> };
type Row = { id: string; title: string; brief: string | null; ownerUserId: string; members: string[]; workstreams: string[]; sessions: Array<{ sessionId: string; userId: string }> };

async function readTree(): Promise<Tree> {
  const roster = await readDeclaredRoster(TREE);
  if (roster.problems.length > 0) throw new Error(`the tree did not load: ${roster.problems.map((p) => p.path).join(", ")}`);
  return { channels: roster.channels.map((c) => ({ id: c.id, boards: ((c.declared.boards as string[] | undefined) ?? []).length > 0 })) };
}

/** The inventory's channels and the project rows, read through a channel's session by its published key patterns. */
async function readStore(api: LabApi, host: string): Promise<{ channels: string[]; rows: Row[] }> {
  const manifest = await api.get(`/sessions/${encodeURIComponent(host)}/manifest`);
  const refOf = (pattern: string) =>
    (manifest.resources as Array<{ kind: string; ref: string; pattern: string }>).find((r) => r.kind === "collection" && r.pattern === pattern)?.ref;
  const channelsRef = refOf("inventory/channels/*");
  const projectsRef = refOf("projects/*");
  return {
    channels: channelsRef === undefined ? [] : (await api.collection(host, channelsRef)).map((r) => String(r.id)),
    rows: projectsRef === undefined ? [] : ((await api.collection(host, projectsRef)) as Row[]),
  };
}

// ---- the page ----------------------------------------------------------------

const attr = async (page: Page, selector: string, name: string) =>
  (await page.locator(selector).evaluateAll((els, n) => els.map((e) => e.getAttribute(n) ?? ""), name)) as string[];

async function visible(page: Page, testId: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function openPage(page: Page, origin: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"));
}

/** No tab shows a project gap: no `project-*-empty` state, and no copy saying projects arrive later. */
async function gapReached(page: Page): Promise<string | undefined> {
  if ((await page.locator("[data-testid^=project-][data-testid$=-empty]").count()) > 0) return "a project-*-empty state is drawn";
  const text = (await page.locator("main").textContent()) ?? "";
  return text.includes("FIX-1650") ? "copy naming FIX-1650 is drawn" : undefined;
}

// ---- the legs ----------------------------------------------------------------

async function screens(served: Running, tree: Tree, owner: LabApi, host: string, fail: (leg: string, why: string) => void, evidence: string[]) {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(served.origin);
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string } | null;
    if (injected?.userId !== owner.user.userId) throw new Error(`the page runs as ${injected?.userId}, not the projects' owner ${owner.user.userId}`);

    const { channels, rows } = await readStore(owner, host);
    await openPage(page, served.origin, "/inbox");

    // ---- PROJECTS: each row with exactly its workstreams, then No project ----
    await page.getByTestId("project-group").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    const groups = await page.getByTestId("project-group").evaluateAll((els) =>
      els.map((g) => ({
        id: g.getAttribute("data-project-id") ?? "",
        streams: [...g.querySelectorAll("[data-testid^=nav-workstream-]")].map((e) =>
          e.getAttribute("data-testid") === "nav-workstream-gone" ? `gone:${e.getAttribute("data-channel-id")}` : e.getAttribute("data-testid")!.slice("nav-workstream-".length),
        ),
      })),
    );
    const listed = new Set(rows.flatMap((r) => r.workstreams));
    const unlisted = channels.filter((c) => !listed.has(c));
    const want = [
      ...rows.map((r) => ({ id: r.id, streams: r.workstreams.map((w) => (channels.includes(w) ? w : `gone:${w}`)) })),
      ...(unlisted.length === 0 ? [] : [{ id: "unassigned", streams: unlisted }]),
    ];
    const show = (gs: typeof want) => gs.map((g) => `${g.id}[${g.streams.join(",")}]`).join(" ");
    if (show(groups) !== show(want)) fail("PROJECTS equals the store's rows", `drawn ${show(groups) || "(nothing)"}, stored ${show(want)}`);

    // ---- the cross-team project ---------------------------------------------
    const crossTeam = rows.find((r) => new Set(r.workstreams.map(teamOf)).size >= 2);
    if (crossTeam === undefined) fail("store", "no project row lists workstreams from two teams, so the cross-team check grades nothing");
    else {
      const group = groups.find((g) => g.id === crossTeam.id);
      if (group === undefined || !same(group.streams, crossTeam.workstreams)) {
        fail("the cross-team project", `PROJECTS groups ${group?.streams.join(", ") ?? "nothing"} under ${crossTeam.id}, its row lists ${crossTeam.workstreams.join(", ")}`);
      }
    }

    // ---- every project's four tabs -------------------------------------------
    const tabsLeg = "a project's four tabs";
    let kept = 0;
    for (const row of rows) {
      const tab = async (name: string) => {
        await openPage(page, served.origin, `/p/${encodeURIComponent(row.id)}/${name}`);
        await page.locator(`[role=tab][data-tab=${name}][aria-selected=true]`).waitFor({ timeout: 10_000 });
      };
      const noGap = async (name: string) => {
        const gap = await gapReached(page);
        if (gap !== undefined) fail(tabsLeg, `${row.id}'s ${name}: ${gap}`);
      };

      await tab("brief");
      if (row.brief === null || row.brief === undefined) {
        if (!(await visible(page, "project-brief-none"))) fail(tabsLeg, `${row.id} has no brief and its Brief doesn't say so`);
      } else if (!(await visible(page, "project-brief"))) {
        fail(tabsLeg, `${row.id}'s Brief draws no brief`);
      } else {
        const drawn = ((await page.getByTestId("project-brief").textContent()) ?? "").trim();
        if (drawn !== row.brief.trim()) fail(tabsLeg, `${row.id}'s Brief draws "${drawn}", stored "${row.brief}"`);
      }
      await noGap("brief");

      await tab("board");
      const boardWant = row.workstreams.filter((w) => tree.channels.find((c) => c.id === w)?.boards === true);
      if (boardWant.length === 0) {
        if (!(await visible(page, "project-board-none"))) fail(tabsLeg, `${row.id} holds no board and its Board doesn't say so`);
      } else {
        await visible(page, "project-lane");
        const lanes = await attr(page, "[data-testid=project-lane]", "data-channel-id");
        if (!same(lanes, boardWant)) fail(tabsLeg, `${row.id}'s Board lanes: ${diff(boardWant, lanes)}`);
      }
      await noGap("board");

      await tab("workstreams");
      if (row.workstreams.length === 0) {
        if (!(await visible(page, "project-workstreams-none"))) fail(tabsLeg, `${row.id} lists no workstream and its Workstreams doesn't say so`);
      } else {
        await visible(page, "project-workstream");
        const listedHere = await attr(page, "[data-testid=project-workstream]", "data-channel-id");
        if (!same(listedHere, row.workstreams)) fail(tabsLeg, `${row.id}'s Workstreams: ${diff(row.workstreams, listedHere)}`);
        if (row.id === crossTeam?.id && new Set(listedHere.map(teamOf)).size < 2) {
          fail("the cross-team project", `${row.id}'s Workstreams tab lists one team's workstreams: ${listedHere.join(", ")}`);
        }
      }
      await noGap("workstreams");

      // Stream: the owner's room. A line posted from the composer is drawn,
      // and the room holds it once, under the owner.
      await tab("stream");
      await noGap("stream");
      const line = `${fixture.composerLine} (${row.id} ${RUN_STAMP})`;
      const own = row.sessions.find((s) => s.userId === owner.user.userId)?.sessionId;
      if (own === undefined) {
        fail("store", `${row.id}'s row lists no talk session for its owner`);
        continue;
      }
      if (!(await visible(page, "composer-input"))) {
        fail(tabsLeg, `${row.id}'s Stream has no composer`);
        continue;
      }
      await page.getByTestId("composer-input").fill(line);
      await page.getByTestId("composer-send").click();
      try {
        await page.getByTestId("transcript-line-body").filter({ hasText: line }).first().waitFor({ timeout: 30_000 });
      } catch {
        fail(tabsLeg, `${row.id}'s Stream never drew "${line}"`);
      }
      const kind = String((await owner.get(`/sessions/${encodeURIComponent(own)}`)).session?.flowKind ?? "");
      const room = await readAll(owner, kind, own);
      const copies = room.lines.filter((l) => l.body === line && l.userId === owner.user.userId && l.author === null).length;
      if (copies !== 1) fail(tabsLeg, `${row.id}'s room holds ${copies} copies of the line posted from its Stream`);
      else kept += 1;
    }
    if (pageErrors.length > 0) fail("screens", `the page threw: ${pageErrors.join(" | ")}`);
    evidence.push(`screens: ${show(groups)}; ${kept} of ${rows.length} Stream posts kept in their rooms`);
  } finally {
    await browser.close();
  }
}

async function room(tree: Tree, apis: { owner: LabApi; member: LabApi; crowd: LabApi[]; outsider: LabApi }, host: string, fail: (leg: string, why: string) => void, evidence: string[]) {
  const { owner, member, outsider } = apis;
  const { channels, rows } = await readStore(owner, host);

  // ---- the inventory is the tree's channels, and no talk session ------------
  const declared = tree.channels.map((c) => c.id);
  if (!same(channels, declared)) fail("the inventory equals the tree's channels", diff(declared, channels));

  const project = rows.find((r) => r.members.includes(member.user.userId) && !r.members.includes(outsider.user.userId));
  if (project === undefined) throw new Error(`no project lists ${member.user.userId} as a member and leaves out ${outsider.user.userId}`);
  const ownSession = project.sessions.find((s) => s.userId === owner.user.userId)?.sessionId;
  if (ownSession === undefined) throw new Error(`${project.id}'s row lists no talk session for its owner`);
  const kind = String((await owner.get(`/sessions/${encodeURIComponent(ownSession)}`)).session?.flowKind ?? "");

  // ---- a burst of joins leaves one talk session per member ------------------
  // Every member who holds no talk session yet joins every project they are in,
  // each from many fresh sessions at once: their first joins race to append to
  // the same row's `sessions`.
  const joinLeg = "a burst of joins leaves one session per member";
  const joiners = [member, ...apis.crowd];
  const memberProjects = rows.filter((r) => joiners.every((j) => r.members.includes(j.user.userId)));
  if (memberProjects.length === 0) fail("store", "no project lists every joining member, so the join burst races nothing");
  const plan = memberProjects.flatMap((row) => joiners.map((joiner) => ({ row, joiner })));
  // The barrier: every fresh session exists before any join is sent, and all are sent in one go.
  const windows = await Promise.all(plan.map(({ joiner }) => Promise.all(Array.from({ length: fixture.joins }, () => joiner.createSession(kind)))));
  const sent = plan.map(({ row, joiner }, p) => Promise.all(windows[p]!.map((w) => joiner.act(kind, w, "join", { projectId: row.id }))));
  const handed = new Map<string, string>();
  let joinsSent = 0;
  for (const [p, { row, joiner }] of plan.entries()) {
    const joins = await sent[p]!;
    joinsSent += joins.length;
    const who = `${joiner.user.userId} on ${row.id}`;
    const refused = joins.filter((j) => j.status !== "completed");
    if (refused.length > 0) fail(joinLeg, `${who}: ${refused.length} of ${joins.length} joins did not complete (${refused[0]!.error ?? refused[0]!.status})`);
    const answered = new Set(joins.filter((j) => j.status === "completed").map((j) => String(j.output?.sessionId)));
    if (answered.size !== 1) fail(joinLeg, `${who}: the joins answered ${answered.size} different sessions`);
    handed.set(`${row.id}/${joiner.user.userId}`, [...answered][0] ?? "");
  }
  const after = (await readStore(owner, host)).rows;
  for (const row of after.filter((r) => memberProjects.some((m) => m.id === r.id))) {
    for (const user of [owner.user.userId, ...joiners.map((j) => j.user.userId)]) {
      const listed = row.sessions.filter((s) => s.userId === user);
      if (listed.length !== 1) fail(joinLeg, `${row.id}'s row lists ${listed.length} sessions for ${user}`);
      const given = handed.get(`${row.id}/${user}`);
      if (given !== undefined && listed.length === 1 && given !== listed[0]!.sessionId) {
        fail(joinLeg, `${row.id}: ${user}'s joins answered ${given}, the row lists ${listed[0]!.sessionId}`);
      }
    }
  }
  const theirs = after.find((r) => r.id === project.id)?.sessions.find((s) => s.userId === member.user.userId)?.sessionId;
  if (theirs === undefined) throw new Error(`${member.user.userId} has no talk session on ${project.id} to read the room through`);

  // ---- two members read each other's lines by cursor -------------------------
  const crossLeg = "members read each other's lines";
  const ownerLine = `${fixture.ownerLine} (${RUN_STAMP})`;
  const memberLine = `${fixture.memberLine} (${RUN_STAMP})`;
  const ownerStart = (await readAll(owner, kind, ownSession)).cursor;
  const posted = await owner.act(kind, ownSession, "post", { body: ownerLine });
  if (posted.status !== "completed") fail(crossLeg, `the owner's post ended ${posted.status}: ${posted.error ?? ""}`);
  const memberRead = await readAll(member, kind, theirs);
  if (!memberRead.lines.some((l) => l.body === ownerLine && l.userId === owner.user.userId)) fail(crossLeg, "the member's read holds no line the owner posted");
  const replied = await member.act(kind, theirs, "post", { body: memberLine });
  if (replied.status !== "completed") fail(crossLeg, `the member's post ended ${replied.status}: ${replied.error ?? ""}`);
  const ownerRead = await readAll(owner, kind, ownSession, ownerStart);
  if (!ownerRead.lines.some((l) => l.body === memberLine && l.userId === member.user.userId)) fail(crossLeg, "the owner's read by cursor holds no line the member posted");

  // ---- the seat's answer is in the room for both -----------------------------
  const answerLeg = "a seat's answer is in the room for both";
  const isAnswer = (l: RoomLine) => l.author === SEAT_ANSWERS && l.body.includes(ownerLine);
  let seen = { owner: false, member: false };
  for (let waited = 0; waited < 30_000 && !(seen.owner && seen.member); waited += 500) {
    seen = {
      owner: (await readAll(owner, kind, ownSession, ownerStart)).lines.some(isAnswer),
      member: (await readAll(member, kind, theirs)).lines.some(isAnswer),
    };
    if (!(seen.owner && seen.member)) await sleep(500);
  }
  if (!seen.owner || !seen.member) fail(answerLeg, `${SEAT_ANSWERS}'s answer to the owner's line: owner sees it ${seen.owner}, member sees it ${seen.member}`);

  // ---- the outsider is refused, even from a session naming the project -------
  const outLeg = "the outsider is refused";
  const outsiderLine = `${fixture.outsiderLine} (${RUN_STAMP})`;
  const joinWindow = await outsider.createSession(kind);
  const outJoin = await outsider.act(kind, joinWindow, "join", { projectId: project.id });
  if (outJoin.status === "completed") fail(outLeg, `the outsider joined ${project.id}`);
  const forged = await outsider.createSession(kind, { resourceId: project.id });
  const outRead = await outsider.act(kind, forged, "read", { after: 0 });
  if (outRead.status === "completed") fail(outLeg, `the outsider read ${project.id}'s room from a session it made naming the project: ${(outRead.output?.lines ?? []).length} line(s)`);
  const outPost = await outsider.act(kind, forged, "post", { body: outsiderLine });
  if (outPost.status === "completed") fail(outLeg, `the outsider posted into ${project.id}'s room`);
  const leaked = (await readAll(owner, kind, ownSession)).lines.filter((l) => l.body === outsiderLine || l.userId === outsider.user.userId);
  if (leaked.length > 0) fail(outLeg, `the room holds ${leaked.length} line(s) of the outsider's`);
  const rowAfter = (await readStore(owner, host)).rows.find((r) => r.id === project.id);
  if (rowAfter?.sessions.some((s) => s.userId === outsider.user.userId) === true) fail(outLeg, `${project.id}'s row lists a session for the outsider`);

  // ---- a burst of posts from both members lands whole ------------------------
  const burstLeg = "a burst of posts lands whole";
  // The engine runs one action at a time per session, so a burst through one
  // session per member races only two writers. Each member posts from several
  // sessions at once, the way several open windows would: each a session of
  // theirs naming the project, which lets them in only because they are a
  // member (the outsider's identical session was refused above).
  const per = fixture.burst.windows * fixture.burst.perWindow;
  const bodies = (who: string) => Array.from({ length: per }, (_, i) => `${fixture.burst.body} ${who} ${i} (${RUN_STAMP})`);
  const windowsOf = (api: LabApi) =>
    Promise.all(Array.from({ length: fixture.burst.windows }, () => api.createSession(kind, { resourceId: project.id })));
  const [ownerWindows, memberWindows] = await Promise.all([windowsOf(owner), windowsOf(member)]);
  // The barrier: every session exists before any post is sent, and every post is sent in one go.
  const burst = await Promise.all([
    ...bodies("owner").map((body, i) => owner.act(kind, ownerWindows[i % ownerWindows.length]!, "post", { body })),
    ...bodies("member").map((body, i) => member.act(kind, memberWindows[i % memberWindows.length]!, "post", { body })),
  ]);
  const lost = burst.filter((p) => p.status !== "completed");
  if (lost.length > 0) fail(burstLeg, `${lost.length} of ${burst.length} posts did not complete (${lost[0]!.error ?? lost[0]!.status})`);
  const held = (await readAll(owner, kind, ownSession)).lines;
  const counts = new Map<string, number>();
  for (const l of held) counts.set(l.body, (counts.get(l.body) ?? 0) + 1);
  const missing = [...bodies("owner"), ...bodies("member")].filter((b) => counts.get(b) !== 1);
  if (missing.length > 0) {
    const where = missing.slice(0, 3).map((b) => `"${b}" ${counts.get(b) ?? 0}x at seq [${held.filter((l) => l.body === b).map((l) => l.seq).join(",")}]`);
    fail(burstLeg, `${missing.length} of ${burst.length} burst lines are not in the room exactly once: ${where.join("; ")}; room seqs ${Math.min(...held.map((l) => l.seq))}..${Math.max(...held.map((l) => l.seq))} (${held.length} lines)`);
  }
  const seqs = held.map((l) => l.seq);
  if (new Set(seqs).size !== seqs.length) fail(burstLeg, "two lines share a sequence number");

  evidence.push(
    `room: ${channels.length} channels as declared; ${joinsSent} joins from ${joiners.length} members at once left one session per member on ${memberProjects.length} project(s); cross-member reads by cursor; ${SEAT_ANSWERS} answered in the room for both; outsider join ${outJoin.status}, forged read ${outRead.status}, post ${outPost.status}; ${burst.length - lost.length} of ${burst.length} burst posts completed, ${held.length} lines in ${project.id}'s room`,
  );
}

/**
 * The chief of staff creates projects for the person who asks it. The person
 * is the member, so a row the profile wrote at boot (the owner's) can't pass
 * for one written for them. Titles carry this run's stamp, so no file in the
 * repository names the rows graded here.
 */
async function cos(apis: { owner: LabApi; member: LabApi }, host: string, fail: (leg: string, why: string) => void, evidence: string[]) {
  const leg = "cos";
  const { owner, member: person } = apis;
  const named = owner.user.userId;
  const titles = fixture.cos.titles.map((t) => `${t} ${RUN_STAMP}`);
  const before = new Set((await readStore(owner, host)).rows.map((r) => r.id));

  const opened = await person.call("POST", `/${encodeURIComponent(COS)}/sessions`, { userId: person.user.userId });
  if (opened.status !== 201) {
    fail(leg, `the chief of staff's address did not answer: ${opened.status} ${JSON.stringify(opened.body)}`);
    return;
  }
  const session = String(opened.body.session.id);
  const ask = fixture.cos.ask.replace("{first}", titles[0]!).replace("{second}", titles[1]!).replace("{named}", named);
  const posted = await person.call("POST", `/${encodeURIComponent(COS)}/${encodeURIComponent(session)}/actions/run`, {
    userId: person.user.userId,
    input: { message: ask },
  });
  if (posted.status >= 400) {
    fail(leg, `the chief of staff's door refused the line: ${posted.status} ${JSON.stringify(posted.body)}`);
    return;
  }
  const requestId = String(posted.body.request.id);
  let status = "timed-out";
  for (const until = Date.now() + COS_TURN_MS; Date.now() < until; await sleep(500)) {
    const polled = String((await person.call("GET", `/${encodeURIComponent(COS)}/requests/${encodeURIComponent(requestId)}/status`)).body?.status);
    if (!["pending", "queued", "in_progress", "running"].includes(polled)) {
      status = polled;
      break;
    }
  }
  const said = async () => {
    const body = await person.get(`/sessions/${encodeURIComponent(session)}/state?include_items=true&item_types=message&limit=200`);
    const replies = ((body.items ?? []) as Array<{ role?: string; content?: unknown }>).filter((i) => i.role === "assistant");
    return JSON.stringify(replies.at(-1)?.content ?? "").slice(0, 400);
  };
  if (status !== "completed") fail(leg, `the chief of staff's turn ended ${status}`);

  const created = (await readStore(owner, host)).rows.filter((r) => !before.has(r.id));
  if (created.length !== 2) {
    fail(leg, `asked for two projects, the store holds ${created.length} new row(s) [${created.map((r) => r.title).join(", ")}]; the chief of staff said ${await said()}`);
    return;
  }
  for (const [i, title] of titles.entries()) {
    const row = created.find((r) => r.title.toLowerCase() === title.toLowerCase());
    if (row === undefined) {
      fail(leg, `no new row is titled "${title}": ${created.map((r) => r.title).join(", ")}`);
      continue;
    }
    if (row.ownerUserId !== person.user.userId) fail(leg, `${row.id} is owned by ${row.ownerUserId}, not ${person.user.userId}, who asked`);
    const wantMembers = i === 0 ? [person.user.userId, named] : [person.user.userId];
    if (!same(row.members, wantMembers)) fail(leg, `${row.id}'s members: ${diff(wantMembers, row.members)}`);
    // Bound: the row lists the person's talk session, and a read through it is
    // let in, which needs the session to name the row and its owner to be a member.
    const own = row.sessions.find((s) => s.userId === person.user.userId)?.sessionId;
    if (own === undefined) {
      fail(leg, `${row.id}'s row lists no talk session for ${person.user.userId}`);
      continue;
    }
    const kind = String((await person.get(`/sessions/${encodeURIComponent(own)}`)).session?.flowKind ?? "");
    const read = await person.act(kind, own, "read", { after: 0 });
    if (read.status !== "completed") fail(leg, `${row.id}: a read through the person's talk session ended ${read.status}: ${read.error ?? ""}`);
  }
  evidence.push(
    `cos: asked by ${person.user.userId}, the chief of staff created ${created.map((r) => `${r.id} {owner ${r.ownerUserId}, members [${r.members.join(",")}], ${r.sessions.length} talk session(s)}`).join(" and ")}`,
  );
}

// ---- a restart ---------------------------------------------------------------

/** One project as a restart must keep it: its row, and its room read through the owner's talk session. */
type Kept = { row: Row; kind: string; own: string; lines: RoomLine[] };

const rowKey = (r: Row) =>
  JSON.stringify({
    title: r.title,
    brief: r.brief ?? null,
    owner: r.ownerUserId,
    members: sorted(r.members),
    workstreams: r.workstreams,
    sessions: sorted(r.sessions.map((s) => `${s.userId}=${s.sessionId}`)),
  });

/** Every project and its room, as the owner reads them now. */
async function whatIsHeld(owner: LabApi, host: string): Promise<Kept[]> {
  const kept: Kept[] = [];
  for (const row of (await readStore(owner, host)).rows) {
    const own = row.sessions.find((s) => s.userId === owner.user.userId)?.sessionId;
    if (own === undefined) throw new Error(`${row.id}'s row lists no talk session for its owner`);
    const kind = String((await owner.get(`/sessions/${encodeURIComponent(own)}`)).session?.flowKind ?? "");
    kept.push({ row, kind, own, lines: (await readAll(owner, kind, own)).lines });
  }
  return kept;
}

/**
 * After the Lab restarts on the same store: every project row is as it was,
 * with the same talk links and none added, and each room reads back through
 * the same talk session with every line it held, once, at the same place.
 */
async function restarted(before: Kept[], owner: LabApi, host: string, fail: (leg: string, why: string) => void, evidence: string[]) {
  const leg = "a restart keeps the projects and their rooms";
  let rows: Row[];
  try {
    rows = (await readStore(owner, host)).rows;
  } catch (error) {
    fail(leg, `the projects could not be read after the restart: ${(error as Error).message}`);
    return;
  }
  if (rows.length !== before.length) fail(leg, `${before.length} project row(s) before the restart, ${rows.length} after`);
  const ownerLine = `${fixture.ownerLine} (${RUN_STAMP})`;
  let ownerLineKept = false;
  let linesKept = 0;
  for (const { row, kind, own, lines } of before) {
    const now = rows.find((r) => r.id === row.id);
    if (now === undefined) {
      fail(leg, `${row.id} is gone after the restart`);
      continue;
    }
    if (rowKey(now) !== rowKey(row)) fail(leg, `${row.id}'s row changed across the restart: ${rowKey(row)} became ${rowKey(now)}`);
    let read: RoomLine[];
    try {
      read = (await readAll(owner, kind, own)).lines;
    } catch (error) {
      fail(leg, `${row.id}'s room could not be read through the owner's talk session ${own} after the restart: ${(error as Error).message}`);
      continue;
    }
    const at = (l: RoomLine) => `${l.seq}|${l.userId}|${l.author ?? ""}|${l.body}`;
    const after = new Map<string, number>();
    for (const l of read) after.set(at(l), (after.get(at(l)) ?? 0) + 1);
    const lost = lines.filter((l) => after.get(at(l)) !== 1);
    if (lost.length > 0) fail(leg, `${row.id}: ${lost.length} of ${lines.length} lines are not in the room once, at their place, after the restart`);
    const seqs = read.map((l) => l.seq);
    if (new Set(seqs).size !== seqs.length) fail(leg, `${row.id}: two lines share a sequence number after the restart`);
    if (read.some((l) => l.body === ownerLine && l.userId === owner.user.userId)) ownerLineKept = true;
    linesKept += lines.length - lost.length;
  }
  if (!ownerLineKept) fail(leg, "the owner's line is not in its room after the restart");
  evidence.push(`restart: ${rows.length} of ${before.length} project rows unchanged with their talk links; ${linesKept} lines read back through the same talk sessions`);
}

await runGoal(async () => {
  if (COS_LEG && !MODEL_KEYS.some((key) => (process.env[key] ?? "") !== "")) {
    return {
      failures: [`precondition: the cos leg runs the chief of staff on a real model, and none of ${MODEL_KEYS.join(", ")} is set. GOAL_LEG=model-free runs the other legs without one`],
      evidence: "",
    };
  }
  const pages = await buildShiftManager(CONTROL);
  const swap = serverSwapFor(CONTROL);
  const fired = swap === undefined ? undefined : join(SCRATCH, `fired-${CONTROL}-${RUN_STAMP}.log`);
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, why: string) => failures.push(`${leg}: ${why}`);
  const tree = await readTree();
  const host = tree.channels[0]!.id;
  mkdirSync(join(SCRATCH, "stores"), { recursive: true });
  const store = join(mkdtempSync(join(SCRATCH, "stores", "devteam-")), "devteam.sqlite");
  let served = await startLab(pages, fired, store);
  try {
    const apis = {
      owner: labApi(served.origin, LAB_USERS.owner),
      member: labApi(served.origin, LAB_USERS.member),
      crowd: LAB_CROWD.map((user) => labApi(served.origin, user)),
      outsider: labApi(served.origin, LAB_USERS.outsider),
    };
    const { rows } = await readStore(apis.owner, host);
    if (rows.length === 0) fail("store", "the Lab holds no project row, so every leg grades nothing");
    for (const row of rows) {
      if (row.ownerUserId !== apis.owner.user.userId) fail("store", `${row.id} is owned by ${row.ownerUserId}, not the profile's person`);
    }
    if (MODEL_FREE) {
      await screens(served, tree, apis.owner, host, fail, evidence);
      await room(tree, apis, host, fail, evidence);
      // Stop the Lab and start it again on the same store.
      const before = await whatIsHeld(apis.owner, host);
      served.child.kill("SIGTERM");
      await served.exited;
      served = await startLab(pages, fired, store);
      await restarted(before, labApi(served.origin, LAB_USERS.owner), host, fail, evidence);
    }
    // Last, on the Lab as it now runs: its rows are the member's.
    if (COS_LEG) {
      await cos({ owner: labApi(served.origin, LAB_USERS.owner), member: labApi(served.origin, LAB_USERS.member) }, host, fail, evidence);
    }
  } finally {
    served.child.kill("SIGTERM");
    await served.exited;
  }
  if (fired !== undefined && (!existsSync(fired) || readFileSync(fired, "utf8").trim().length === 0)) {
    throw new Error(`control ${CONTROL}: the Lab never imported ${swap!.target}, so nothing was swapped`);
  }
  const swapNote = fired === undefined ? "" : ` Swap fired for: ${readFileSync(fired, "utf8").trim().split("\n").map((p) => p.split("/").pop()).join(", ")}.`;
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its start script over the DevTeam profile; ${[
      ...(MODEL_FREE
        ? [`the screens walked in Chromium as the owner and the room driven over HTTP as the owner, ${1 + LAB_CROWD.length} verified members and an outsider, then the Lab restarted on its store`]
        : []),
      ...(COS_LEG ? ["the chief of staff asked over HTTP as the member, on its own model"] : []),
    ].join("; ")}; all graded against the tree and the store. ${evidence.join("; ")}.${swapNote}`,
  };
});
