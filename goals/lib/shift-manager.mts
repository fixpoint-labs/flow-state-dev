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
 * - {@link startShiftManager}: Shift Manager's own command over a Lab's
 *   `fsdev` config, from a scratch working directory.
 * - {@link SHIFT_MANAGER_COMMAND} and {@link servedAddresses}: the command's
 *   entry, and the addresses its banner prints, for a goal that starts it
 *   itself.
 * - {@link labApi}: the Lab's HTTP routes, read with the goal's own requests,
 *   so a goal's oracle is the store and never Shift Manager's state.
 * - {@link pendingSeatAsks}: the person's pending asks on the seats' sessions,
 *   picked the way Shift Manager picks them, and {@link workerOf}, the worker
 *   a listed session names.
 *
 * `vite.build()` run in-process sets `process.env.NODE_ENV` to `production`
 * and never restores it. A Lab started after a build would inherit it, which
 * turns trace items off and stubs `node:` built-ins. The value this module saw
 * when it loaded is what every Lab it starts gets.
 *
 * A goal that drives Shift Manager the way a person does also has
 * {@link buildShiftManagerPages} (the checkout as it stands), {@link labRoutes}
 * ({@link labApi} read as one verified user) and {@link personPage}.
 * {@link startShiftManager} serves another checkout when given `root`, `tsx`
 * and `timeoutMs`. `personPage` types against Playwright; only those goals
 * open a browser.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { intentFreeEnv } from "./env.mts";
import { REPO_ROOT, repoPath } from "./paths.mts";

/** `packages/shift-manager`. */
export const SHIFT_MANAGER: string = repoPath("packages", "shift-manager");

/** The `shift-manager` command's entry in the checkout, run with tsx. */
export const SHIFT_MANAGER_COMMAND: string = join(SHIFT_MANAGER, "cli", "bin.ts");

/**
 * The addresses a running `shift-manager` (`fsdev dev --app`) printed, once
 * its banner is complete: the pages' origin, with no trailing slash, and the
 * DevTool's, with one, or `null` when it serves none. Both on `127.0.0.1`,
 * where the default bind listens and the page's `fsdev-devtool-url` points;
 * the banner shows that host as `localhost`. `undefined` until the banner's
 * last line prints.
 */
export function servedAddresses(log: string): { origin: string; devtool: string | null } | undefined {
  const app = /App:\s+(http:\/\/\S+)/.exec(log);
  if (app === null || !/Data:/.test(log.slice(app.index))) return undefined;
  const on127 = (url: string) => new URL(url.replace("//localhost:", "//127.0.0.1:"));
  const devtool = /DevTool:\s+(http:\/\/\S+)/.exec(log);
  return { origin: on127(app[1]!).origin, devtool: devtool === null ? null : on127(devtool[1]!).href };
}

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
  // Its Vite config imports the workspace's build-inputs script the same way.
  const viteConfig = join(root, "vite.config.ts");
  writeFileSync(viteConfig, readFileSync(viteConfig, "utf8").replace('"../../scripts/build-inputs.mjs"', JSON.stringify(join(REPO_ROOT, "scripts", "build-inputs.mjs"))));
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

/**
 * How the Shift Manager checkout at `root` is started, and how its banner
 * names the pages' origin. A checkout with `cli/bin.ts` runs the
 * `shift-manager` command with `--no-open` and prints {@link servedAddresses}'
 * banner. An older one (`labs/shift-manager`) has only `bin/start.mts`, which
 * takes no `--no-open` and prints `Shift Manager: http://…`.
 */
function startCommand(root: string): { entry: string; flags: string[]; origin: (log: string) => string | undefined } {
  const command = join(root, "cli", "bin.ts");
  if (existsSync(command)) return { entry: command, flags: ["--no-open"], origin: (log) => servedAddresses(log)?.origin };
  const legacy = join(root, "bin", "start.mts");
  if (!existsSync(legacy)) throw new Error(`no Shift Manager start command under ${root}: neither cli/bin.ts nor bin/start.mts`);
  return { entry: legacy, flags: [], origin: (log) => /Shift Manager: (http:\/\/\S+)/.exec(log)?.[1] };
}

/** A Shift Manager command serving a Lab. */
export type ServedShiftManager = { origin: string; workDir: string; child: ChildProcess; log: () => string; exited: Promise<void>; stop: () => Promise<void> };

/**
 * Shift Manager's command over the Lab at `config`, serving `pages`, from
 * a fresh working directory under `<scratch>/labs`. `env` is added to the
 * child's environment; `GOAL_CONTROL` is always cleared, since a Lab's config
 * may read it too, and the intent ladder is stripped. `root` and `tsx` serve
 * another checkout (default: this one); `timeoutMs` defaults to 90s.
 */
export async function startShiftManager(options: {
  scratch: string;
  label: string;
  config: string;
  pages: string;
  env?: Record<string, string>;
  /** Shift Manager checkout to start: its `cli/bin.ts`, or an older checkout's `bin/start.mts`. Default: this one. */
  root?: string;
  /** `tsx` that runs the start command. Default: this workspace's. */
  tsx?: string;
  /** How long the start may take before it is refused. Default: 90s. */
  timeoutMs?: number;
}): Promise<ServedShiftManager> {
  const root = options.root ?? SHIFT_MANAGER;
  const tsx = options.tsx ?? TSX;
  mkdirSync(join(options.scratch, "labs"), { recursive: true });
  const workDir = mkdtempSync(join(options.scratch, "labs", `${options.label}-`));
  const env = intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "", ...options.env });
  if (NODE_ENV_AT_LOAD === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = NODE_ENV_AT_LOAD;
  let log = "";
  const start = startCommand(root);
  const child = spawn(tsx, [start.entry, "--config", options.config, "--port", "0", ...start.flags, "--assets", options.pages], {
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
  for (let waited = 0; waited < (options.timeoutMs ?? 90_000); waited += 250) {
    const origin = start.origin(log);
    if (origin !== undefined) return { origin, workDir, child, log: () => log, exited, stop };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's command never served ${options.label}. Log tail:\n${log.slice(-2000)}`);
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

/** Suspension reasons that are a person being asked something. */
const PERSON_REASONS = new Set(["human_approval", "human_input"]);

/** The worker a listed session runs, as its state names it (`workerId`), or `null` when it names none. */
export function workerOf(session: Readonly<Record<string, any>>): string | null {
  const worker = session.state?.[WORKER_ID_STATE_KEY];
  return typeof worker === "string" ? worker : null;
}

/** A person-ask still pending in a seat's session. */
export type PendingAsk = {
  suspensionId: string;
  /** The session it waits in. */
  sessionId: string;
  /** The seat that session names as its worker, or `null` when it names none. */
  seatId: string | null;
};

/**
 * The person's pending asks, read from the seats' sessions as Shift Manager
 * reads them (`packages/shift-manager/src/lib/reads.ts`): a session on a
 * seat's kind that names that seat as its worker, or names no worker at all,
 * whose asks are then the seat-less ones. An ask is a suspension asking a
 * person that holds no resume.
 *
 * @param api Reads one session's items by type: {@link LabApi}'s `items`, or a goal's own.
 * @param sessions The person's session listing, dispatch runs included: a seat
 *   a mailbox post woke asks from one.
 * @param seats The inventory's seats, each with the kind it runs on.
 */
export async function pendingSeatAsks(
  api: { items(sessionId: string, types: string[]): Promise<Array<Record<string, any>>> },
  sessions: ReadonlyArray<Readonly<Record<string, any>>>,
  seats: ReadonlyArray<{ id: string; kind: string | null }>,
): Promise<PendingAsk[]> {
  const ids = new Set(seats.map((s) => s.id));
  const kinds = new Set(seats.flatMap((s) => (s.kind === null ? [] : [s.kind])));
  const asks: PendingAsk[] = [];
  for (const session of sessions) {
    const seatId = workerOf(session);
    if (!kinds.has(String(session.flowKind)) || (seatId !== null && !ids.has(seatId))) continue;
    const found = await api.items(String(session.id), ["suspension", "suspension_resume"]);
    const resumed = new Set(found.filter((i) => i.type === "suspension_resume").map((i) => String(i.suspensionId)));
    for (const item of found) {
      if (item.type === "suspension" && PERSON_REASONS.has(String(item.reason)) && !resumed.has(String(item.suspensionId))) {
        asks.push({ suspensionId: String(item.suspensionId), sessionId: String(session.id), seatId });
      }
    }
  }
  return asks;
}

/**
 * Build Shift Manager's pages into `outDir` with the Vite the checkout at
 * `root` carries.
 *
 * @returns `outDir`, for `--assets`.
 */
export async function buildShiftManagerPages(outDir: string, root: string = SHIFT_MANAGER): Promise<string> {
  const viteEntry = createRequire(join(root, "package.json")).resolve("vite");
  const vite = (await import(pathToFileURL(viteEntry).href)) as { build(config: Record<string, unknown>): Promise<unknown> };
  const nodeEnv = process.env.NODE_ENV;
  try {
    await vite.build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true } });
  } finally {
    // Vite leaves `production` behind, which every child this process spawns would inherit.
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  return outDir;
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
 * {@link labApi} read as `user`. Collections are addressed by the key pattern
 * the session's manifest publishes. The fetch and the row paging are `labApi`'s.
 */
export function labRoutes(origin: string, user: LabUser) {
  const api = labApi(origin, user.bearer === "" ? undefined : user.bearer);
  const enc = encodeURIComponent;
  /** The collection ref a session's manifest publishes for a key pattern, or `undefined`. */
  const refOf = async (sessionId: string, pattern: string): Promise<string | undefined> => {
    const manifest = await api.get(`/sessions/${enc(sessionId)}/manifest`);
    return (manifest.resources as Array<{ kind: string; pattern?: string; ref: string }>).find((r) => r.kind === "collection" && r.pattern === pattern)?.ref;
  };
  /** Every row of the collection at `pattern`, read through `sessionId`. Throws when the session declares none. */
  const collection = async (sessionId: string, pattern: string): Promise<Array<Record<string, any>>> => {
    const ref = await refOf(sessionId, pattern);
    if (ref === undefined) throw new Error(`session ${sessionId} declares no collection ${pattern}`);
    return api.collection(sessionId, ref);
  };
  /** Every item of `types` (comma-separated) in one session, in stored order. */
  const items = (sessionId: string, types: string): Promise<StoredItem[]> =>
    api.items(sessionId, types === "" ? [] : types.split(",")) as Promise<StoredItem[]>;
  /** The user's sessions, dispatch runs included. */
  const sessions = async (): Promise<Array<{ id: string; flowId?: string; flowKind?: string; parentSessionId?: string | null; createdAt: number }>> =>
    (await api.get(`/sessions?userId=${enc(user.userId)}&include=dispatch-runs`)).sessions ?? [];
  /** The requests one session holds, newest last as the route lists them. */
  const requests = async (sessionId: string): Promise<Array<Record<string, any>>> => {
    const out: Array<Record<string, any>> = [];
    for (let offset = 0; offset < 5000; offset += 200) {
      const listed = await api.get(`/sessions/${enc(sessionId)}/requests?include_result_output=true&limit=200&offset=${offset}`);
      const page = (listed.requests ?? []) as Array<Record<string, any>>;
      out.push(...page);
      if (page.length < 200) break;
    }
    return out;
  };
  /** A request's status. */
  const status = async (flowId: string, requestId: string): Promise<string | undefined> =>
    (await api.call("GET", `/${enc(flowId)}/requests/${enc(requestId)}/status`)).body?.status as string | undefined;
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
    const posted = await api.call("POST", `/${enc(kind)}/${enc(sessionId)}/actions/${enc(action)}`, { userId: user.userId, input });
    if (posted.status !== 202) return { status: `http ${posted.status}`, output: undefined, error: JSON.stringify(posted.body) };
    const requestId = String(posted.body?.request?.id);
    const settled = await settle(kind, requestId, 60_000);
    const found = (await requests(sessionId)).find((r) => r.id === requestId);
    return { status: settled, output: found?.result?.output, error: found?.result?.error?.message };
  };
  return { user, call: api.call, get: api.get, refOf, collection, items, sessions, requests, status, settle, act };
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
