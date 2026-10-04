/**
 * Shift Manager in a browser, for the goals that build it, serve it over a Lab
 * and read what it draws.
 *
 * Kept out of `index.mts`: only the Shift Manager goals need it.
 *
 *   import { buildShiftManagerCopy, startShiftManager, labApi } from "../../lib/shift-manager.mts";
 *
 * - {@link buildShiftManagerCopy}: Shift Manager copied to scratch, patched
 *   there (never in the checkout) and built with Vite. Tailwind reads class
 *   names off the files on disk, so a patch has to land in a copy rather than
 *   in the bundler.
 * - {@link startShiftManager}: Shift Manager's own start script over a Lab's
 *   `fsdev` config, from a scratch working directory.
 * - {@link labApi}: the Lab's HTTP routes, read with the goal's own requests,
 *   so a goal's oracle is the store and never Shift Manager's state.
 *
 * `vite.build()` run in-process sets `process.env.NODE_ENV` to `production`
 * and never restores it. A Lab started after a build would inherit it, which
 * turns trace items off and stubs `node:` built-ins. The value this module saw
 * when it loaded is what every Lab it starts gets.
 *
 * A goal that drives Shift Manager the way a person does also has the
 * second set: {@link buildShiftManagerPages} builds the checkout as it
 * stands, {@link serveLab} serves a Lab on a store file the goal owns (so a
 * restart is a stop and a start on the same file), {@link labRoutes} reads
 * the Lab as one verified user, and {@link personPage} opens a browser
 * context as a given person. Those take the Shift Manager checkout they run,
 * so a goal can serve an older commit's Shift Manager from a scratch tree.
 * They type against Playwright; only those goals open a browser.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { intentFreeEnv } from "./env.mts";
import { REPO_ROOT, repoPath } from "./paths.mts";

/** `labs/shift-manager`. */
export const SHIFT_MANAGER: string = repoPath("labs", "shift-manager");

/** `NODE_ENV` as it was before any in-process build changed it. */
const NODE_ENV_AT_LOAD = process.env.NODE_ENV;

const TSX = repoPath("node_modules", ".bin", "tsx");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One edit to a file in the scratch copy. A patch that matches nothing fails the build's setup. */
export type Patch = { file: string; from: string | RegExp; to: string; why: string };

/**
 * Shift Manager copied to `<scratch>/<name>/shift-manager` with `patches`
 * applied, then built into `<scratch>/<name>/pages`. A patch that matches
 * nothing throws: a build that "removed" a line that was never there proves
 * nothing.
 *
 * @returns The built pages' directory, and one line per patch applied.
 */
export async function buildShiftManagerCopy(scratch: string, name: string, patches: readonly Patch[]): Promise<{ pages: string; diff: string[] }> {
  const root = join(scratch, name, "shift-manager");
  cpSync(SHIFT_MANAGER, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist)$/.test(src) });
  symlinkSync(join(SHIFT_MANAGER, "node_modules"), join(root, "node_modules"));
  // The copy sits outside the workspace; its tsconfig still extends the workspace's.
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  const diff: string[] = [];
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup [${name}]: ${patch.why}, but ${patch.file} has nothing to patch (looked for ${String(patch.from)})`);
    writeFileSync(path, after);
    diff.push(`${patch.file}: ${patch.why}`);
  }
  const vite = (await import(pathToFileURL(createRequire(join(SHIFT_MANAGER, "package.json")).resolve("vite")).href)) as {
    build(config: Record<string, unknown>): Promise<unknown>;
  };
  const pages = join(scratch, name, "pages");
  await vite.build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir: pages, emptyOutDir: true } });
  return { pages, diff };
}

/** A Shift Manager start script serving a Lab. */
export type ServedShiftManager = { origin: string; workDir: string; child: ChildProcess; log: () => string; exited: Promise<void>; stop: () => Promise<void> };

/**
 * Shift Manager's start script over the Lab at `config`, serving `pages`, from
 * a fresh working directory under `<scratch>/labs`. `env` is added to the
 * child's environment; `GOAL_CONTROL` is always cleared, since a Lab's config
 * may read it too, and the intent ladder is stripped.
 */
export async function startShiftManager(options: {
  scratch: string;
  label: string;
  config: string;
  pages: string;
  env?: Record<string, string>;
}): Promise<ServedShiftManager> {
  mkdirSync(join(options.scratch, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(options.scratch, "labs", `${options.label}-`));
  const env = intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "", ...options.env });
  if (NODE_ENV_AT_LOAD === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = NODE_ENV_AT_LOAD;
  let log = "";
  const child = spawn(TSX, [join(SHIFT_MANAGER, "bin", "start.mts"), "--config", options.config, "--port", "0", "--assets", options.pages], {
    cwd: workDir,
    env,
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
  const stop = async () => {
    child.kill("SIGTERM");
    await exited;
  };
  for (let waited = 0; waited < 90_000; waited += 250) {
    const match = /Shift Manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) return { origin: match[1]!, workDir, child, log: () => log, exited, stop };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's start script never served ${options.label}. Log tail:\n${log.slice(-2000)}`);
}

/** GET/POST against a Lab's routes, with the page's bearer when the Lab has one. */
export function labApi(origin: string, bearer: string | undefined) {
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (text.length === 0) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      throw new Error(`${method} ${path}: ${response.status}, and the body is not JSON: ${text.slice(0, 200)}`);
    }
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
  /** Every item in one session, oldest first. `types` limits the query to those item types; omit it for every type. */
  const items = async (sessionId: string, types: string[] = []): Promise<Array<Record<string, any>>> => {
    const out: Array<Record<string, any>> = [];
    const typeQuery = types.length === 0 ? "" : `&item_types=${types.join(",")}`;
    for (let offset = 0, page = 0; page < 100; page += 1) {
      const body = await get(
        `/sessions/${encodeURIComponent(sessionId)}/state?include_items=true${typeQuery}&offset=${offset}&limit=200`,
      );
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  return { call, get, collection, items };
}

/** A Lab's routes, as {@link labApi} reads them. */
export type LabApi = ReturnType<typeof labApi>;

/**
 * Build Shift Manager's pages into `outDir` with the Vite the checkout at
 * `root` carries.
 *
 * @returns `outDir`, for `--assets`.
 */
export async function buildShiftManagerPages(outDir: string, root: string = SHIFT_MANAGER): Promise<string> {
  const viteEntry = createRequire(join(root, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  await vite.build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true } });
  return outDir;
}

/** A Lab Shift Manager's start script is serving. */
export interface ServedLab {
  origin: string;
  child: ChildProcess;
  /** Everything the process has printed so far. */
  log(): string;
  /** Stop the process and wait for it to exit. */
  stop(): Promise<void>;
}

/** What {@link serveLab} starts. */
export interface ServeOptions {
  /** The Lab's fsdev config. */
  config: string;
  /** Shift Manager's built pages ({@link buildShiftManagerPages}). */
  pages: string;
  /** A scratch directory; the process runs in a fresh directory under it. */
  scratch: string;
  /** Extra environment, on top of the intent-free one. */
  env?: Record<string, string>;
  /** The Shift Manager checkout whose start script runs. Default: this one. */
  root?: string;
  /** The `tsx` binary that runs it. Default: the repository root's of `root`'s workspace. */
  tsx?: string;
  /** How long the start may take before it is refused. */
  timeoutMs?: number;
}

/**
 * Start Shift Manager's own start script over a Lab, as a person would, and
 * wait for it to say where it serves.
 */
export async function serveLab(options: ServeOptions): Promise<ServedLab> {
  const root = options.root ?? SHIFT_MANAGER;
  const tsx = options.tsx ?? join(REPO_ROOT, "node_modules", ".bin", "tsx");
  mkdirSync(join(options.scratch, "runs"), { recursive: true });
  const workDir = mkdtempSync(join(options.scratch, "runs", "lab-"));
  const env = intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "", ...(options.env ?? {}) });
  if (NODE_ENV_AT_LOAD === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = NODE_ENV_AT_LOAD;
  let log = "";
  const child = spawn(tsx, [join(root, "bin", "start.mts"), "--config", options.config, "--port", "0", "--assets", options.pages], {
    cwd: workDir,
    env,
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
  const stop = async () => {
    if (!gone) child.kill("SIGTERM");
    await exited;
  };
  for (let waited = 0; waited < (options.timeoutMs ?? 120_000); waited += 250) {
    const match = /Shift Manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) return { origin: match[1]!, child, log: () => log, stop };
    if (gone) break;
    await sleep(250);
  }
  await stop();
  throw new Error(`Shift Manager's start script never served ${options.config}. Log tail:\n${log.slice(-3000)}`);
}

/** One verified person, as the Lab's door knows them. */
export interface LabUser {
  userId: string;
  bearer: string;
}

/** A stored item, as the session state route hands it back. */
export type StoredItem = {
  id: string;
  type: string;
  role?: string;
  requestId?: string;
  suspensionId?: string;
  reason?: string;
  message?: string;
  status?: string;
  data?: unknown;
  content?: unknown;
  output?: unknown;
  error?: { message?: string };
  toolCall?: { callId?: string; name?: string; arguments?: string };
  createdAt?: number;
};

/** The request states a turn is still running in. */
const RUNNING = ["pending", "queued", "in_progress", "running"];

/**
 * The Lab's routes, read as `user`. Every read a goal grades goes through
 * these, never through Shift Manager's own state.
 */
export function labRoutes(origin: string, user: LabUser) {
  const enc = encodeURIComponent;
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: { "content-type": "application/json", ...(user.bearer === "" ? {} : { authorization: `Bearer ${user.bearer}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text.length === 0 ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };
  const get = async (path: string): Promise<any> => {
    const { status, body } = await call("GET", path);
    if (status !== 200) throw new Error(`GET ${path}: ${status} ${JSON.stringify(body)}`);
    return body;
  };
  /** The collection ref a session's manifest publishes for a key pattern, or `undefined`. */
  const refOf = async (sessionId: string, pattern: string): Promise<string | undefined> => {
    const manifest = await get(`/sessions/${enc(sessionId)}/manifest`);
    return (manifest.resources as Array<{ kind: string; pattern?: string; ref: string }>).find((r) => r.kind === "collection" && r.pattern === pattern)?.ref;
  };
  /** Every row of the collection at `pattern`, read through `sessionId`. Throws when the session declares none. */
  const collection = async (sessionId: string, pattern: string): Promise<Array<Record<string, any>>> => {
    const ref = await refOf(sessionId, pattern);
    if (ref === undefined) throw new Error(`session ${sessionId} declares no collection ${pattern}`);
    const rows: Array<Record<string, any>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/resources/${enc(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${enc(cursor)}`}`);
      rows.push(...((body.items ?? []) as Array<{ clientData?: Record<string, any> }>).map((i) => i.clientData ?? {}));
      if (body.nextCursor === undefined || body.nextCursor === null || body.nextCursor === cursor) break;
      cursor = body.nextCursor;
    }
    return rows;
  };
  /** Every item of `types` (comma-separated) in one session, in stored order. */
  const items = async (sessionId: string, types: string): Promise<StoredItem[]> => {
    const out: StoredItem[] = [];
    for (let offset = 0, page = 0; page < 50; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/state?include_items=true&item_types=${types}&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };
  /** The user's sessions, dispatch runs included. */
  const sessions = async (): Promise<Array<{ id: string; flowId?: string; flowKind?: string; parentSessionId?: string | null; createdAt: number }>> =>
    (await get(`/sessions?userId=${enc(user.userId)}&include=dispatch-runs`)).sessions ?? [];
  /** The requests one session holds, newest last as the route lists them. */
  const requests = async (sessionId: string): Promise<Array<Record<string, any>>> => {
    const out: Array<Record<string, any>> = [];
    for (let offset = 0; offset < 5000; offset += 200) {
      const listed = await get(`/sessions/${enc(sessionId)}/requests?include_result_output=true&limit=200&offset=${offset}`);
      const page = (listed.requests ?? []) as Array<Record<string, any>>;
      out.push(...page);
      if (page.length < 200) break;
    }
    return out;
  };
  /** A request's status. */
  const status = async (flowId: string, requestId: string): Promise<string | undefined> =>
    (await call("GET", `/${enc(flowId)}/requests/${enc(requestId)}/status`)).body?.status as string | undefined;
  /** Wait for a request to leave the running states (and `suspended`, when `pastSuspended`). */
  const settle = async (flowId: string, requestId: string, timeoutMs: number, pastSuspended = false): Promise<string> => {
    const running = [...RUNNING, ...(pastSuspended ? ["suspended"] : [])];
    for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(500)) {
      const now = await status(flowId, requestId);
      if (now !== undefined && !running.includes(now)) return now;
    }
    return "timed-out";
  };
  /** Run one action and wait for it to end: its status, and its output or error. */
  const act = async (kind: string, sessionId: string, action: string, input: unknown): Promise<{ status: string; output: any; error: string | undefined }> => {
    const posted = await call("POST", `/${enc(kind)}/${enc(sessionId)}/actions/${enc(action)}`, { userId: user.userId, input });
    if (posted.status !== 202) return { status: `http ${posted.status}`, output: undefined, error: JSON.stringify(posted.body) };
    const requestId = String(posted.body?.request?.id);
    const settled = await settle(kind, requestId, 60_000);
    const found = (await requests(sessionId)).find((r) => r.id === requestId);
    return { status: settled, output: found?.result?.output, error: found?.result?.error?.message };
  };
  return { user, call, get, refOf, collection, items, sessions, requests, status, settle, act };
}

/** What {@link labRoutes} returns. */
export type LabRoutes = ReturnType<typeof labRoutes>;

/**
 * A browser context in which Shift Manager runs as `user`.
 *
 * Shift Manager reads who it runs as from the connection config its start
 * script writes into the page (`window.__FSD_DEVTOOL_CONFIG__`), which names
 * the Lab's owner. A Lab has no sign-in, so a second person's browser is the
 * same page handed that person's own user id and verified bearer: the
 * context rewrites the config in each page document it loads, and nothing
 * else. For the Lab's owner the page is left as served.
 */
export async function personPage(browser: Browser, origin: string, user: LabUser, owner: boolean): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  if (!owner) {
    await context.route(`${origin}/**`, async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const html = await response.text();
      const rewritten = html.replace(/(window\.__FSD_DEVTOOL_CONFIG__ = )(\{.*?\})(;<\/script>)/, (_m, head: string, json: string, tail: string) => {
        const config = JSON.parse(json) as Record<string, unknown>;
        return `${head}${JSON.stringify({ ...config, userId: user.userId, ...(user.bearer === "" ? {} : { bearerToken: user.bearer }) })}${tail}`;
      });
      if (rewritten === html) throw new Error("the served page carries no connection config to hand another person");
      await route.fulfill({ response, body: rewritten });
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}

/** Open a Shift Manager path and wait for its shell to settle. */
export async function openShiftManager(page: Page, origin: string, path: string): Promise<void> {
  await page.goto(`${origin}${path}`);
  await page.getByTestId("shell").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=nav-tasks-count]")?.textContent?.includes("…"), undefined, { timeout: 30_000 });
}
