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
 *
 * `vite.build()` run in-process sets `process.env.NODE_ENV` to `production`
 * and never restores it. A Lab started after a build would inherit it, which
 * turns trace items off and stubs `node:` built-ins. The value this module saw
 * when it loaded is what every Lab it starts gets.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

/** A Shift Manager command serving a Lab. */
export type ServedShiftManager = { origin: string; workDir: string; child: ChildProcess; log: () => string; exited: Promise<void>; stop: () => Promise<void> };

/**
 * Shift Manager's command over the Lab at `config`, serving `pages`, from
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
  const child = spawn(TSX, [SHIFT_MANAGER_COMMAND, "--config", options.config, "--port", "0", "--no-open", "--assets", options.pages], {
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
    const served = servedAddresses(log);
    if (served !== undefined) return { origin: served.origin, workDir, child, log: () => log, exited, stop };
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
