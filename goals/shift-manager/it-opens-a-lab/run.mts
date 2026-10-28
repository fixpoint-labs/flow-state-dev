/**
 * Goal check: Shift Manager opens a Lab it was never told about, and every screen a
 * person reaches shows what that Lab's store holds.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * Shift Manager is built with Vite into a scratch directory, then served by its own
 * command over each goal Lab's unedited `fsdev.config.mts`: DevTeam
 * (bearer-authenticated, in-memory) and multi-seat-collab (SQLite, no auth).
 * The driver puts one row on each Lab's board through the Lab's own action
 * routes, then Chromium walks every level. What the page draws is graded
 * against two things Shift Manager never reads: the Lab's tree on disk, and the
 * Lab's store read through the HTTP routes with this script's own requests.
 *
 * Legs (each failure is tagged `[<lab>] <leg>`):
 *
 *   store     the store holds what the tree declares (a precondition)
 *   TEAMS     TEAMS equals the store's seats, each under its team
 *   Tasks     Tasks equals the stored rows that aren't done: the queued ones
 *             once the Queued toggle is on, which says how many it hides.
 *             Every row is on a conversation's own board, so the task level
 *             opens from here
 *   Inbox     Inbox equals the stored pending asks and open questions, or says nothing needs you
 *             with the runs still going
 *   reach     every level, tab and panel opens, and each empty one is named
 *   entry     (DevTeam) a workstream the person opens in a project is listed
 *             on its Workstreams tab, and the project Board's lane for its
 *             session draws exactly the rows its lead keeps on that board
 *   post      a composer post is drawn, and is in the stored transcript: the
 *             workstream entry's conversation with its lead, or, in a Lab
 *             with no workstream, the task composer's on an open row, into
 *             the session it ran in
 *   answer    an ask approved from Inbox is no longer pending in the store,
 *             and Inbox no longer lists it
 *
 * Controls rebuild Shift Manager with source modules swapped for a module under
 * `controls/` (a Vite `resolveId` plugin; the build fails if a swap never
 * fired):
 *
 *   static-names     seats written in from the DevTeam tree. Must fail at
 *                    "TEAMS equals the store's seats" on multi-seat-collab.
 *   optimistic-post  the one send path (`send.ts`) reads delivered and
 *                    sends nothing. Must fail at "the post is in the stored
 *                    transcript".
 *   unanswerable-asks  every ask is marked unanswerable. Must fail at "an
 *                    answer lands in the store" on DevTeam.
 *   queued-shown     Tasks treats no row as queued, so the toggle hides
 *                    nothing. Must fail at "Tasks equals the store's open
 *                    rows" on DevTeam, whose follow-up row is queued.
 *
 * Run:      pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts
 * Control:  GOAL_CONTROL=static-names pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts
 * Needs:    PLAYWRIGHT_BROWSERS_PATH pointing at a Chromium pool, or Playwright's own.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { labApi, startShiftManager, type LabApi, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { Scenario, type ServedLab } from "../../multi-seat-collab/run-scenario.mts";
import { readLabTree, routesFor } from "../../../packages/shift-manager/test/fixtures/multi-worker-collab/host.mts";
import { PROJECTS_FLOW as PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { EM_FLOW as EM_FLOW } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";
import { PHASE } from "../../../packages/shift-manager/teams/devteam/phase.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["static-names", "optimistic-post", "unanswerable-asks", "queued-shown"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const fixture = loadFixture<{
  line: string;
  devteam: { issue: string; text: string; followUp: { issue: string; text: string } };
  multiSeatCollab: { goal: string; desk: string; asks: string };
}>(import.meta.url);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "packages", "shift-manager");
const SCRATCH = goalTmpDir("shift-manager");
/** The id of the workstream this check opens in a DevTeam project, as its owner. */
const WORKSTREAM = "feature";

const LABS = {
  devteam: {
    config: join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam", "fsdev.config.mts"),
    tree: join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam", "workforce"),
  },
  "multi-seat-collab": {
    config: join(REPO_ROOT, "packages", "shift-manager", "test", "fixtures", "multi-worker-collab", "fsdev.config.mts"),
    tree: join(REPO_ROOT, "packages", "shift-manager", "test", "fixtures", "multi-worker-collab", "workforce"),
  },
} as const;
type LabName = keyof typeof LABS;

/** Stored statuses a board row is finished in. Tasks leaves these out. */
const DONE = new Set(["completed", "cancelled"]);
/** Queued: open, and not running. A row waiting on a person is running, held on its question. Tasks hides these by default. */
const QUEUED = (status: string) => !DONE.has(status) && status !== "in_progress" && status !== "errored";

/**
 * What an Inbox with nothing pending says: the sessions still running, worked
 * out from the store.
 */
function emptyInbox(store: Store): string {
  const rows = Object.values(store.rows).flat();
  // Sessions, not rows: running rows linked to one run session count once, and an unlinked running row is its own.
  const live = rows.filter((r) => r.status === "in_progress");
  const running = new Set(live.flatMap((r) => (r.runSession === null ? [] : [r.runSession]))).size + live.filter((r) => r.runSession === null).length;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return `Nothing needs you. ${n(running, "session is", "sessions are")} still running.`;
}
/** Suspension reasons that are a person being asked something. */
const PERSON_REASONS = new Set(["user_approval", "user_input"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diff = (want: Iterable<string>, got: Iterable<string>) => {
  const w = new Set(want);
  const g = new Set(got);
  return `missing [${[...w].filter((x) => !g.has(x)).join(", ")}], extra [${[...g].filter((x) => !w.has(x)).join(", ")}]`;
};

// ---- building Shift Manager --------------------------------------------------------

/** The control's module swap: which source files, for which module under `controls/`. */
function swapFor(control: string): { targets: string[]; with: string } | undefined {
  const lib = (file: string) => join(SHIFT_MANAGER, "src", "lib", file);
  if (control === "static-names") {
    return { targets: [lib("reads.ts")], with: join(HERE, "controls", "static-names.ts") };
  }
  if (control === "optimistic-post") {
    return { targets: [lib("send.ts")], with: join(HERE, "controls", "optimistic-post.ts") };
  }
  if (control === "unanswerable-asks") {
    return { targets: [lib("reads.ts")], with: join(HERE, "controls", "unanswerable-asks.ts") };
  }
  if (control === "queued-shown") {
    return { targets: [lib("tasks.ts")], with: join(HERE, "controls", "queued-shown.ts") };
  }
  return undefined;
}

/** Build Shift Manager's pages into a scratch directory, with the control's swap if one is set. */
async function buildShiftManager(control: string): Promise<string> {
  const outDir = join(SCRATCH, `pages-${control === "" ? "as-written" : control}`);
  const viteEntry = createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const swap = swapFor(control);
  const swapped = new Set<string>();
  const staticSeats =
    control === "static-names"
      ? (await readDeclaredRoster(LABS.devteam.tree)).workers.map((w) => ({ id: w.id, kind: String(w.declared.flow) }))
      : [];
  await vite.build({
    root: SHIFT_MANAGER,
    configFile: join(SHIFT_MANAGER, "vite.config.ts"),
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
    define: { __STATIC_SEATS__: JSON.stringify(staticSeats) },
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
                const id: string | undefined = resolved?.id;
                if (id === undefined || !swap.targets.includes(id)) return null;
                swapped.add(id);
                return swap.with;
              },
            },
          ],
  });
  const missed = swap?.targets.filter((target) => !swapped.has(target)) ?? [];
  if (missed.length > 0) {
    throw new Error(`control ${control}: the build never imported ${missed.join(", ")}, so nothing was swapped there`);
  }
  return outDir;
}

// ---- serving a Lab -----------------------------------------------------------

/** Shift Manager's command over a Lab's config, from a scratch working directory. */
const startLab = (name: LabName, pages: string, env: Record<string, string>): Promise<ServedShiftManager> =>
  startShiftManager({ scratch: SCRATCH, label: name, config: LABS[name].config, pages, env });

// ---- the store, read by this script -----------------------------------------


/** What the tree on disk declares: the oracle Shift Manager never reads. */
type Tree = { seats: string[] };

async function readTree(root: string): Promise<Tree> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) throw new Error(`the tree at ${root} did not load: ${roster.problems.map((p) => p.path).join(", ")}`);
  return { seats: roster.workers.map((w) => w.id) };
}

/** What the store holds, read through the Lab's routes by this script. */
type Store = {
  seats: string[];
  /**
   * Board holder -> every stored row on its board: a conversation's own
   * board (`<sessionId>.tasks`), keyed by the conversation that filed it.
   */
  rows: Record<
    string,
    Array<{ ref: string; id: string; status: string; title: string; assignee: string | null; runSession: string | null; questions: string[] }>
  >;
  /** Suspension ids pending on a person, across the seats' sessions. */
  asks: string[];
  /** The rows' open questions, by hold id: each is an Inbox item too (FIX-2133). */
  questions: string[];
  /** The organization's project rows, by id. */
  projects: Array<{ id: string }>;
};

/** The person's `workforce-roster` session, opened once per API. */
const rosters = new WeakMap<LabApi, Map<string, string>>();
async function rosterSession(api: LabApi, userId: string): Promise<string | undefined> {
  const held = rosters.get(api) ?? new Map<string, string>();
  rosters.set(api, held);
  if (!held.has(userId)) {
    const opened = await api.call("POST", "/workforce-roster/sessions", { userId });
    if (opened.status !== 201) return undefined;
    held.set(userId, String(opened.body.session.id));
  }
  return held.get(userId);
}

/** The collection a conversation's own board keeps its rows in: Workforce's conversation ledger. */
const CONVERSATION_LEDGER = "tasks";

/** The resources a session's flow declares. */
type Declared = Array<{ kind: string; ref: string; pattern: string; scope?: string; client?: { state?: { read?: boolean } } }>;
const declaredBy = async (api: LabApi, sessionId: string): Promise<Declared> =>
  (await api.get(`/sessions/${encodeURIComponent(sessionId)}/manifest`)).resources as Declared;

/** The person's sessions that no other session opened: their own, not a task's. */
async function topLevelSessions(api: LabApi, userId: string): Promise<string[]> {
  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&limit=500`);
  return ((listing.sessions ?? []) as Array<Record<string, any>>).filter((s) => s.parentSessionId == null).map((s) => String(s.id));
}

/** Every session of the person's, those another session opened (a workstream's) included. */
async function allSessions(api: LabApi, userId: string): Promise<Array<Record<string, any>>> {
  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&limit=500`);
  return (listing.sessions ?? []) as Array<Record<string, any>>;
}

/**
 * Every conversation's board, by conversation: the conversation ledger read
 * through the first of the person's own sessions whose flow lets a browser
 * read it, each row kept under the conversation its topic names
 * (`<filingSessionId>/<taskId>`, the filing id being `<sessionId>~<n>`). A
 * conversation is any session of the person's, a workstream's included.
 */
async function conversationRows(api: LabApi, userId: string): Promise<Store["rows"]> {
  const own = await topLevelSessions(api, userId);
  const theirs = new Set((await allSessions(api, userId)).map((s) => String(s.id)));
  let carrier: string | undefined;
  for (const sessionId of own) {
    if ((await declaredBy(api, sessionId)).some((r) => r.kind === "collection" && r.ref === CONVERSATION_LEDGER && r.client?.state?.read === true)) {
      carrier = sessionId;
      break;
    }
  }
  const rows: Store["rows"] = {};
  if (carrier === undefined) return rows;
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const body = await api.get(
      `/sessions/${encodeURIComponent(carrier)}/resources/${CONVERSATION_LEDGER}?limit=200${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
    );
    for (const item of (body.items ?? []) as Array<{ topic: string; clientData?: Record<string, any> }>) {
      const filing = decodeURIComponent(item.topic.split("/")[0] ?? "");
      const holder = filing.slice(0, filing.lastIndexOf("~"));
      if (!theirs.has(holder)) continue;
      const row = item.clientData ?? {};
      (rows[holder] ??= []).push({
        ref: `${holder}.${CONVERSATION_LEDGER}`,
        id: String(row.id),
        status: String(row.status),
        title: String(row.title ?? row.goal ?? row.id),
        assignee: typeof row.assignee === "string" ? row.assignee : null,
        runSession:
          row.run != null && typeof row.run.sessionId === "string" && typeof row.run.requestId === "string" && typeof row.run.attempt === "number"
            ? row.run.sessionId
            : null,
        questions: openQuestions(row),
      });
    }
    if (body.nextCursor === undefined || body.nextCursor === null || body.nextCursor === cursor) break;
    cursor = body.nextCursor;
  }
  return rows;
}

async function readStore(api: LabApi, userId: string): Promise<Store> {
  // The inventory's seats, by their published key pattern, through the first
  // of the person's own sessions whose flow declares it.
  let host: string | undefined;
  for (const sessionId of await topLevelSessions(api, userId)) {
    if ((await declaredBy(api, sessionId)).some((r) => r.kind === "collection" && r.pattern === "inventory/workers/*")) {
      host = sessionId;
      break;
    }
  }
  const declared = host === undefined ? [] : await declaredBy(api, host);
  const workersRef = declared.find((r) => r.kind === "collection" && r.pattern === "inventory/workers/*")?.ref;
  const seats = workersRef === undefined || host === undefined ? [] : (await api.collection(host, workersRef)).map((r) => String(r.id));

  const rows = await conversationRows(api, userId);

  // Pending person-asks: a suspension with no resume, on a session that names a seat as its worker.
  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&limit=500`);
  const seatSet = new Set(seats);
  const asks: string[] = [];
  for (const session of (listing.sessions ?? []) as Array<Record<string, any>>) {
    if (!seatSet.has(String(session.state?.workerId))) continue;
    const found = await api.items(String(session.id), ["suspension", "suspension_resume"]);
    const resumed = new Set(found.filter((i) => i.type === "suspension_resume").map((i) => String(i.suspensionId)));
    for (const item of found) {
      if (item.type === "suspension" && PERSON_REASONS.has(String(item.reason)) && !resumed.has(String(item.suspensionId))) {
        asks.push(String(item.suspensionId));
      }
    }
  }
  // Project rows, through the person's roster session at org scope.
  const reader = await rosterSession(api, userId);
  const readerManifest = reader === undefined ? undefined : await api.get(`/sessions/${encodeURIComponent(reader)}/manifest`);
  const projectsRef = (readerManifest?.resources as Array<{ kind: string; ref: string; pattern: string; scope?: string }> | undefined)?.find(
    (r) => r.kind === "collection" && r.pattern === "projects/*" && r.scope === "org",
  )?.ref;
  const projects =
    projectsRef === undefined || reader === undefined
      ? []
      : (await api.collection(reader, projectsRef)).map((r) => ({ id: String(r.id) }));
  const questions = Object.values(rows).flat().flatMap((row) => row.questions);
  return { seats, rows, asks, questions, projects };
}

// ---- putting a row on each board ---------------------------------------------

/** POST an action and wait for its request to finish. */
async function act(api: LabApi, flowId: string, sessionId: string, action: string, input: unknown, userId: string) {
  const posted = await api.call("POST", `/${encodeURIComponent(flowId)}/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(action)}`, {
    userId,
    input,
  });
  if (posted.status !== 202) throw new Error(`${action} on ${sessionId}: ${posted.status} ${JSON.stringify(posted.body)}`);
  const requestId = String(posted.body?.request?.id);
  for (let waited = 0; waited < 30_000; waited += 100) {
    const { body } = await api.call("GET", `/${encodeURIComponent(flowId)}/requests/${encodeURIComponent(requestId)}/status`);
    if (body?.status !== "in_progress") return String(body?.status);
    await sleep(100);
  }
  return "in_progress";
}

/** A stored row's open questions, by hold id: a row hold on a running row that no steer answers. */
function openQuestions(row: Record<string, any>): string[] {
  if (row.status !== "in_progress" || !Array.isArray(row.questions)) return [];
  const answered = new Set(((row.steers ?? []) as Array<{ answers?: string }>).flatMap((s) => (typeof s.answers === "string" ? [s.answers] : [])));
  return (row.questions as Array<{ id: string; source?: { kind?: string } }>).filter((h) => h.source?.kind === "row" && !answered.has(h.id)).map((h) => h.id);
}

/** Wait until a conversation's board holds a row, or give up. */
async function waitForRow(api: LabApi, predicate: (row: Store["rows"][string][number]) => boolean, userId: string) {
  for (let waited = 0; waited < 30_000; waited += 250) {
    const store = await readStore(api, userId);
    if (Object.values(store.rows).flat().some((r) => predicate(r))) return true;
    await sleep(250);
  }
  return false;
}

// ---- the page ----------------------------------------------------------------

const attr = async (page: Page, testId: string, name: string) =>
  (await page.getByTestId(testId).evaluateAll((els, n) => els.map((e) => e.getAttribute(n) ?? ""), name)) as string[];

async function open(page: Page, origin: string, path: string) {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 20_000 });
  // The sidebar's counts read "…" until the refresh lands.
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"));
}

async function visible(page: Page, testId: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.getByTestId(testId).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

// ---- one Lab -----------------------------------------------------------------

async function checkLab(name: LabName, pages: string, failures: string[], evidence: string[]): Promise<void> {
  const fail = (leg: string, why: string) => failures.push(`[${name}] ${leg}: ${why}`);
  const tree = await readTree(LABS[name].tree);
  const outbox = join(SCRATCH, `${name}-work.ndjson`);
  const served = await startLab(
    name,
    pages,
    // DevTeam on a fresh store each run, for a profile whose store outlives the process.
    name === "multi-seat-collab" ? { MULTI_WORKER_COLLAB_OUTBOX: outbox } : { DEVTEAM_STORE: join(SCRATCH, `devteam-${RUN_STAMP}.sqlite`) },
  );
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(served.origin);
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as {
      userId?: string;
      bearerToken?: string;
    } | null;
    const userId = injected?.userId;
    if (userId === undefined) throw new Error(`${name}: the page was handed no userId`);
    const api = labApi(served.origin, injected?.bearerToken);
    /** The task frame a click just opened: titled as stored, with a panel slot, and every tab drawing. */
    const reachTaskFrame = async (row: Store["rows"][string][number], titleLeg: string) => {
      await page.getByTestId("task-frame").waitFor();
      const title = await page.getByTestId("task-title").textContent();
      if (title !== row.title) fail(titleLeg, `the task frame titles ${row.id} "${title}", stored "${row.title}"`);
      if (!(await visible(page, "task-panel-slot"))) fail("reach", `the task frame for ${row.id} has no panel slot`);
      for (const tab of ["session", "diff", "checks", "brief"]) {
        await page.locator(`[role=tab][data-tab=${tab}]`).click();
        if (!(await visible(page, "task-slot"))) fail("reach", `the task frame's ${tab} tab shows nothing`);
      }
    };

    // Put a row on the board, through the Lab's own actions.
    let workstream: { project: string; id: string; session: string; lead: string } | undefined;
    if (name === "multi-seat-collab") {
      const labTree = await readLabTree();
      const scenario = new Scenario(
        { origin: served.origin, workDir: served.workDir, outbox, log: served.log, stop: () => served.child.kill("SIGTERM"), exited: () => served.exited } satisfies ServedLab,
        labTree,
        // The app's own desk -> delegate map; this goal's controls are Shift Manager's, not the filer's.
        routesFor(""),
      );
      await scenario.open();
      const filed = await scenario.file(fixture.multiSeatCollab);
      if (filed.status !== "completed" || filed.output?.ok !== true) {
        throw new Error(`${name}: the planner's filing ended ${filed.status ?? filed.refusal}: ${JSON.stringify(filed.output)}`);
      }
      // The planner's board hands the row to its worker at once, and the worker holds it on its question.
      if (!(await waitForRow(api, (r) => r.questions.length > 0, userId))) throw new Error(`${name}: the filed row never held on its question`);
    } else {
      // The person opens a workstream in the organization's first project, led
      // by the tree's EM, through the projects flow Shift Manager opens one
      // with; then files one feature on that workstream session's board through
      // the EM's own `file` door, where it runs at once; then a follow-up waiting on it, queued.
      const roster = await readDeclaredRoster(LABS.devteam.tree);
      const lead = roster.workers.find((w) => w.declared.flow === EM_FLOW)?.id;
      if (lead === undefined) throw new Error(`${name}: the tree declares no worker on the "${EM_FLOW}" flow to lead a workstream`);
      const project = (await readStore(api, userId)).projects[0]?.id;
      if (project === undefined) throw new Error(`${name}: the Lab holds no project to open a workstream in`);
      const projects = await api.call("POST", `/${PROJECTS_FLOW}/sessions`, { userId });
      if (projects.status !== 201) throw new Error(`${name}: no ${PROJECTS_FLOW} session: ${projects.status} ${JSON.stringify(projects.body)}`);
      const address = { visibility: "shared", id: project };
      const openedStatus = await act(api, PROJECTS_FLOW, String(projects.body.session.id), "openWorkstream", { project: address, id: WORKSTREAM, title: "Feature", lead }, userId);
      if (openedStatus !== "completed") throw new Error(`${name}: opening ${project}'s ${WORKSTREAM} ended ${openedStatus}`);
      const session = (await api.get(`/sessions?userId=${encodeURIComponent(userId)}&include=dispatch-runs&flowKind=${encodeURIComponent(EM_FLOW)}&state.workstreamId=${encodeURIComponent(`shared/${project}/${WORKSTREAM}`)}`)).sessions?.[0]?.id;
      if (typeof session !== "string") throw new Error(`${name}: opening ${project}'s ${WORKSTREAM} made no workstream session of ${userId}'s`);
      const status = await act(api, EM_FLOW, session, "file", { issue: fixture.devteam.issue, goal: fixture.devteam.text }, userId);
      if (status !== "completed") throw new Error(`${name}: the filing ended ${status}`);
      if (!(await waitForRow(api, () => true, userId))) throw new Error(`${name}: the filing put no row on a board`);
      // A second piece that waits on the first, dispatched through the board's own task door:
      // the board hands a dispatched row on as soon as it can start, so only one with an
      // unfinished dependency stays queued, and Tasks needs one to hide.
      const first = Object.values((await readStore(api, userId)).rows).flat()[0]!;
      const followUp = await act(
        api,
        EM_FLOW,
        session,
        "createTask_tasks",
        {
          goal: fixture.devteam.followUp.text,
          assignee: first.assignee ?? undefined,
          deps: [first.id],
          input: { harnessFeature: { issue: fixture.devteam.followUp.issue, phase: PHASE } },
        },
        userId,
      );
      if (followUp !== "completed") throw new Error(`${name}: filing the follow-up ended ${followUp}`);
      if (!(await waitForRow(api, (r) => r.status === "pending" || r.status === "held", userId))) throw new Error(`${name}: the follow-up is not queued on the board`);
      workstream = { project, id: WORKSTREAM, session, lead };
    }

    const store = await readStore(api, userId);
    const storedRows = Object.values(store.rows).flat();
    const key = (r: { ref: string; id: string }) => `${r.ref}/${r.id}`;

    // ---- store: the store holds what the tree declares --------------------
    if (!same(store.seats, tree.seats)) fail("store", `the inventory's seats are not the tree's: ${diff(tree.seats, store.seats)}`);
    if (storedRows.length === 0) fail("store", "no board holds a row, so the board legs would grade nothing");

    await open(page, served.origin, "/inbox");

    // ---- TEAMS: one status square per seat, under its team's row -------------
    const shownSeats = await attr(page, "worker", "data-worker-id");
    if (!same(shownSeats, store.seats)) fail("TEAMS equals the store's seats", diff(store.seats, shownSeats));
    for (const team of await attr(page, "team", "data-team")) {
      const under = await page.locator(`[data-testid=team][data-team="${team}"] [data-testid=worker]`).evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-worker-id") ?? ""),
      );
      // A worker with no team (an org worker) sits in the General row (id `_general`).
      const want = store.seats.filter((s) => (s.includes(".") ? s.split(".")[0] : "_general") === team);
      if (!same(under, want)) fail("TEAMS equals the store's seats", `team ${team} lists ${diff(want, under)}`);
    }

    // ---- Inbox ---------------------------------------------------------------
    const inboxItems = await page.getByTestId("inbox-item").count();
    // Each pending ask and each open question is one Inbox item.
    const pending = store.asks.length + store.questions.length;
    if (pending === 0) {
      const want = emptyInbox(store);
      const said = (await visible(page, "inbox-empty", 3_000)) ? await page.getByTestId("inbox-empty").textContent() : null;
      if (said !== want) fail("Inbox equals the store's pending asks", `no ask is pending and Inbox says ${said === null ? "nothing" : `"${said}"`}, the store gives "${want}"`);
    } else if (inboxItems !== pending) {
      fail("Inbox equals the store's pending asks", `${inboxItems} listed, ${store.asks.length} asks and ${store.questions.length} questions pending in the store`);
    }
    evidence.push(`${name}: inbox ${inboxItems} listed / ${store.asks.length} asks + ${store.questions.length} questions pending`);

    // ---- Tasks ---------------------------------------------------------------
    await page.getByTestId("nav-tasks").click();
    await page.getByTestId("tasks").waitFor();
    const openRows = storedRows.filter((r) => !DONE.has(r.status));
    const open_ = openRows.map(key);
    // Queued rows are hidden until the toggle is on, and the toggle says how many.
    const inFlight = openRows.filter((r) => !QUEUED(r.status)).map(key);
    const queuedCount = open_.length - inFlight.length;
    for (const queued of [false, true]) {
      if (queued) await page.getByTestId("tasks-queued-toggle").click();
      for (const grouping of ["state", "worker", "stream"]) {
        await page.locator(`[role=tab][data-grouping=${grouping}]`).click();
        await page.locator(`[role=tab][data-grouping=${grouping}][aria-selected=true]`).waitFor();
        if (open_.length === 0) {
          if (!(await visible(page, "tasks-empty", 3_000))) fail("Tasks equals the store's open rows", "no open row and the empty state is not named");
          continue;
        }
        const shown = (await page.getByTestId("task-row").evaluateAll((els) =>
          els.map((e) => `${e.getAttribute("data-board-ref")}/${e.getAttribute("data-task-id")}`),
        )) as string[];
        const want = queued ? open_ : inFlight;
        if (!same(shown, want)) fail("Tasks equals the store's open rows", `grouped by ${grouping}, queued ${queued ? "shown" : "hidden"}: ${diff(want, shown)}`);
      }
      if (open_.length === 0) break;
      const count = await page.getByTestId("tasks-queued-count").textContent();
      if (count !== String(queuedCount)) fail("Tasks equals the store's open rows", `the Queued toggle says ${count}, the store holds ${queuedCount} queued row(s)`);
    }

    // ---- Shift Coordinator, where the Lab lands -----------------------------------
    await page.getByTestId("nav-shift-coordinator").click();
    if (!(await visible(page, "shift-coordinator"))) fail("reach", "Shift Coordinator does not open");
    if (!(await visible(page, "shift-coordinator-summary"))) fail("reach", "Shift Coordinator draws no shift summary");
    if (!(await visible(page, "shift-coordinator-panel"))) fail("reach", "Shift Coordinator has no right panel");

    // ---- each conversation's board: its task level is reached from Tasks ----
    for (const holder of Object.keys(store.rows)) {
      const first = store.rows[holder]![0]!;
      await open(page, served.origin, "/tasks");
      await page.getByTestId("tasks-queued-toggle").click();
      await page.locator(`[data-testid=task-row][data-board-ref="${first.ref}"][data-task-id="${first.id}"]`).click();
      await reachTaskFrame(first, "Tasks equals the store's open rows");
    }

    // ---- a workstream the person opened: its entry, and its lead's board ------
    if (workstream !== undefined) {
      const { project, id, session } = workstream;
      await open(page, served.origin, `/p/${encodeURIComponent(project)}/workstreams`);
      const entry = page.locator(`[data-testid=project-entry][data-owner="${userId}"][data-workstream-id="${id}"]`);
      if (!(await entry.first().waitFor({ timeout: 15_000 }).then(() => true, () => false))) {
        const drawn = await page.locator("[data-testid=project-entry]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-owner")}/${e.getAttribute("data-workstream-id")}`));
        fail("a workstream shows its entry", `${project}'s Workstreams lists [${drawn.join(", ")}], not ${userId}/${id}`);
      }
      await open(page, served.origin, `/p/${encodeURIComponent(project)}/board`);
      const lane = page.locator(`[data-testid=project-lane][data-session-id="${session}"]`);
      const filed = store.rows[session] ?? [];
      if (filed.length === 0) fail("its owner sees the lead's board", `the store holds no row on ${id}'s session ${session}`);
      if (!(await lane.first().waitFor({ timeout: 15_000 }).then(() => true, () => false))) {
        fail("its owner sees the lead's board", `${project}'s Board draws no lane for ${id}'s session ${session}`);
      } else {
        await lane.locator("[data-testid=shift-coordinator-task], [data-testid=shift-coordinator-tasks-empty], [data-testid=shift-coordinator-tasks-failure]").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
        const drawn = await lane.locator("[data-testid=shift-coordinator-task]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-task-id")}:${e.getAttribute("data-status")}`));
        const want = filed.map((r) => `${r.id}:${r.status}`);
        if (!same(drawn, want)) fail("its owner sees the lead's board", `${id}'s lane: ${diff(want, drawn)}`);
      }
    }

    // ---- post: the composer, on the workstream entry or an open row ---------
    const line = `${fixture.line} (${name} ${RUN_STAMP})`;
    let kept: number;
    if (workstream !== undefined) {
      // A workstream the person opened: its page is the conversation with its
      // lead, in its session, sent through the lead's door. The composer's line
      // is drawn, and the session holds it once, across a reload.
      const path = `/p/${encodeURIComponent(workstream.project)}/workstreams?owner=${encodeURIComponent(userId)}&ws=${encodeURIComponent(workstream.id)}`;
      await open(page, served.origin, path);
      const input = page.getByTestId("project-entry-composer-input");
      await input.waitFor({ timeout: 15_000 });
      await input.fill(line);
      await page.getByTestId("project-entry-composer-send").click();
      const drawn = page.locator("[data-testid=project-entry-item][data-role=user]").filter({ hasText: line });
      try {
        await drawn.first().waitFor({ timeout: 30_000 });
      } catch {
        fail("the post appears on screen", `"${line}" was never drawn (${(await page.getByTestId("project-entry-composer-status").textContent().catch(() => null)) ?? ""})`);
      }
      kept = (await api.items(workstream.session, ["message"])).filter((i) => i.role === "user" && JSON.stringify(i.content ?? i.text ?? i).includes(line)).length;
      if (kept !== 1) fail("the post is in the stored transcript", `the workstream session ${workstream.session} holds ${kept} copies of "${line}"`);
      await open(page, served.origin, path);
      await page.getByTestId("project-entry-item").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
      if ((await drawn.count()) !== 1) fail("the post is in the stored transcript", `after a reload "${line}" is drawn ${await drawn.count()} times`);
    } else {
      // A tree with no workstream has no workstream composer: the post goes
      // through the task composer on a conversation's open row, into the
      // session the row names as its run. The composer saying *delivered* is
      // what is drawn; one user line in that session is what is stored.
      const target = Object.values(store.rows).flat().find((r) => !DONE.has(r.status) && r.runSession !== null);
      if (target === undefined) throw new Error(`${name}: no open row names a run to post into`);
      await open(page, served.origin, `/tasks/${encodeURIComponent(target.ref)}/${encodeURIComponent(target.id)}/session`);
      const input = page.getByTestId("task-composer-input");
      await input.waitFor();
      const enabled = await page
        .waitForFunction(() => !(document.querySelector("[data-testid=task-composer-input]") as HTMLTextAreaElement | null)?.disabled, undefined, { timeout: 20_000 })
        .then(() => true, () => false);
      if (!enabled) {
        kept = 0;
        fail("the post appears on screen", `the task composer for ${target.id} never opens: ${(await page.getByTestId("task-composer-blocked").textContent().catch(() => null)) ?? "no reason given"}`);
      } else {
        await input.fill(line);
        await page.getByTestId("task-composer-send").click();
        try {
          await page.locator("[data-testid=task-composer-status][data-state=delivered]").waitFor({ timeout: 30_000 });
        } catch {
          fail("the post appears on screen", `the task composer never said "${line}" was delivered (${(await page.getByTestId("task-composer-status").textContent()) ?? ""})`);
        }
        kept = (await api.items(target.runSession!, ["message"])).filter((i) => i.role === "user" && JSON.stringify(i.content ?? i.text ?? i).includes(line)).length;
        if (kept !== 1) fail("the post is in the stored transcript", `the run session ${target.runSession} holds ${kept} copies of "${line}"`);
      }
    }

    // ---- answer: an ask approved from Inbox is resumed in the store, and leaves Inbox ----
    // A Lab holding any pending ask must offer at least one to answer where
    // Inbox draws it: pick the first whose card has an enabled Approve. None
    // at all is a failure.
    let answered = "no ask to answer";
    if (store.asks.length > 0) {
      let picked: string | null = null;
      await open(page, served.origin, "/inbox");
      const items = page.getByTestId("inbox-item");
      for (let i = 0; i < (await items.count()) && picked === null; i += 1) {
        await items.nth(i).click();
        const approve = page.getByTestId("inbox-detail").getByRole("button", { name: "Approve" });
        await approve.first().waitFor({ timeout: 5_000 }).catch(() => undefined);
        if ((await approve.count()) > 0 && !(await approve.first().isDisabled())) {
          picked = await items.nth(i).getAttribute("data-suspension-id");
          await approve.first().click();
        }
      }
      if (picked === null) {
        fail("an answer lands in the store", `${store.asks.length} ask(s) pending and Inbox offers an answer on none`);
        answered = "no ask answerable";
      } else {
        let left = store.asks;
        for (let waited = 0; waited < 20_000 && left.includes(picked); waited += 250) {
          await sleep(250);
          left = (await readStore(api, userId)).asks;
        }
        if (left.includes(picked) || left.length !== store.asks.length - 1) {
          fail("an answer lands in the store", `${store.asks.length} pending before Approve, ${left.length} after, the approved one ${left.includes(picked) ? "still" : "no longer"} pending`);
        }
        // The answer clears it from Inbox: both draw the same pending asks.
        await open(page, served.origin, "/inbox");
        const listed = await page.locator(`[data-testid=inbox-item][data-suspension-id="${picked}"]`).count();
        if (listed !== 0) fail("an answer leaves Inbox", `the approved ask is still listed in Inbox`);
        answered = `approved 1 of ${store.asks.length}, ${left.length} left in the store, ${listed} listed in Inbox`;
      }
    }

    if (pageErrors.length > 0) fail("reach", `the page threw: ${pageErrors.join(" | ")}`);
    evidence.push(
      `${name}: ${store.seats.length} seats, ${storedRows.length} row(s) [${storedRows.map((r) => r.status).join(", ")}], post kept ${kept}, ${answered}`,
    );
  } finally {
    await browser.close();
    served.child.kill("SIGTERM");
    await served.exited;
  }
}

await runGoal(async (failures) => {
  const pages = await buildShiftManager(CONTROL);
  const evidence: string[] = [];
  for (const name of Object.keys(LABS) as LabName[]) {
    await checkLab(name, pages, failures, evidence);
  }
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its command over both goal Labs; every level walked in Chromium and graded against each tree on disk and each store read through the Lab's routes. ${evidence.join("; ")}`,
  };
});
