/**
 * Goal check: Shift Manager groups a Lab's workstreams under its projects,
 * each project's four tabs show that project's work as the person reading it
 * sees it, and the workstreams people open in a project are everyone's to read
 * and each one's own to write.
 *
 * Real path, out of CI. The screens, entries, race and restart legs need no
 * model; the cos leg runs the chief of staff on a real one. See goal.md for
 * the contract.
 *
 * Built like `it-opens-a-lab`: Shift Manager is built with Vite into a scratch
 * directory and served by its own command over the DevTeam profile, whose
 * config creates the default projects at boot. Graded against the tree on
 * disk and the Lab's store, read through its HTTP routes:
 *
 *   screens  Chromium, as the projects' owner, after the owner made one private
 *            project over HTTP. PROJECTS equals the shared rows, then the
 *            owner's private ones, then No project; the boot's workstreams
 *            show in their project; every project's four tabs show
 *            it: Stream is the owner's own project coordinator for that
 *            project, Workstreams its entries with their progress, Board the
 *            owner's own workstream sessions in it, Brief its brief. No gap
 *            copy is reached.
 *   entries  Chromium, as the owner and the member, each in their own page,
 *            on a real model. Each asks their project coordinator for work in
 *            a shared project's Stream; Workstreams draws no form. The store
 *            then holds one entry per asker, led by one of the tree's leads
 *            (the EM or the general lead), with the ask in its session and nothing added to the
 *            asker's roster, and both pages list both entries with progress
 *            counting them; each Board draws only its
 *            viewer's own; each Stream is its viewer's own coordinator; the
 *            member's PROJECTS leaves out the owner's private project. Over
 *            HTTP, the outsider reads the entries and its own open is refused.
 *   race     HTTP. Every member opens the same workstream id in one project,
 *            each from several sessions at once, then sends several updates
 *            to it at once, each changing a different field. Every write
 *            completes, each member holds one entry with one session, and
 *            every field lands.
 *   restart  the Lab stopped and started on the same store: every project row,
 *            shared and private, and every entry is as it was.
 *   cos      HTTP, as the member, on a real model. Asked for two projects, the
 *            chief of staff creates them, each owned by the person who asked:
 *            the first a shared row with them and whoever they named as
 *            members; the second, "just for me", either their private project
 *            or a shared row only they are on. Runs last, after the restart:
 *            its rows are the member's, and the other legs grade every shared
 *            row as the owner's.
 *
 * Every run, the plain one and each control, serves the Lab with its checked
 * store writes held up to WRITE_LATENCY_MS (`packages/shift-manager/teams/devteam/write-latency.mts`)
 * and releases each burst from a barrier, so the bursts really race.
 *
 * Legs: `GOAL_LEG=model-free` runs screens, the outsider, race and restart,
 * `GOAL_LEG=cos` runs cos; unset runs them all, entries included: a
 * workstream opens when its owner asks their project coordinator, whose turn
 * runs on its own model.
 *
 * Controls (each must fail; the run fails if a swap never fired):
 *
 *   unread    the page's grouping ignores the rows (Vite swap of derive.ts).
 *             Must fail at "PROJECTS equals the store's rows".
 *   gap-tabs  the project level as it was before projects (Vite swap of
 *             Project.tsx). Must fail at "a project's four tabs".
 *   no-gate   the membership check answers yes for everyone (Node swap of
 *             membership-gate.ts in the served Lab). Must fail at "the
 *             outsider's open is refused".
 *   no-retry  the projects' own retry removed (Node swap of cas-retry.ts).
 *             Must fail at "a write race lands whole".
 *   in-memory the profile's store kept in memory (Node swap of store-sqlite's
 *             index.ts). Must fail at "a restart keeps the projects and their
 *             entries".
 *   no-tool   the chief of staff without its project tools, as before it had
 *             them (Node swap of the lab's host.mts). Must fail at "cos".
 *   drop-solo a create of a project the asker holds alone answers as if it
 *             wrote it and writes nothing (Node swap of project-writes.ts).
 *             Must fail at "cos" on the second project. Runs with
 *             `GOAL_LEG=cos` only: the screens leg's private project is such
 *             a create.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-groups-workstreams-under-their-projects/run.mts
 * Control:  GOAL_CONTROL=no-gate <the same>
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, intentFreeEnv, keysServing, loadFixture, runGoal } from "../../lib/index.mts";
import { SHIFT_MANAGER_COMMAND, devteamCosModel, personPage, servedAddresses } from "../../lib/shift-manager.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { LAB_CROWD, LAB_USERS, PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["unread", "gap-tabs", "no-gate", "no-retry", "in-memory", "no-tool", "drop-solo"] as const;
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
  console.error(`control ${CONTROL} grades the cos leg, which GOAL_LEG=model-free leaves out`);
  process.exit(2);
}
if (CONTROL === "drop-solo" && LEG !== "cos") {
  console.error("control drop-solo runs with GOAL_LEG=cos only: it also drops the private project the screens leg creates");
  process.exit(2);
}

type Changes = { title?: string; status?: string; due?: string; objectives?: Array<{ text: string; met: boolean }> };

const fixture = loadFixture<{
  privateProject: { title: string; brief: string };
  opened: { owner: string; member: string };
  race: { id: string; title: string; opens: number; copies: number; changes: Changes[] };
  cos: { ask: string; titles: [string, string] };
}>(import.meta.url);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SHIFT_MANAGER = join(REPO_ROOT, "packages", "shift-manager");
const PROJECTS_SRC = join(REPO_ROOT, "packages", "workforce", "src", "projects");
const SQLITE_SRC = join(REPO_ROOT, "packages", "store-sqlite", "src", "index.ts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("shift-manager-projects");
const CONFIG = join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts");
const TREE = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam", "workforce");
const LAB_HOST = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam", "host.mts");
/** The most a checked store write is held before it lands. */
const WRITE_LATENCY_MS = 30;
/** The seat Shift Manager finds the chief of staff by. */
const COS = "chief-of-staff";
/** How long one turn of the chief of staff may take: a real model answers it. */
const COS_TURN_MS = 180_000;
/** The flow a person reads their roster, their projects and their entries through. */
const ROSTER_FLOW = "workforce-roster";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diff = (want: Iterable<string>, got: Iterable<string>) => {
  const w = new Set(want);
  const g = new Set(got);
  return `missing [${[...w].filter((x) => !g.has(x)).join(", ")}], extra [${[...g].filter((x) => !w.has(x)).join(", ")}]`;
};

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
  if (control === "drop-solo") return { target: join(PROJECTS_SRC, "project-writes.ts"), with: join(HERE, "controls", "drop-solo.ts") };
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
 * Shift Manager's command over the DevTeam profile, on the store file at
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
  const child = spawn(TSX, [SHIFT_MANAGER_COMMAND, "--config", CONFIG, "--port", "0", "--no-open", "--assets", pages], {
    cwd: workDir,
    // A fresh store per run, for a profile whose store outlives the process;
    // the restart opens the same one. Every run, the plain one and each control, holds the store's checked writes
    // (`write-latency.mts`), so the bursts really race and a PASS means the writes absorbed it.
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
    const served = servedAddresses(log);
    if (served !== undefined) {
      if (!log.includes(`holding checked store writes up to ${WRITE_LATENCY_MS}ms`)) {
        child.kill("SIGTERM");
        throw new Error("the Lab did not hold its store writes, so the bursts would not race");
      }
      return { origin: served.origin, child, log: () => log, exited };
    }
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's command never served DevTeam. Log tail:\n${log.slice(-2000)}`);
}

// ---- the Lab's routes, as one verified user ----------------------------------

type Settled = { status: string; output: any; error: string | undefined };
type Item = { topic: string; storageKey?: string; clientData?: Record<string, any> };

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
  /** Every item of a collection, through one session, page by page. */
  const items = async (sessionId: string, ref: string): Promise<Item[]> => {
    const out: Item[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const body = await get(
        `/sessions/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      out.push(...((body.items ?? []) as Item[]));
      if (body.nextCursor === undefined || body.nextCursor === null || body.nextCursor === cursor) break;
      cursor = body.nextCursor;
    }
    return out;
  };
  /** Every row of a collection, through one session. */
  const collection = async (sessionId: string, ref: string): Promise<Array<Record<string, any>>> => (await items(sessionId, ref)).map((i) => i.clientData ?? {});
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
  /** This user's own sessions, dispatch runs included, by id. */
  const sessions = async (): Promise<Array<{ id: string; flowKind: string }>> =>
    ((await get(`/sessions?userId=${encodeURIComponent(user.userId)}&include=dispatch-runs`)).sessions ?? []) as Array<{ id: string; flowKind: string }>;
  /** This user's own session on the roster flow, which reads their projects, entries and workers; made once. */
  let reader: Promise<string> | undefined;
  const readerSession = () => (reader ??= createSession(ROSTER_FLOW));
  return { user, call, get, items, collection, createSession, act, sessions, readerSession };
}
type LabApi = ReturnType<typeof labApi>;

// ---- what the tree and the store hold ---------------------------------------

type Visibility = "shared" | "private";
type Row = { id: string; title: string; brief: string | null; ownerUserId: string; members: string[]; repository?: string | null };
/** A project as a person reads it: where it lives, and its row. */
type Held = { visibility: Visibility; row: Row };
type Entry = {
  key: string;
  owner: string;
  id: string;
  title: string;
  lead: string;
  sessionId: string | null;
  status: string;
  due: string | null;
  objectives: Array<{ text: string; met: boolean }>;
  openedAt: string;
  updatedAt: string;
};
/**
 * The Lab's project setup, as its projects flow answers `projectSetup`; the
 * workers the tree declares that can lead a workstream: on a lead flow
 * (`agent` or `em`), listing delegates; and of them the EM, the lead the boot
 * opens its workstreams under and the HTTP legs open theirs under.
 */
type Setup = { projectCoordinator: string; coordinatorFlow: string; leads: string[]; lead: string };

/** The flow a standard worker runs on, as its file names it. */
async function flowOf(worker: string): Promise<string> {
  const roster = await readDeclaredRoster(TREE);
  const flow = roster.workers.find((w) => w.id === worker)?.declared.flow;
  if (typeof flow !== "string") throw new Error(`the tree declares no "${worker}" with a flow`);
  return flow;
}

/**
 * The workers the tree declares that can lead a workstream (on `agent` or `em`,
 * listing delegates), and the one of them on `em`: the EM, as the profile's
 * boot finds it.
 */
async function leadsOf(): Promise<{ leads: string[]; lead: string }> {
  const roster = await readDeclaredRoster(TREE);
  const leads = roster.workers.filter(
    (w) => ["agent", "em"].includes(String(w.declared.flow)) && Array.isArray(w.declared.delegates) && w.declared.delegates.length > 0,
  );
  const ems = leads.filter((w) => w.declared.flow === "em");
  if (ems.length !== 1) throw new Error(`the tree declares ${ems.length} leads on the em flow (${ems.map((w) => w.id).join(", ")}), not one`);
  return { leads: leads.map((w) => w.id), lead: ems[0]!.id };
}

/** The Lab's project setup: the standard worker behind a project, as the Lab names it, and the tree's leads. */
async function readSetup(owner: LabApi): Promise<Setup> {
  const session = await owner.createSession(PROJECTS_FLOW);
  const answered = await owner.act(PROJECTS_FLOW, session, "projectSetup", {});
  const { projectCoordinator } = (answered.output ?? {}) as { projectCoordinator?: unknown };
  if (answered.status !== "completed" || typeof projectCoordinator !== "string") {
    throw new Error(`the Lab names no project setup: ${answered.status} ${JSON.stringify(answered.output ?? answered.error)}`);
  }
  return { projectCoordinator, coordinatorFlow: await flowOf(projectCoordinator), ...(await leadsOf()) };
}

/** The collection ref a session's manifest publishes for a key pattern at a scope. */
async function refOf(api: LabApi, sessionId: string, test: (pattern: string) => boolean, scope: "org" | "user"): Promise<string | undefined> {
  const manifest = await api.get(`/sessions/${encodeURIComponent(sessionId)}/manifest`);
  return (manifest.resources as Array<{ kind: string; ref: string; pattern: string; scope?: string }>).find((r) => r.kind === "collection" && test(r.pattern) && r.scope === scope)?.ref;
}

/** The organization's shared project rows, read through the person's roster session by their published key pattern. */
async function sharedRows(api: LabApi): Promise<Row[]> {
  const reader = await api.readerSession();
  const ref = await refOf(api, reader, (p) => p === "projects/*", "org");
  return ref === undefined ? [] : ((await api.collection(reader, ref)) as Row[]);
}

/**
 * The inventory's mailboxes, read through the person's roster session (none
 * when it publishes no inventory: the DevTeam tree declares no mailbox), and
 * the shared project rows.
 */
async function readStore(api: LabApi): Promise<{ mailboxes: string[]; rows: Row[] }> {
  const reader = await api.readerSession();
  const mailboxesRef = await refOf(api, reader, (p) => p === "inventory/mailboxes/*", "org");
  return {
    mailboxes: mailboxesRef === undefined ? [] : (await api.collection(reader, mailboxesRef)).map((r) => String(r.id)),
    rows: await sharedRows(api),
  };
}

/**
 * A person's private projects: the user-scope `projects/*` collection a
 * session they own publishes, read through it as them. `undefined` when the
 * session publishes none.
 */
async function privateRows(api: LabApi, sessionId: string): Promise<Row[] | undefined> {
  const ref = await refOf(api, sessionId, (p) => p === "projects/*", "user");
  return ref === undefined ? undefined : ((await api.collection(sessionId, ref)) as Row[]);
}

/** A project's address: where it lives, and its id. */
const at = (held: Held) => ({ visibility: held.visibility, id: held.row.id });

/** The projects a person reads: the organization's shared rows, then their own private ones. */
async function projectsOf(api: LabApi): Promise<Held[]> {
  const shared = (await sharedRows(api)).map((row) => ({ visibility: "shared" as const, row }));
  const own = ((await privateRows(api, await api.readerSession())) ?? []).map((row) => ({ visibility: "private" as const, row }));
  return [...shared, ...own];
}

/**
 * A project's workstream entries, as `api` reads them through its roster
 * session: every key `workstreams/<project>/~<owner>/<id>` of the collection
 * at the project's scope. The place is read off the key.
 */
async function entriesOf(api: LabApi, project: { visibility: Visibility; id: string }): Promise<Entry[]> {
  const reader = await api.readerSession();
  const ref = await refOf(api, reader, (p) => p.startsWith("workstreams/"), project.visibility === "private" ? "user" : "org");
  if (ref === undefined) throw new Error(`${api.user.userId}'s roster session publishes no workstreams collection at the ${project.visibility} scope`);
  const out: Entry[] = [];
  for (const item of await api.items(reader, ref)) {
    const key = item.storageKey ?? `workstreams/${item.topic}`;
    const [head, projectId, owner, id, ...rest] = key.split("/");
    if (head !== "workstreams" || projectId !== project.id || owner === undefined || !owner.startsWith("~") || id === undefined || rest.length > 0) continue;
    const d = item.clientData ?? {};
    out.push({
      key,
      owner: decodeURIComponent(owner.slice(1)),
      id,
      title: String(d.title),
      lead: String(d.lead),
      sessionId: typeof d.sessionId === "string" ? d.sessionId : null,
      status: String(d.status),
      due: typeof d.due === "string" ? d.due : null,
      objectives: Array.isArray(d.objectives) ? d.objectives.map((o: any) => ({ text: String(o.text), met: o.met === true })) : [],
      openedAt: String(d.openedAt),
      updatedAt: String(d.updatedAt),
    });
  }
  return out;
}

/** A person's own workers' ids: the rows of their roster, read through their roster session. */
async function ownWorkers(api: LabApi): Promise<string[]> {
  const reader = await api.readerSession();
  const ref = await refOf(api, reader, (p) => p === "workforce/workers/*", "user");
  if (ref === undefined) throw new Error(`${api.user.userId}'s roster session publishes no workforce/workers/*`);
  return (await api.items(reader, ref)).map((i) => i.topic.slice(i.topic.lastIndexOf("/") + 1));
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
  await page.getByTestId("shell").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"), undefined, { timeout: 30_000 });
}

/** A project's path in Shift Manager, at a tab. */
const projectPath = (held: Held, tab: string) => `/p/${held.visibility === "private" ? "private/" : ""}${encodeURIComponent(held.row.id)}/${tab}`;

/**
 * No tab shows a project gap: no tab-level `project-<tab>-empty` state, and no copy saying projects
 * arrive later. A Stream's conversation with no line yet (`project-stream-conversation-empty`) is
 * the conversation drawn, not a gap.
 */
async function gapReached(page: Page): Promise<string | undefined> {
  const gaps = ["brief", "workstreams", "board", "stream"].map((tab) => `[data-testid=project-${tab}-empty]`).join(", ");
  if ((await page.locator(gaps).count()) > 0) return "a project-*-empty state is drawn";
  const text = (await page.locator("main").textContent()) ?? "";
  return text.includes("FIX-1650") ? "copy naming FIX-1650 is drawn" : undefined;
}

/** PROJECTS as the page draws it: each group's address and the workstreams under it. */
async function sidebarGroups(page: Page): Promise<Array<{ id: string; streams: string[] }>> {
  await page.getByTestId("project-group").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return page.getByTestId("project-group").evaluateAll((els) =>
    els.map((g) => ({
      id: `${g.getAttribute("data-visibility") ?? ""}:${g.getAttribute("data-project-id") ?? ""}`,
      streams: [...g.querySelectorAll("[data-testid^=nav-workstream-]")].map((e) =>
        e.getAttribute("data-testid") === "nav-workstream-gone" ? `gone:${e.getAttribute("data-mailbox-id")}` : e.getAttribute("data-testid")!.slice("nav-workstream-".length),
      ),
    })),
  );
}

const showGroups = (gs: Array<{ id: string; streams: string[] }>) => gs.map((g) => `${g.id}[${g.streams.join(",")}]`).join(" ");

/**
 * PROJECTS as the store says `api`'s person should see it: their projects in
 * order, none listing a mailbox, then No project when the inventory holds a
 * mailbox workstream.
 */
async function wantedGroups(api: LabApi, mailboxes: readonly string[]): Promise<Array<{ id: string; streams: string[] }>> {
  const held = await projectsOf(api);
  return [
    ...held.map((h) => ({ id: `${h.visibility}:${h.row.id}`, streams: [] })),
    ...(mailboxes.length === 0 ? [] : [{ id: ":unassigned", streams: [...mailboxes] }]),
  ];
}

/** One person's Shift Manager page and their routes. */
type View = { who: string; page: Page; api: LabApi };

/**
 * The project's Stream: the person's own project coordinator for this
 * project. The conversation it draws names its session; that session is one
 * of the person's own, on the coordinator's flow, naming the project
 * coordinator as its worker and this project as its project.
 */
async function gradeStream(view: View, held: Held, setup: Setup, origin: string, fail: (leg: string, why: string) => void, leg: string): Promise<string | undefined> {
  const where = `${view.who}'s ${held.visibility} ${held.row.id} Stream`;
  await openPage(view.page, origin, projectPath(held, "stream"));
  // The conversation is drawn once its session is found or started; it names that session.
  const named = await view.page
    .waitForFunction(() => document.querySelector("[data-testid=project-stream-conversation]")?.getAttribute("data-session-id") || null, undefined, { timeout: 30_000 })
    .then((handle) => handle.jsonValue() as Promise<string>, () => undefined);
  if (named === undefined) {
    const drawn = await view.page.locator("[role=tabpanel] [data-testid]").evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-testid")));
    fail(leg, `${where} draws no coordinator conversation naming its session (drawn: ${drawn.join(", ") || "nothing"})`);
    return undefined;
  }
  const sessionId = named;
  const own = (await view.api.sessions()).find((s) => s.id === sessionId);
  if (own === undefined) {
    fail(leg, `${where} draws session ${sessionId}, which is not one of ${view.api.user.userId}'s own`);
    return undefined;
  }
  const state = ((await view.api.get(`/sessions/${encodeURIComponent(sessionId)}`)).session?.state ?? {}) as Record<string, unknown>;
  const project = `${held.visibility}/${held.row.id}`;
  if (own.flowKind !== setup.coordinatorFlow || state.workerId !== setup.projectCoordinator || state.projectId !== project) {
    fail(leg, `${where} draws session ${sessionId} on ${own.flowKind} naming worker ${String(state.workerId)} and project ${String(state.projectId)}, not ${setup.projectCoordinator} on ${setup.coordinatorFlow} for ${project}`);
    return undefined;
  }
  return sessionId;
}

/**
 * Every tab of one project, as `view`'s person reads it, graded against the
 * store read just before: Brief its brief; Workstreams its entries, with the
 * progress counted from them, and no mailbox list (a project lists none);
 * Board a lane for each of the person's own entries with a session, and no
 * one else's; Stream the person's own coordinator for the project.
 */
async function gradeTabs(view: View, held: Held, setup: Setup, origin: string, fail: (leg: string, why: string) => void): Promise<{ stream: string | undefined; entries: Entry[] }> {
  const leg = "a project's four tabs";
  const { page, api } = view;
  const row = held.row;
  const name = `${view.who}'s ${held.visibility} ${row.id}`;
  const entries = await entriesOf(api, at(held));
  const tab = async (tabName: string) => {
    await openPage(page, origin, projectPath(held, tabName));
    await page.locator(`[role=tab][data-tab=${tabName}][aria-selected=true]`).waitFor({ timeout: 10_000 });
  };
  const noGap = async (tabName: string) => {
    const gap = await gapReached(page);
    if (gap !== undefined) fail(leg, `${name}'s ${tabName}: ${gap}`);
  };

  await tab("brief");
  if (row.brief === null || row.brief === undefined) {
    if (!(await visible(page, "project-brief-none"))) fail(leg, `${name} has no brief and its Brief doesn't say so`);
  } else if (!(await visible(page, "project-brief"))) {
    fail(leg, `${name}'s Brief draws no brief`);
  } else {
    const drawn = ((await page.getByTestId("project-brief").textContent()) ?? "").trim();
    if (drawn !== row.brief.trim()) fail(leg, `${name}'s Brief draws "${drawn}", stored "${row.brief}"`);
  }
  await noGap("brief");

  await tab("workstreams");
  if (!(await visible(page, "project-progress", 15_000))) fail(leg, `${name}'s Workstreams draws no progress`);
  else {
    const count = Number(await page.getByTestId("project-progress").getAttribute("data-workstreams"));
    if (count !== entries.length) fail(leg, `${name}'s progress counts ${count} workstreams, the store holds ${entries.length}`);
    const objectives = entries.flatMap((e) => e.objectives);
    const met = `${objectives.filter((o) => o.met).length} of ${objectives.length} objectives met`;
    const drawnMet = ((await page.getByTestId("project-objectives").textContent()) ?? "").trim();
    if (drawnMet !== met) fail(leg, `${name}'s progress says "${drawnMet}", the entries hold ${met}`);
  }
  const wantEntries = entries.map((e) => `${e.owner}/${e.id}`);
  if (entries.length === 0) {
    if (!(await visible(page, "project-entries-none"))) fail(leg, `${name} holds no entry and its Workstreams doesn't say so`);
  } else {
    await visible(page, "project-entry");
    const owners = await attr(page, "[data-testid=project-entry]", "data-owner");
    const ids = await attr(page, "[data-testid=project-entry]", "data-workstream-id");
    const drawn = owners.map((o, i) => `${o}/${ids[i]}`);
    if (!same(drawn, wantEntries)) fail(leg, `${name}'s Workstreams entries: ${diff(wantEntries, drawn)}`);
  }
  const mailboxes = await attr(page, "[data-testid=project-workstream]", "data-mailbox-id");
  if (mailboxes.length > 0) fail(leg, `${name}'s Workstreams lists mailboxes, and a project lists none: ${mailboxes.join(", ")}`);
  await noGap("workstreams");

  await tab("board");
  const own = entries.filter((e) => e.owner === api.user.userId && e.sessionId !== null);
  if (own.length === 0) {
    if (!(await visible(page, "project-board-none"))) fail(leg, `${name}: the person holds no workstream there and its Board doesn't say so`);
  } else {
    await visible(page, "project-lane");
    const lanes = await attr(page, "[data-testid=project-lane]", "data-session-id");
    const want = own.map((e) => e.sessionId!);
    if (!same(lanes, want)) fail(leg, `${name}'s Board lanes (by session): ${diff(want, lanes)}`);
  }
  await noGap("board");

  const stream = await gradeStream(view, held, setup, origin, fail, leg);
  await noGap("stream");
  return { stream, entries };
}

// ---- the legs ----------------------------------------------------------------

/** The four tabs and PROJECTS, as the owner, over every project they read. */
async function screens(browser: Browser, origin: string, setup: Setup, owner: LabApi, fail: (leg: string, why: string) => void, evidence: string[]) {
  const { context, page, errors } = await personPage(browser, origin, owner.user, true);
  try {
    await page.goto(origin);
    const injected = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__ ?? null)) as { userId?: string } | null;
    if (injected?.userId !== owner.user.userId) throw new Error(`the page runs as ${injected?.userId}, not the projects' owner ${owner.user.userId}`);
    await openPage(page, origin, "/inbox");

    // ---- PROJECTS: shared rows, then the owner's private ones, then No project ----
    const want = await wantedGroups(owner, (await readStore(owner)).mailboxes);
    const groups = await sidebarGroups(page);
    if (showGroups(groups) !== showGroups(want)) fail("PROJECTS equals the store's rows", `the owner's drawn ${showGroups(groups) || "(nothing)"}, stored ${showGroups(want)}`);
    if (!want.some((g) => g.id.startsWith("private:"))) fail("store", "the owner reads no private project, so PROJECTS' private half grades nothing");

    // ---- every project's four tabs, and the boot's workstreams in theirs ------
    const held = await projectsOf(owner);
    const view: View = { who: "the owner", page, api: owner };
    const streams = new Map<string, string>();
    let booted: string | undefined;
    for (const h of held) {
      const { stream, entries } = await gradeTabs(view, h, setup, origin, fail);
      if (stream !== undefined) streams.set(`${h.visibility}/${h.row.id}`, stream);
      // The profile opens its workstreams at boot as another member, each with its session: the
      // owner's Workstreams tab, graded against the store just above, lists them.
      const theirs = entries.filter((e) => e.owner !== owner.user.userId && e.sessionId !== null);
      if (h.visibility === "shared" && theirs.length >= 2) booted ??= `${h.row.id}[${theirs.map((e) => `${e.owner}/${e.id}`).join(",")}]`;
    }
    if (booted === undefined) fail("the boot's workstreams", "no shared project holds two workstreams another member opened at boot, so the owner's Workstreams tab lists nobody else's");
    if (new Set(streams.values()).size !== streams.size) fail("a project's four tabs", `two projects' Streams draw one coordinator session: ${[...streams].map(([p, s]) => `${p}=${s}`).join(" ")}`);
    if (errors.length > 0) fail("screens", `the page threw: ${errors.join(" | ")}`);
    evidence.push(`screens: ${showGroups(groups)}; the boot's workstreams ${booted ?? "none"}; ${streams.size} of ${held.length} Streams each the owner's own ${setup.projectCoordinator} for its project`);
  } finally {
    await context.close();
  }
}

/**
 * Open a workstream as a person does: ask their project coordinator for the
 * work in the project's Stream. Its turn opens one and hands the ask in;
 * answers the entry it opened, or `undefined` with the failure noted.
 */
async function askFromPage(view: View, origin: string, held: Held, title: string, fail: (leg: string, why: string) => void, leg: string): Promise<Entry | undefined> {
  const before = new Set((await entriesOf(view.api, at(held))).map((e) => e.key));
  await openPage(view.page, origin, projectPath(held, "workstreams"));
  if (!(await visible(view.page, "project-open-hint", 15_000))) fail(leg, `${view.who}'s ${held.row.id} Workstreams doesn't say a workstream opens by asking the project coordinator`);
  if ((await view.page.getByTestId("project-open-title").count()) > 0) fail(leg, `${view.who}'s ${held.row.id} Workstreams still draws a form that opens a workstream`);
  await openPage(view.page, origin, projectPath(held, "stream"));
  const input = view.page.getByTestId("project-stream-composer-input");
  if (!(await visible(view.page, "project-stream-composer-input", 15_000))) {
    fail(leg, `${view.who}'s ${held.row.id} Stream draws no composer to ask in`);
    return undefined;
  }
  await input.fill(`Please open a workstream titled "${title}" for this and get it started: ${title}.`);
  await view.page.getByTestId("project-stream-composer-send").click();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const opened = (await entriesOf(view.api, at(held))).filter((e) => !before.has(e.key) && e.owner === view.api.user.userId);
    if (opened.length > 0 && opened.every((e) => e.sessionId !== null)) {
      if (opened.length > 1) fail(leg, `${view.who}'s one ask opened ${opened.length} workstreams: ${opened.map((e) => e.id).join(", ")}`);
      return opened[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  fail(leg, `${view.who}'s ask in ${held.row.id}'s Stream opened no workstream within 120 s`);
  return undefined;
}

/**
 * What the person's project coordinator did with their ask, read from the
 * Stream's conversation: each request's status, every tool call its turn
 * made with what it answered, and what it said. Said with a miss, so a red
 * names its cause: no post handed on, a refused one, or a turn that failed.
 */
async function whatTheTurnDid(view: View): Promise<string> {
  const sessionId = await view.page
    .locator("[data-testid=project-stream-conversation]")
    .getAttribute("data-session-id")
    .catch(() => null);
  if (sessionId === null) return "the Stream names no coordinator session to read the turn from";
  let requests: any;
  const items: Array<Record<string, any>> = [];
  try {
    requests = await view.api.get(`/sessions/${encodeURIComponent(sessionId)}/requests?limit=200`);
    for (let offset = 0; offset < 5_000; offset += 200) {
      const page = await view.api.get(`/sessions/${encodeURIComponent(sessionId)}/state?include_items=true&offset=${offset}&limit=200`);
      items.push(...((page.items ?? []) as Array<Record<string, any>>));
      if (page.pagination?.hasMore !== true) break;
    }
  } catch (error) {
    return `coordinator session ${sessionId}, whose turn could not be read: ${(error as Error).message}`;
  }
  const calls = items
    .filter((item) => item.type === "tool_output")
    .map((item) => `${item.toolCall?.name ?? item.blockName}(${item.toolCall?.arguments ?? ""}) → ${JSON.stringify(item.output ?? item.error ?? null).slice(0, 300)}`);
  const statuses = ((requests?.requests ?? []) as Array<Record<string, any>>).map((r) => `${r.actionName ?? r.action ?? "?"}:${r.status}`);
  const said = items
    .filter((item) => item.type === "message" && item.role === "assistant")
    .flatMap((item) => ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? ""))
    .join(" ")
    .slice(0, 300);
  return `coordinator session ${sessionId}, requests [${statuses.join(", ")}], its turn's tool calls: ${calls.length === 0 ? "none" : calls.join(" | ")}; it said: ${said || "nothing"}`;
}

/**
 * Whether a session's stored items carry `word` within 60 s, read as its
 * owner. The hand-off is the coordinator's next step after the open, so it
 * lands a moment after the entry names the session.
 */
async function sessionHolds(api: LabApi, sessionId: string, word: string): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { status, body } = await api.call("GET", `/sessions/${encodeURIComponent(sessionId)}/state?include_items=true&limit=200`);
    if (status === 200 && JSON.stringify(body).includes(word)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

/**
 * The owner and the member each open a workstream in a shared project they
 * are both on, by asking their project coordinator in their own page's
 * Stream; both read both, and each Board and Stream is its viewer's own.
 */
async function entries(browser: Browser, origin: string, setup: Setup, apis: { owner: LabApi; member: LabApi; outsider: LabApi }, fail: (leg: string, why: string) => void, evidence: string[]) {
  const leg = "entries opened through the app show for both members";
  const { owner, member, outsider } = apis;
  const shared = (await projectsOf(owner)).filter((h) => h.visibility === "shared");
  const held = shared.find((h) => h.row.members.includes(member.user.userId) && !h.row.members.includes(outsider.user.userId)) ?? shared.find((h) => h.row.members.includes(member.user.userId));
  if (held === undefined) throw new Error(`no shared project lists ${member.user.userId} as a member`);
  const titles = { owner: `${fixture.opened.owner} ${RUN_STAMP}`, member: `${fixture.opened.member} ${RUN_STAMP}` };

  const ownerSide = await personPage(browser, origin, owner.user, true);
  const memberSide = await personPage(browser, origin, member.user, false);
  try {
    const views: Record<"owner" | "member", View> = {
      owner: { who: "the owner", page: ownerSide.page, api: owner },
      member: { who: "the member", page: memberSide.page, api: member },
    };
    // The store: one new entry per asker, theirs, led by one of the tree's leads (the coordinator picks which), with its
    // session, which the ask reached.
    // Nothing is added to the asker's roster.
    const found: Record<"owner" | "member", Entry | undefined> = { owner: undefined, member: undefined };
    for (const who of ["owner", "member"] as const) {
      const api = apis[who];
      const workersBefore = await ownWorkers(api);
      const entry = await askFromPage(views[who], origin, held, titles[who], fail, leg);
      if (entry === undefined) continue;
      found[who] = entry;
      if (!setup.leads.includes(entry.lead)) fail(leg, `${who}'s workstream "${entry.id}" is led by ${entry.lead}, not one of the tree's leads (${setup.leads.join(", ")})`);
      if (!(await api.sessions()).some((s) => s.id === entry.sessionId)) fail(leg, `${who}'s "${entry.id}" names session ${entry.sessionId}, not one of theirs`);
      else if (!(await sessionHolds(api, entry.sessionId!, RUN_STAMP))) {
        fail(leg, `${who}'s ask never reached the workstream session ${entry.sessionId}; ${await whatTheTurnDid(views[who])}`);
      }
      if (!same(await ownWorkers(api), workersBefore)) fail(leg, `${who}'s roster changed when the workstream opened: ${diff(workersBefore, await ownWorkers(api))}`);
    }

    // Both pages: PROJECTS, both entries, the progress counting them, each Board its own, each Stream its own.
    const streams: string[] = [];
    for (const who of ["owner", "member"] as const) {
      const view = views[who];
      await openPage(view.page, origin, "/inbox");
      const want = await wantedGroups(view.api, (await readStore(owner)).mailboxes);
      const groups = await sidebarGroups(view.page);
      if (showGroups(groups) !== showGroups(want)) fail("PROJECTS equals the store's rows", `${view.who}'s drawn ${showGroups(groups) || "(nothing)"}, stored ${showGroups(want)}`);
      const { stream, entries: read } = await gradeTabs(view, held, setup, origin, fail);
      if (stream !== undefined) streams.push(stream);
      for (const other of ["owner", "member"] as const) {
        const entry = found[other];
        if (entry === undefined) continue;
        if (!read.some((e) => e.key === entry.key)) fail(leg, `${view.who} doesn't read ${other}'s "${entry.title}"`);
        if (other === who) continue;
        // Another person's entry opens on its details: anyone in the project reads it.
        await openPage(view.page, origin, projectPath(held, "workstreams"));
        await view.page.locator(`[data-testid=project-entry][data-owner="${entry.owner}"][data-workstream-id="${entry.id}"] button`).click({ timeout: 10_000 }).catch(() => undefined);
        if (!(await visible(view.page, "project-entry-details"))) fail(leg, `${view.who}'s page doesn't open ${other}'s "${entry.title}" on its details`);
        else if (!(((await view.page.getByTestId("project-entry-details").textContent()) ?? "").includes(entry.title))) fail(leg, `${view.who}'s details of ${other}'s entry don't name "${entry.title}"`);
      }
    }
    if (streams.length === 2 && streams[0] === streams[1]) fail("a project's four tabs", `the owner's and the member's ${held.row.id} Streams draw one session, ${streams[0]}`);
    // The member's PROJECTS leaves out the owner's private project: it was graded against the member's own read above.
    for (const errors of [ownerSide.errors, memberSide.errors]) if (errors.length > 0) fail("screens", `a page threw: ${errors.join(" | ")}`);
  } finally {
    await ownerSide.context.close();
    await memberSide.context.close();
  }
  evidence.push(`entries: in ${held.row.id} the owner and the member each asked their project coordinator in their page's Stream, each got one workstream led by one of ${setup.leads.join(", ")} with the ask in its session, both read both, each Board and Stream its viewer's own`);
}

/** The outsider reads a shared project's entries as its members do, and its open is refused. */
async function outsiderRefused(setup: Setup, apis: { owner: LabApi; member: LabApi; outsider: LabApi }, fail: (leg: string, why: string) => void, evidence: string[]) {
  const { owner, member, outsider } = apis;
  const shared = (await projectsOf(owner)).filter((h) => h.visibility === "shared");
  const held = shared.find((h) => h.row.members.includes(member.user.userId) && !h.row.members.includes(outsider.user.userId)) ?? shared.find((h) => h.row.members.includes(member.user.userId));
  if (held === undefined) throw new Error(`no shared project lists ${member.user.userId} as a member`);
  const outLeg = "the outsider's open is refused";
  const read = await entriesOf(outsider, at(held));
  const want = await entriesOf(owner, at(held));
  if (!same(read.map((e) => e.key), want.map((e) => e.key))) fail(outLeg, `the outsider, in the organization, reads ${held.row.id}'s entries as ${diff(want.map((e) => e.key), read.map((e) => e.key))}`);
  const session = await outsider.createSession(PROJECTS_FLOW);
  const open = await outsider.act(PROJECTS_FLOW, session, "openWorkstream", {
    project: { visibility: "shared", id: held.row.id },
    id: fixture.race.id,
    title: fixture.race.title,
    lead: setup.lead,
  });
  if (open.status === "completed") fail(outLeg, `the outsider opened a workstream in ${held.row.id}, of which it is no member`);
  const leaked = (await entriesOf(owner, at(held))).filter((e) => e.owner === outsider.user.userId);
  if (leaked.length > 0) fail(outLeg, `${held.row.id} holds ${leaked.length} entry(ies) of the outsider's`);
  evidence.push(
    `outsider: read ${read.length} of ${held.row.id}'s ${want.length} entries and its open ended ${open.status}${open.error === undefined ? "" : ` (${open.error.slice(0, 120)})`}`,
  );
}

/**
 * Every member opens the same workstream id in one project, each from several
 * sessions at once, then sends several updates per field at once. Writes to two
 * owners' entries never meet, since each owner's key is their own; each
 * owner's own opens and updates race on their one entry.
 */
async function race(setup: Setup, apis: { owner: LabApi; member: LabApi; crowd: LabApi[] }, fail: (leg: string, why: string) => void, evidence: string[]) {
  const leg = "a write race lands whole";
  const racers = [apis.owner, apis.member, ...apis.crowd];
  const shared = (await projectsOf(apis.owner)).filter((h) => h.visibility === "shared" && racers.every((r) => h.row.members.includes(r.user.userId) || h.row.ownerUserId === r.user.userId));
  const held = shared[0];
  if (held === undefined) {
    fail("store", "no shared project lists every racer, so the write race races nothing");
    return;
  }
  const project = { visibility: "shared" as const, id: held.row.id };
  const input = { project, id: fixture.race.id, title: fixture.race.title, lead: setup.lead };

  // The opens. The barrier: every session exists before any open is sent, and all are sent in one go.
  const windows = await Promise.all(racers.map((r) => Promise.all(Array.from({ length: fixture.race.opens }, () => r.createSession(PROJECTS_FLOW)))));
  const opened = await Promise.all(racers.map((r, i) => Promise.all(windows[i]!.map((w) => r.act(PROJECTS_FLOW, w, "openWorkstream", input)))));
  const answered = new Map<string, string>();
  for (const [i, r] of racers.entries()) {
    const who = r.user.userId;
    const refused = opened[i]!.filter((o) => o.status !== "completed");
    if (refused.length > 0) fail(leg, `${who}: ${refused.length} of ${opened[i]!.length} opens did not complete (${(refused[0]!.error ?? refused[0]!.status).slice(0, 200)})`);
    const done = opened[i]!.filter((o) => o.status === "completed");
    const sessions = new Set(done.map((o) => String(o.output?.workstream?.sessionId)));
    if (sessions.size > 1) fail(leg, `${who}: the opens answered ${sessions.size} different sessions`);
    const made = done.filter((o) => o.output?.opened === true).length;
    // Exactly one open makes the entry; none completing is also the refusal above.
    if (made !== 1) fail(leg,`${who}: ${made} of the opens say they made the entry, not one`);
    if (done.some((o) => o.output?.workstream?.owner !== who)) fail(leg, `${who}: an open answered another owner's entry`);
    if (sessions.size === 1) answered.set(who, [...sessions][0]!);
  }

  // The updates: each field changed `copies` times, every racer's at once, each from a session of its own.
  const changes = fixture.race.changes.map((c) => (c.title === undefined ? c : { ...c, title: `${c.title} ${RUN_STAMP}` }));
  const sends = changes.flatMap((c) => Array.from({ length: fixture.race.copies }, () => c));
  const updateWindows = await Promise.all(racers.map((r) => Promise.all(sends.map(() => r.createSession(PROJECTS_FLOW)))));
  const updated = await Promise.all(
    racers.map((r, i) => Promise.all(sends.map((c, j) => r.act(PROJECTS_FLOW, updateWindows[i]![j]!, "updateWorkstream", { project, id: fixture.race.id, ...c })))),
  );
  for (const [i, r] of racers.entries()) {
    const refused = updated[i]!.filter((u) => u.status !== "completed");
    if (refused.length > 0) fail(leg, `${r.user.userId}: ${refused.length} of ${sends.length} updates did not complete (${(refused[0]!.error ?? refused[0]!.status).slice(0, 200)})`);
  }

  // The store: one entry per racer, its own, naming the one session its opens answered, every field landed.
  const stored = (await entriesOf(apis.owner, project)).filter((e) => e.id === fixture.race.id);
  let whole = 0;
  for (const r of racers) {
    const who = r.user.userId;
    const mine = stored.filter((e) => e.owner === who);
    if (mine.length !== 1) {
      fail(leg, `${held.row.id} holds ${mine.length} "${fixture.race.id}" entries of ${who}'s`);
      continue;
    }
    const entry = mine[0]!;
    const lost: string[] = [];
    if (entry.sessionId === null || (answered.has(who) && entry.sessionId !== answered.get(who))) lost.push(`session ${entry.sessionId}, opens answered ${answered.get(who)}`);
    for (const c of changes) {
      if (c.title !== undefined && entry.title !== c.title) lost.push(`title "${entry.title}"`);
      if (c.status !== undefined && entry.status !== c.status) lost.push(`status "${entry.status}"`);
      if (c.due !== undefined && entry.due !== c.due) lost.push(`due ${entry.due}`);
      if (c.objectives !== undefined && JSON.stringify(entry.objectives) !== JSON.stringify(c.objectives)) lost.push(`objectives ${JSON.stringify(entry.objectives)}`);
    }
    if (lost.length > 0) fail(leg, `${who}'s entry lost writes: ${lost.join("; ")}`);
    else whole += 1;
  }
  const opens = opened.flat();
  const updates = updated.flat();
  evidence.push(
    `race: in ${held.row.id}, ${opens.filter((o) => o.status === "completed").length} of ${opens.length} opens from ${racers.length} owners at once and ${updates.filter((u) => u.status === "completed").length} of ${updates.length} updates at once completed; ${whole} of ${racers.length} entries whole, one session each`,
  );
}

/**
 * The chief of staff creates projects for the person who asks it. The person
 * is the member, so a row the profile wrote at boot (the owner's) can't pass
 * for one written for them. Titles carry this run's stamp, so no file in the
 * repository names the rows graded here.
 */
async function cos(apis: { owner: LabApi; member: LabApi }, fail: (leg: string, why: string) => void, evidence: string[]) {
  const leg = "cos";
  const { owner, member: person } = apis;
  const named = owner.user.userId;
  const titles = fixture.cos.titles.map((t) => `${t} ${RUN_STAMP}`);
  const before = new Set((await readStore(owner)).rows.map((r) => r.id));

  // A conversation is a session on the flow the chief of staff's file names, naming it.
  const flow = await flowOf(COS);
  const opened = await person.call("POST", `/${encodeURIComponent(flow)}/sessions`, { userId: person.user.userId, state: { workerId: COS } });
  if (opened.status !== 201) {
    fail(leg, `the chief of staff's address did not answer: ${opened.status} ${JSON.stringify(opened.body)}`);
    return;
  }
  const session = String(opened.body.session.id);
  const beforePrivate = new Set((await privateRows(person, session))?.map((r) => r.id) ?? []);
  const ask = fixture.cos.ask.replace("{first}", titles[0]!).replace("{second}", titles[1]!).replace("{named}", named);
  const posted = await person.call("POST", `/${encodeURIComponent(flow)}/${encodeURIComponent(session)}/actions/respond`, {
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
    const polled = String((await person.call("GET", `/${encodeURIComponent(flow)}/requests/${encodeURIComponent(requestId)}/status`)).body?.status);
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

  const created = (await readStore(owner)).rows.filter((r) => !before.has(r.id));
  const createdPrivate = (await privateRows(person, session))?.filter((r) => !beforePrivate.has(r.id));
  if (createdPrivate === undefined) {
    fail(leg, `the person's conversation with the chief of staff publishes no user-scope projects/* collection, so no private project of theirs can be read`);
    return;
  }
  const shown = `shared [${created.map((r) => r.title).join(", ")}], private [${createdPrivate.map((r) => r.title).join(", ")}]`;
  const titled = (rows: Row[], title: string) => rows.find((r) => r.title.toLowerCase() === title.toLowerCase());
  /** A shared row as asked: owned by the person, with `wantMembers`. */
  const gradeShared = (row: Row, wantMembers: string[]) => {
    if (row.ownerUserId !== person.user.userId) fail(leg, `${row.id} is owned by ${row.ownerUserId}, not ${person.user.userId}, who asked`);
    if (!same(row.members, wantMembers)) fail(leg, `${row.id}'s members: ${diff(wantMembers, row.members)}`);
  };
  // The first: a shared row with the person and whoever they named.
  const first = titled(created, titles[0]!);
  if (first === undefined) fail(leg, `no new row is titled "${titles[0]}": ${shown}; the chief of staff said ${await said()}`);
  else gradeShared(first, [person.user.userId, named]);
  // The second, "just for me": the person's private project, or a shared row only they are on.
  const secondPrivate = titled(createdPrivate, titles[1]!);
  const secondShared = titled(created, titles[1]!);
  if (secondPrivate !== undefined) {
    if (secondPrivate.ownerUserId !== person.user.userId) fail(leg, `the second project, private ${secondPrivate.id}, is owned by ${secondPrivate.ownerUserId}, not ${person.user.userId}, who asked`);
    if (!same(secondPrivate.members, [person.user.userId])) fail(leg, `the second project, private ${secondPrivate.id}: members ${diff([person.user.userId], secondPrivate.members)}`);
  } else if (secondShared !== undefined) {
    gradeShared(secondShared, [person.user.userId]);
  } else {
    fail(leg, `the second project, "${titles[1]}", is neither the person's private project nor a new shared row only they are on: ${shown}; the chief of staff said ${await said()}`);
  }
  if (created.length + createdPrivate.length > 2) fail(leg, `asked for two projects, the store holds ${created.length + createdPrivate.length} new ones: ${shown}`);
  evidence.push(
    `cos: asked by ${person.user.userId}, the chief of staff created ${[
      ...created.map((r) => `shared ${r.id} {owner ${r.ownerUserId}, members [${r.members.join(",")}]}`),
      ...createdPrivate.map((r) => `private ${r.id} {owner ${r.ownerUserId}, members [${r.members.join(",")}]}`),
    ].join(" and ")}`,
  );
}

// ---- a restart ---------------------------------------------------------------

/** Everything a restart must keep, as the owner reads it: every project they read, and each one's entries. */
type Kept = { held: Held; entries: Entry[] };

const rowKey = (r: Row) =>
  JSON.stringify({ title: r.title, brief: r.brief ?? null, owner: r.ownerUserId, members: sorted(r.members), repository: r.repository ?? null });
const entryKey = (e: Entry) =>
  JSON.stringify({ key: e.key, title: e.title, lead: e.lead, sessionId: e.sessionId, status: e.status, due: e.due, objectives: e.objectives, openedAt: e.openedAt, updatedAt: e.updatedAt });

async function whatIsHeld(owner: LabApi): Promise<Kept[]> {
  const kept: Kept[] = [];
  for (const held of await projectsOf(owner)) kept.push({ held, entries: await entriesOf(owner, { visibility: held.visibility, id: held.row.id }) });
  return kept;
}

/** The request states a turn is still running in. */
const RUNNING_STATES = ["pending", "queued", "in_progress", "running"];

/** Whether any of `apis`' own sessions, dispatch runs included, holds a request still running. */
async function anyTurnRunning(apis: LabApi[]): Promise<boolean> {
  for (const api of apis) {
    for (const session of await api.sessions()) {
      const listed = await api.get(`/sessions/${encodeURIComponent(session.id)}/requests?limit=200`);
      if (((listed.requests ?? []) as Array<{ status?: string }>).some((r) => RUNNING_STATES.includes(String(r.status)))) return true;
    }
  }
  return false;
}

/**
 * What the owner holds once nothing is still writing it: no turn of `writers`
 * running, then two reads, three seconds apart, that agree. A workstream's lead
 * the entries leg woke may still be finishing its entry; that write is work,
 * not one the restart lost.
 */
async function whatIsHeldQuiet(owner: LabApi, writers: LabApi[]): Promise<Kept[]> {
  const show = (kept: Kept[]) => JSON.stringify(kept.map((k) => [rowKey(k.held.row), k.entries.map(entryKey).sort()]));
  let last: Kept[] | undefined;
  for (const until = Date.now() + 180_000; Date.now() < until; await new Promise((resolve) => setTimeout(resolve, 3_000))) {
    if (await anyTurnRunning(writers)) {
      last = undefined;
      continue;
    }
    const now = await whatIsHeld(owner);
    if (last !== undefined && show(now) === show(last)) return now;
    last = now;
  }
  throw new Error("turns were still running, or the projects' entries still changing, three minutes after the last leg, so a restart can't be graded against them");
}

/** After the Lab restarts on the same store: every project row, shared and private, and every entry is as it was. */
async function restarted(before: Kept[], owner: LabApi, fail: (leg: string, why: string) => void, evidence: string[]) {
  const leg = "a restart keeps the projects and their entries";
  let now: Kept[];
  try {
    now = await whatIsHeld(owner);
  } catch (error) {
    fail(leg, `the projects could not be read after the restart: ${(error as Error).message}`);
    return;
  }
  if (now.length !== before.length) fail(leg, `${before.length} project(s) before the restart, ${now.length} after`);
  let entries = 0;
  for (const was of before) {
    const where = `${was.held.visibility} ${was.held.row.id}`;
    const is = now.find((k) => k.held.visibility === was.held.visibility && k.held.row.id === was.held.row.id);
    if (is === undefined) {
      fail(leg, `${where} is gone after the restart`);
      continue;
    }
    if (rowKey(is.held.row) !== rowKey(was.held.row)) fail(leg, `${where}'s row changed across the restart: ${rowKey(was.held.row)} became ${rowKey(is.held.row)}`);
    const after = new Set(is.entries.map(entryKey));
    const lost = was.entries.filter((e) => !after.has(entryKey(e)));
    if (lost.length > 0 || is.entries.length !== was.entries.length) fail(leg, `${where}: ${lost.length} of ${was.entries.length} entries not as they were, ${is.entries.length} after the restart`);
    entries += was.entries.length - lost.length;
  }
  if (before.every((k) => k.entries.length === 0)) fail(leg, "no project held an entry before the restart, so the restart kept nothing to grade");
  evidence.push(`restart: ${now.length} of ${before.length} projects unchanged; ${entries} entries as they were`);
}

await runGoal(async (failures) => {
  const cosModel = devteamCosModel();
  const modelKeys = keysServing(cosModel);
  if (COS_LEG && !modelKeys.some((key) => (process.env[key] ?? "") !== "")) {
    return {
      failures: [`blocked: the cos leg runs the chief of staff on ${cosModel}, and no key here serves it; none of ${modelKeys.join(", ")} is set. GOAL_LEG=model-free runs the other legs without one`],
      evidence: "",
    };
  }
  const pages = await buildShiftManager(CONTROL);
  const swap = serverSwapFor(CONTROL);
  const fired = swap === undefined ? undefined : join(SCRATCH, `fired-${CONTROL}-${RUN_STAMP}.log`);
  const evidence: string[] = [];
  const fail = (leg: string, why: string) => failures.push(`${leg}: ${why}`);
  mkdirSync(join(SCRATCH, "stores"), { recursive: true });
  const store = join(mkdtempSync(join(SCRATCH, "stores", "devteam-")), "devteam.sqlite");
  let served = await startLab(pages, fired, store);
  // Each Lab's log, kept when the run fails so a red can be read after the scratch store is gone.
  const logs = [served.log];
  // Set as the last step: a leg that throws leaves it false, and runGoal records the throw only after this returns.
  let finished = false;
  try {
    const apis = {
      owner: labApi(served.origin, LAB_USERS.owner),
      member: labApi(served.origin, LAB_USERS.member),
      crowd: LAB_CROWD.map((user) => labApi(served.origin, user)),
      outsider: labApi(served.origin, LAB_USERS.outsider),
    };
    const { rows } = await readStore(apis.owner);
    if (rows.length === 0) fail("store", "the Lab holds no project row, so every leg grades nothing");
    for (const row of rows) {
      if (row.ownerUserId !== apis.owner.user.userId) fail("store", `${row.id} is owned by ${row.ownerUserId}, not the profile's person`);
    }
    if (MODEL_FREE) {
      const setup = await readSetup(apis.owner);
      // The owner's private project, made the way an app makes one: through the projects flow, as them.
      const made = await apis.owner.act(PROJECTS_FLOW, await apis.owner.createSession(PROJECTS_FLOW), "createProject", {
        id: `own-${RUN_STAMP.replace(/_/g, "-")}`,
        title: `${fixture.privateProject.title} ${RUN_STAMP}`,
        brief: fixture.privateProject.brief,
        visibility: "private",
      });
      if (made.status !== "completed") fail("store", `the owner's private project was not created: ${made.status} ${made.error ?? ""}`);
      const browser = await launchChromium();
      try {
        await screens(browser, served.origin, setup, apis.owner, fail, evidence);
        // A workstream opens by asking the project coordinator, whose turn runs on its own model.
        if (COS_LEG) await entries(browser, served.origin, setup, apis, fail, evidence);
      } finally {
        await browser.close();
      }
      await outsiderRefused(setup, apis, fail, evidence);
      await race(setup, apis, fail, evidence);

      // Stop the Lab and start it again on the same store.
      const before = await whatIsHeldQuiet(apis.owner, [apis.owner, apis.member]);
      served.child.kill("SIGTERM");
      await served.exited;
      served = await startLab(pages, fired, store);
      logs.push(served.log);
      await restarted(before, labApi(served.origin, LAB_USERS.owner), fail, evidence);
    }
    // Last, on the Lab as it now runs: its rows are the member's.
    if (COS_LEG) {
      await cos({ owner: labApi(served.origin, LAB_USERS.owner), member: labApi(served.origin, LAB_USERS.member) }, fail, evidence);
    }
    finished = true;
  } finally {
    served.child.kill("SIGTERM");
    await served.exited;
    if (!finished || failures.length > 0) {
      const kept = join(SCRATCH, `lab-${RUN_STAMP}.log`);
      writeFileSync(kept, logs.map((log, i) => `===== Lab ${i + 1} =====\n${log()}`).join("\n"));
      console.error(`the Lab's log is kept at ${kept}`);
    }
  }
  if (fired !== undefined && (!existsSync(fired) || readFileSync(fired, "utf8").trim().length === 0)) {
    throw new Error(`control ${CONTROL}: the Lab never imported ${swap!.target}, so nothing was swapped`);
  }
  const swapNote = fired === undefined ? "" : ` Swap fired for: ${readFileSync(fired, "utf8").trim().split("\n").map((p) => p.split("/").pop()).join(", ")}.`;
  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `Shift Manager built with Vite and served by its command over the DevTeam profile; ${[
      ...(MODEL_FREE
        ? [`the screens walked in Chromium as the owner and the member, the outsider and a race of ${2 + LAB_CROWD.length} owners driven over HTTP, then the Lab restarted on its store`]
        : []),
      ...(COS_LEG ? ["the chief of staff asked over HTTP as the member, on its own model"] : []),
    ].join("; ")}; all graded against the tree and the store. ${evidence.join("; ")}.${swapNote}`,
  };
});
