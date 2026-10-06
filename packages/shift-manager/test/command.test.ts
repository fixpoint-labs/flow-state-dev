/**
 * The `shift-manager` command, as a person runs it: `fsdev dev`'s app hook
 * with Shift Manager as the app. One process serves the Lab's API and the
 * pages on one port and the DevTool on a port of its own (BR-1); bad input
 * stops it with exit code 3 before anything listens (BR-2, BR-3, BR-6, BR-11);
 * SIGTERM closes both servers and leaves nothing behind (BR-26).
 *
 * Each case runs the command's own entry in a child process, from a scratch
 * working directory. That directory holds a stand-in DevTool build where
 * `fsdev dev` looks for one in a checkout, so the DevTool is served whether or
 * not the real one is built.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getAssetPath, getSourceRoot } from "../cli/index.ts";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const repo = join(pkg, "../..");
const tsx = join(pkg, "node_modules", ".bin", "tsx");
const assets = fileURLToPath(new URL("./fixtures/assets", import.meta.url));
const devtoolAssets = fileURLToPath(new URL("./fixtures/devtool-assets", import.meta.url));
const lab = join(repo, "packages/shift-manager/test/fixtures/multi-seat-collab/fsdev.config.mts");
const devteam = join(pkg, "teams/devteam/fsdev.config.mts");

const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGTERM");
});

/** A scratch working directory with a stand-in DevTool build where a checkout keeps one. */
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "shift-manager-cmd-"));
  mkdirSync(join(dir, "apps/devtool"), { recursive: true });
  cpSync(devtoolAssets, join(dir, "apps/devtool/dist"), { recursive: true });
  return dir;
}

/**
 * Run the command from `cwd` (by default a fresh {@link workDir}), with
 * `--port 0 --no-open --assets <fixture pages>` unless `bare`.
 */
function run(args: string[], options: { cwd?: string; env?: Record<string, string | undefined>; bare?: boolean } = {}) {
  const cwd = options.cwd ?? workDir();
  const child = spawn(tsx, [join(pkg, "cli/bin.ts"), ...args, ...(options.bare ? [] : ["--port", "0", "--no-open", "--assets", assets])], {
    cwd,
    env: {
      ...process.env,
      SHIFT_MANAGER_SHIFT: undefined,
      INIT_CWD: cwd,
      // DevTeam keeps a store across restarts; each run here gets its own.
      DEVTEAM_STORE: join(mkdtempSync(join(tmpdir(), "sm-cmd-store-")), "devteam.sqlite"),
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.push(child);
  let output = "";
  child.stdout!.on("data", (d) => (output += String(d)));
  child.stderr!.on("data", (d) => (output += String(d)));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const listening = new Promise<{ origin: string; devtool: string | undefined }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no address printed:\n${output}`)), 90_000);
    const check = () => {
      const app = /App:\s+(http:\/\/\S+)/.exec(output);
      if (app === null || !/Data:/.test(output)) return;
      clearTimeout(timer);
      resolve({ origin: app[1]!, devtool: /DevTool:\s+(http:\/\/\S+)/.exec(output)?.[1] });
    };
    child.stderr!.on("data", check);
    void exited.then(() => {
      clearTimeout(timer);
      reject(new Error(`exited before listening:\n${output}`));
    });
  });
  // A case that expects a refusal never awaits this; keep its rejection handled.
  listening.catch(() => undefined);
  return { child, cwd, listening, exited, output: () => output };
}

const page = async (origin: string, path = "/tasks") => (await fetch(`${origin}${path}`)).text();
const meta = (html: string, name: string) => new RegExp(`<meta name="${name}" content="([^"]+)">`).exec(html)?.[1];

describe("the shift-manager command", () => {
  it("serves a Lab's API and Shift Manager's pages from one process, and prints both addresses and the config path (BR-1)", async () => {
    const app = run(["--config", lab]);
    const { origin, devtool } = await app.listening;
    expect(await page(origin, "/w/anything/stream")).toContain("shift-manager-test-pages");
    const sessions = await fetch(`${origin}/api/flows/sessions?userId=${encodeURIComponent("u_multi_seat_collab")}`);
    expect(sessions.status).toBe(200);
    expect(devtool).toBeDefined();
    expect(app.output()).toContain(`config: ${lab}`);
  }, 120_000);

  it("hands the page the DevTool's address as fsdev-devtool-url, a DevTool over the same Lab's store", async () => {
    const app = run(["--config", devteam]);
    const { origin } = await app.listening;
    const html = await page(origin);
    const devtool = meta(html, "fsdev-devtool-url");
    expect(devtool).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(html).not.toContain("shift-manager-devtool");

    const devtoolPage = await page(devtool!, "/");
    expect(devtoolPage).toContain("__FSD_DEVTOOL_CONFIG__");
    const config = JSON.parse(/__FSD_DEVTOOL_CONFIG__\s*=\s*(\{.*?\});?<\/script>/s.exec(devtoolPage)![1]!) as { userId: string; bearerToken?: string };
    const headers = config.bearerToken === undefined ? undefined : { authorization: `Bearer ${config.bearerToken}` };
    const list = async (base: string) => {
      const res = await fetch(new URL(`api/flows/sessions?userId=${encodeURIComponent(config.userId)}`, base), { headers });
      expect(res.status).toBe(200);
      // The ids are seeded, so they would match across two stores. When a
      // session was created and its lineage id would not.
      return ((await res.json()) as { sessions: Array<{ id: string; createdAt: number; lineageId?: string }> }).sessions
        .map((s) => `${s.id}@${s.createdAt}/${s.lineageId ?? ""}`)
        .sort();
    };
    const fromApp = await list(`${origin}/`);
    expect(fromApp.length).toBeGreaterThan(0);
    expect(await list(devtool!)).toEqual(fromApp);
  }, 120_000);

  it("hands the page the Lab's bearer on a loopback host, and refuses a network host for that Lab before it listens", async () => {
    const { origin } = await run(["--config", devteam]).listening;
    expect(await page(origin, "/inbox")).toContain("bearerToken");

    const network = run(["--config", devteam, "--host", "0.0.0.0"]);
    expect(await network.exited).toBe(3);
    expect(network.output()).toMatch(/Refusing to bind 0\.0\.0\.0: this config hands its page a bearer token/);
    expect(network.output()).not.toMatch(/App:\s+http/);
  }, 120_000);

  it("boots on the shift it is given, by --shift or SHIFT_MANAGER_SHIFT, and on none when given neither (BR-11)", async () => {
    const scheme = async (app: ReturnType<typeof run>) => meta(await page((await app.listening).origin), "shift-manager-color-scheme");
    expect(await scheme(run(["--config", lab]))).toBeUndefined();
    expect(await scheme(run(["--config", lab, "--shift", "night"]))).toBe("dark");
    expect(await scheme(run(["--config", lab], { env: { SHIFT_MANAGER_SHIFT: "day" } }))).toBe("light");
    // The flag wins over the environment.
    expect(await scheme(run(["--config", lab, "--shift", "day"], { env: { SHIFT_MANAGER_SHIFT: "night" } }))).toBe("light");

    const refused = run(["--config", lab, "--shift", "dusk"]);
    expect(await refused.exited).toBe(3);
    expect(refused.output()).toMatch(/No shift "dusk".*day, night/);
  }, 180_000);

  it("finds the config in the directory it ran in, and without one refuses, naming --config (BR-2)", async () => {
    const withConfig = workDir();
    writeFileSync(join(withConfig, "fsdev.config.mts"), `export { default } from ${JSON.stringify(lab)};\n`);
    const { origin } = await run([], { cwd: withConfig }).listening;
    expect(await page(origin)).toContain("shift-manager-test-pages");

    const none = run([]);
    expect(await none.exited).toBe(3);
    expect(none.output()).toMatch(/--config/);
    expect(none.output()).not.toMatch(/App:\s+http/);
  }, 120_000);

  it("resolves a relative --config from the directory it ran in (BR-4)", async () => {
    const { origin } = await run(["--config", "packages/shift-manager/test/fixtures/multi-seat-collab/fsdev.config.mts"], { cwd: repo }).listening;
    expect(await page(origin)).toContain("shift-manager-test-pages");
  }, 120_000);

  it("refuses a config that isn't there, or isn't a FlowState, with the loader's message, exit 3 (BR-3)", async () => {
    const missing = run(["--config", join(pkg, "test/fixtures/missing/fsdev.config.mts")]);
    expect(await missing.exited).toBe(3);
    expect(missing.output()).toMatch(/Config file not found/);

    const notFlowState = run(["--config", join(pkg, "test/fixtures/not-a-flowstate/fsdev.config.mts")]);
    expect(await notFlowState.exited).toBe(3);
    expect(notFlowState.output()).toMatch(/must default-export a FlowState/);
    expect(notFlowState.output()).not.toMatch(/App:\s+http/);
  }, 120_000);

  it("refuses --assets with no index.html, and an invalid port, exit 3 (BR-5, BR-6)", async () => {
    const empty = mkdtempSync(join(tmpdir(), "sm-cmd-empty-pages-"));
    const noIndex = run(["--config", lab, "--port", "0", "--no-open", "--assets", empty], { bare: true });
    expect(await noIndex.exited).toBe(3);
    expect(noIndex.output()).toMatch(/no index\.html/);

    const port = run(["--config", lab, "--port", "12abc", "--no-open", "--assets", assets], { bare: true });
    expect(await port.exited).toBe(3);
    expect(port.output()).toMatch(/Invalid port: 12abc/);
  }, 60_000);

  it("refuses the flags it no longer has: --team, --devtool, --devtool-assets", async () => {
    for (const flag of [["--team", "devteam"], ["--devtool", "http://127.0.0.1:4000"], ["--devtool-assets", assets]]) {
      const app = run(["--config", lab, ...flag]);
      expect(await app.exited).toBe(3);
      expect(app.output()).toContain(`Unknown option '${flag[0]}'`);
    }
  }, 60_000);

  it("with --dev in a checkout, serves the pages from source through Vite on the Lab's origin, with the page config (BR-21)", async () => {
    const app = run(["--config", devteam, "--port", "0", "--no-open", "--dev", "--shift", "night"], { bare: true });
    const { origin } = await app.listening;
    const html = await page(origin, "/inbox");
    expect(html).toContain("/@vite/client");
    expect(html).toContain("/src/main.tsx");
    expect(meta(html, "fsdev-devtool-url")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(meta(html, "shift-manager-color-scheme")).toBe("dark");
    expect(html).toContain("bearerToken");
    // A module comes through Vite; the API answers on the same origin, no proxy.
    expect((await fetch(`${origin}/src/main.tsx`)).headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${origin}/api/flows`)).status).toBe(200);
  }, 180_000);

  it("refuses --dev on a network host before it listens, whatever pages it serves", async () => {
    for (const pages of [[], ["--assets", assets]]) {
      const app = run(["--config", lab, "--port", "0", "--no-open", "--dev", "--host", "0.0.0.0", ...pages], { bare: true });
      expect(await app.exited).toBe(3);
      expect(app.output()).toMatch(/Refusing --watch on 0\.0\.0\.0/);
      expect(app.output()).not.toMatch(/App:\s+http/);
    }
  }, 60_000);

  it("closes both servers on SIGTERM and exits 0, leaving nothing in its temp directory (BR-26)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sm-cmd-tmp-"));
    const app = run(["--config", lab, "--shift", "night"], { env: { TMPDIR: tmp, TMP: tmp, TEMP: tmp } });
    const { origin, devtool } = await app.listening;
    app.child.kill("SIGTERM");
    expect(await app.exited).toBe(0);
    await expect(fetch(origin)).rejects.toThrow();
    await expect(fetch(devtool!)).rejects.toThrow();
    expect(readdirSync(tmp).filter((f) => f.startsWith("shift-manager"))).toEqual([]);
  }, 120_000);
});

describe("the package's app contract", () => {
  it("getAssetPath() is the built pages' directory in this package; getSourceRoot() is the folder holding the source index.html", () => {
    expect(getAssetPath()).toBe(join(pkg, "dist-client"));
    const root = getSourceRoot();
    expect(root).toBe(pkg.replace(/\/$/, ""));
    expect(readFileSync(join(root!, "index.html"), "utf8")).toContain("/src/main.tsx");
  });

  it("names no start script and no shift-manager-devtool meta anywhere it ships or tests", () => {
    expect(existsSync(join(pkg, "bin/start.mts"))).toBe(false);
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (["node_modules", "dist", "dist-client", "fixtures"].includes(e.name) ? [] : files(join(dir, e.name))) : [join(dir, e.name)],
      );
    const hits = files(pkg).filter((f) => f !== fileURLToPath(import.meta.url) && /\.(ts|tsx|mts|json|html)$/.test(f) && /shift-manager-devtool"|bin\/start\.mts/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
