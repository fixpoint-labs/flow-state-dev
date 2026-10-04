/**
 * `fsdev dev --watch` on a real process: the command runs as `fsdev` does,
 * re-runs itself under `node --watch`, and every case saves a real file.
 *
 * The Lab lives in a temp directory with the framework linked into its
 * `node_modules`. Each served page carries the boot id of the child that
 * rendered it, so a new id is a restart. A save that must not restart is
 * checked by the id staying put after `node --watch`'s debounce and a restart's
 * worth of time.
 *
 * The page leg runs the reload script the page carries, as served, in a
 * separate Node process with a real `EventSource`, against the same origin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cli = resolve(import.meta.dirname, "..");
const packages = resolve(cli, "..");
const tsxLoader = pathToFileURL(createRequire(join(cli, "package.json")).resolve("tsx")).href;

const flowModule = (kind: string) => `
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
export const flow = defineFlow({
  kind: ${JSON.stringify(kind)},
  actions: {
    ping: {
      inputSchema: z.object({}).passthrough(),
      block: handler({ name: "ping", inputSchema: z.object({}).passthrough(), execute: () => undefined }),
    },
  },
})();
`;

const CONFIG = `
import { createFlowState, createInMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { readFileSync } from "node:fs";
import { flow } from "./flows/hello.mts";
import "fake-dep";
// A tree read from disk at import, as a team's WORKER.md files are.
if (readFileSync(new URL("./tree/a/WORKER.md", import.meta.url), "utf8").includes("BROKEN")) {
  throw new Error("tree/a/WORKER.md is broken");
}
export default createFlowState({
  flows: { hello: flow },
  modelResolver: createMockModelResolver({}),
  stores: { default: { primary: { capabilities: ["primary"], resolve: () => Promise.resolve(createInMemoryStores()) } } },
});
`;

/** A real Vite install, for an app whose own install has one. */
const viteInstall = resolve(packages, "..", "apps", "devtool", "node_modules", "vite");

const PAGE = "<!doctype html><html><head><title>lab</title></head><body>built page</body></html>";

/** A Lab directory: config, an imported flow module, a tree file, built pages, data files, a dependency. */
async function makeLab(): Promise<string> {
  const lab = await realpath(await mkdtemp(join(tmpdir(), "fsdev-watch-lab-")));
  const modules = join(lab, "node_modules");
  await mkdir(join(modules, "@flow-state-dev"), { recursive: true });
  for (const pkg of ["core", "engine", "testing"]) {
    await symlink(join(packages, pkg), join(modules, "@flow-state-dev", pkg), "dir");
  }
  await symlink(await realpath(join(cli, "node_modules", "zod")), join(modules, "zod"), "dir");
  await mkdir(join(modules, "fake-dep"));
  await writeFile(join(modules, "fake-dep", "package.json"), JSON.stringify({ name: "fake-dep", type: "module", main: "index.js" }));
  await writeFile(join(modules, "fake-dep", "index.js"), "export const v = 1;\n");

  await mkdir(join(lab, "flows"));
  await writeFile(join(lab, "flows", "hello.mts"), flowModule("hello-a"));
  await writeFile(join(lab, "fsdev.config.mts"), CONFIG);
  await mkdir(join(lab, "tree", "a"), { recursive: true });
  await writeFile(join(lab, "tree", "a", "WORKER.md"), "# a\n");
  await mkdir(join(lab, "pages"));
  await writeFile(join(lab, "pages", "index.html"), PAGE);
  await mkdir(join(lab, "data"));
  await writeFile(join(lab, "data", "lab.sqlite"), "v1");
  await mkdir(join(lab, ".fsdev"));
  await writeFile(join(lab, ".fsdev", "state.json"), "{}");
  await writeFile(join(lab, ".env.local"), "LAB_KEY=a\n");
  return lab;
}

/** A running `fsdev dev --watch` and what it printed. */
interface Run {
  proc: ChildProcess;
  output: string;
  url: string;
}

/** Start `fsdev dev --watch <args>` in `cwd`, as `fsdev` runs, and wait for its first child to serve. */
async function startWatch(cwd: string, args: string[]): Promise<Run> {
  const proc = spawn(
    process.execPath,
    ["--import", tsxLoader, join(cli, "src", "bin.ts"), "dev", "--watch", "--port", "0", "--no-open", ...args],
    { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } },
  );
  const run: Run = { proc, output: "", url: "" };
  proc.stdout!.on("data", (d) => (run.output += String(d)));
  proc.stderr!.on("data", (d) => (run.output += String(d)));
  const until = Date.now() + 60_000;
  while (!/App: +http:\/\/localhost:\d+/.test(run.output)) {
    if (Date.now() > until || proc.exitCode !== null) throw new Error(`fsdev dev --watch didn't start:\n${run.output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  run.url = `${/App: +(http:\/\/localhost:\d+)/.exec(run.output)![1]}/`;
  await nextBoot(run, undefined);
  return run;
}

/** Stop a run, as Ctrl-C's SIGTERM sibling does. */
async function stop(run: Run | undefined): Promise<void> {
  if (run === undefined || run.proc.exitCode !== null) return;
  const exited = new Promise((r) => run.proc.once("exit", r));
  run.proc.kill("SIGTERM");
  await exited;
}

/** The boot id in the page the server renders now, or `undefined` while no child serves. */
async function bootId(run: Run): Promise<string | undefined> {
  try {
    const html = await (await fetch(run.url, { signal: AbortSignal.timeout(2_000) })).text();
    return /<meta name="fsdev-dev-boot" content="([^"]+)">/.exec(html)?.[1];
  } catch {
    return undefined;
  }
}

/** Wait until a child other than `previous` serves, and return its boot id. */
async function nextBoot(run: Run, previous: string | undefined, timeoutMs = 30_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const id = await bootId(run);
    if (id !== undefined && id !== previous) return id;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`no restart within ${timeoutMs}ms\n${run.output}`);
}

/** Boot ids seen across a quiet period: one entry means no restart. */
async function bootsOver(run: Run, ms: number): Promise<Set<string | undefined>> {
  const seen = new Set<string | undefined>();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    seen.add(await bootId(run));
    await new Promise((r) => setTimeout(r, 150));
  }
  return seen;
}

let lab: string;
let run: Run;
let url: string;

beforeAll(async () => {
  lab = await makeLab();
  run = await startWatch(lab, ["--config", "fsdev.config.mts", "--app", "./pages"]);
  url = run.url;
}, 90_000);

afterAll(() => stop(run));

describe("fsdev dev --watch on a real child", () => {
  it("restarts on a save to a module the Lab imported, on the same port, and serves the change", async () => {
    const before = await bootId(run);
    expect((await (await fetch(`${url}api/flows`)).text())).toContain("hello-a");
    await writeFile(join(lab, "flows", "hello.mts"), flowModule("hello-b"));
    await nextBoot(run, before);
    const flows = await (await fetch(`${url}api/flows`)).text();
    expect(flows).toContain("hello-b");
    expect(flows).not.toContain("hello-a");
  }, 60_000);

  it("restarts on a save to a file under the config's directory that no module imports", async () => {
    const before = await bootId(run);
    await writeFile(join(lab, "tree", "a", "WORKER.md"), "# a, edited\n");
    await nextBoot(run, before);
  }, 60_000);

  it.each([
    ["a page file", "pages/index.html", PAGE.replace("built page", "built page, edited")],
    ["a data file", "data/lab.sqlite", "v2"],
    ["a file in a dot directory", ".fsdev/state.json", '{"x":1}'],
    ["a module under node_modules the Lab imported", "node_modules/fake-dep/index.js", "export const v = 2;\n"],
  ])("does not restart on a save to %s", async (_what, file, content) => {
    const before = await bootId(run);
    expect(before).toBeDefined();
    await writeFile(join(lab, file), content);
    expect([...(await bootsOver(run, 3_000))]).toEqual([before]);
  }, 60_000);

  it("restarts on a save to an .env.local file the Lab loaded", async () => {
    const before = await bootId(run);
    await writeFile(join(lab, ".env.local"), "LAB_KEY=b\n");
    await nextBoot(run, before);
  }, 60_000);

  it("restarts, on the same port, when a file is created under the config's directory after it started", async () => {
    const before = await bootId(run);
    await mkdir(join(lab, "tree", "b"));
    await writeFile(join(lab, "tree", "b", "WORKER.md"), "# b\n");
    await nextBoot(run, before);
    // Its next save is a save to a known file.
    const after = await bootId(run);
    await writeFile(join(lab, "tree", "b", "WORKER.md"), "# b, edited\n");
    await nextBoot(run, after);
  }, 90_000);

  it.each([
    ["a new data file", "data/new.sqlite"],
    ["a new file in a dot directory", ".fsdev/new.json"],
    ["a new page file", "pages/new.html"],
  ])("does not restart when %s is created", async (_what, file) => {
    const before = await bootId(run);
    expect(before).toBeDefined();
    await writeFile(join(lab, file), "x");
    expect([...(await bootsOver(run, 3_000))]).toEqual([before]);
  }, 60_000);

  it("keeps watching after a failed restart, and the next save starts it again", async () => {
    await writeFile(join(lab, "flows", "hello.mts"), "export const flow = ;\n");
    const until = Date.now() + 30_000;
    while (!/Failed running/.test(run.output) && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
    expect(run.output).toMatch(/Failed running/);
    expect(run.proc.exitCode).toBeNull();
    expect(await bootId(run)).toBeUndefined();

    await writeFile(join(lab, "flows", "hello.mts"), flowModule("hello-c"));
    await nextBoot(run, undefined);
    expect(await (await fetch(`${url}api/flows`)).text()).toContain("hello-c");
  }, 90_000);

  it("keeps watching after a tree file breaks the Lab's load, and restarts when it is fixed", async () => {
    const failures = (run.output.match(/Failed running/g) ?? []).length;
    await writeFile(join(lab, "tree", "a", "WORKER.md"), "# a BROKEN\n");
    const until = Date.now() + 30_000;
    while ((run.output.match(/Failed running/g) ?? []).length === failures && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(run.output).toContain("tree/a/WORKER.md is broken");
    expect(await bootId(run)).toBeUndefined();

    await writeFile(join(lab, "tree", "a", "WORKER.md"), "# a, fixed\n");
    await nextBoot(run, undefined);
  }, 90_000);

  it("reloads an open built page by itself when the next child is up, after a failed one, on the same origin", async () => {
    const html = await (await fetch(url)).text();
    expect(html).toContain("built page");
    const boot = /<meta name="fsdev-dev-boot" content="([^"]+)">/.exec(html)![1]!;
    const script = /<script>(\(function\(\)\{var m=document[\s\S]*?)<\/script>/.exec(html)![1]!;

    // The page's own script, with the page's origin and boot meta, in a process
    // with a real EventSource. It prints "reload" when the script reloads.
    const page = spawn(
      process.execPath,
      [
        "--experimental-eventsource",
        "--no-warnings",
        "-e",
        `const ES = globalThis.EventSource;
         globalThis.EventSource = class extends ES { constructor(u) { super(new URL(u, ${JSON.stringify(url)})); } };
         globalThis.document = { querySelector: () => ({ getAttribute: () => ${JSON.stringify(boot)} }) };
         globalThis.location = { reload() { process.stdout.write("reload\\n", () => process.exit(0)); } };
         setTimeout(() => { console.log("connected"); }, 1000);
         setInterval(() => {}, 1000); // an open tab: stays up while the server is down
         ${script}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let pageOut = "";
    page.stdout!.on("data", (d) => (pageOut += String(d)));
    page.stderr!.on("data", (d) => (pageOut += String(d)));
    try {
      // Connected to the child that rendered it, it stays put.
      const until = Date.now() + 10_000;
      while (!pageOut.includes("connected") && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
      expect(pageOut).toBe("connected\n");

      // A save that fails keeps the server down for a while, as a syntax error
      // does while someone types; the page must find the child the fix starts.
      const failures = (run.output.match(/Failed running/g) ?? []).length;
      await writeFile(join(lab, "flows", "hello.mts"), "export const flow = ;\n");
      const down = Date.now() + 30_000;
      while ((run.output.match(/Failed running/g) ?? []).length === failures && Date.now() < down) {
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 5_000));
      expect(pageOut).toBe("connected\n");
      await writeFile(join(lab, "flows", "hello.mts"), flowModule("hello-d"));
      const reloaded = new Promise<number | null>((r) => page.once("close", r));
      expect(await Promise.race([reloaded, new Promise((r) => setTimeout(() => r("timeout"), 30_000))])).toBe(0);
      expect(pageOut).toBe("connected\nreload\n");
      // It reloads into the same origin, now served by the new child.
      expect(await bootId(run)).not.toBe(boot);
      expect(await (await fetch(url)).text()).toContain("built page");
    } finally {
      page.kill();
    }
  }, 60_000);

  it("stops the watcher and its child when the command gets SIGTERM", async () => {
    expect(await bootId(run)).toBeDefined();
    const exited = new Promise<number | null>((r) => run.proc.once("exit", r));
    run.proc.kill("SIGTERM");
    expect(await exited).toBe(0);
    // Nothing is left serving the port.
    await expect(fetch(url, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow();
  }, 30_000);
});

describe("fsdev dev --watch with input that names a missing file", () => {
  it.each([
    ["--config", ["--config", "missing.config.mts"], "Config file not found"],
    ["--dotenv", ["--dotenv", "missing.env"], "--dotenv file not found"],
  ])("exits with the config error for a missing %s, rather than wait on a save", async (_flag, args, message) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "fsdev-watch-missing-")));
    const proc = spawn(
      process.execPath,
      ["--import", tsxLoader, join(cli, "src", "bin.ts"), "dev", "--watch", "--port", "0", "--no-open", ...args],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } },
    );
    let output = "";
    proc.stderr!.on("data", (d) => (output += String(d)));
    const code = await Promise.race([
      new Promise<number | null>((r) => proc.once("exit", r)),
      new Promise((r) => setTimeout(() => r("still running"), 20_000)),
    ]);
    proc.kill("SIGTERM");
    expect(code).toBe(3);
    expect(output).toContain(message);
  }, 30_000);
});

describe("fsdev dev --watch with an app served from source", () => {
  let viteRun: Run | undefined;
  let viteLab: string;
  afterAll(() => stop(viteRun));

  it("serves it through the app's Vite and stays up: Vite's own files never restart it", async () => {
    viteLab = await makeLab();
    const pkg = join(viteLab, "node_modules", "@acme", "ops-console");
    await mkdir(join(pkg, "web"), { recursive: true });
    await mkdir(join(pkg, "node_modules"));
    await symlink(await realpath(viteInstall), join(pkg, "node_modules", "vite"), "dir");
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@acme/ops-console", type: "module", main: "index.js" }));
    await writeFile(
      join(pkg, "index.js"),
      `import { fileURLToPath } from "node:url";\n` +
        `export function getAssetPath() { return fileURLToPath(new URL("./dist", import.meta.url)); }\n` +
        `export function getSourceRoot() { return fileURLToPath(new URL("./web", import.meta.url)); }\n`,
    );
    // A config file, so Vite bundles and imports one as it does for a real app.
    await writeFile(join(pkg, "web", "vite.config.mjs"), "export default { logLevel: 'warn' };\n");
    await writeFile(join(pkg, "web", "index.html"), '<!doctype html><html><head></head><body>from source<script type="module" src="/main.js"></script></body></html>');
    await writeFile(join(pkg, "web", "main.js"), "export const v = 1;\n");

    viteRun = await startWatch(viteLab, ["--config", "fsdev.config.mts", "--app", "@acme/ops-console"]);
    const html = await (await fetch(viteRun.url)).text();
    expect(html).toContain("from source");
    expect(html).toContain("/@vite/client");
    expect((await fetch(`${viteRun.url}main.js`)).status).toBe(200);
    // No restart loop once Vite has loaded its config and served a module.
    expect((await bootsOver(viteRun, 4_000)).size).toBe(1);

    // A page source save is Vite's business, not a restart.
    const before = await bootId(viteRun);
    await writeFile(join(pkg, "web", "main.js"), "export const v = 2;\n");
    expect([...(await bootsOver(viteRun, 3_000))]).toEqual([before]);

    // A Lab change still restarts it.
    await writeFile(join(viteLab, "flows", "hello.mts"), flowModule("hello-v"));
    await nextBoot(viteRun, before);
    expect(await (await fetch(`${viteRun.url}api/flows`)).text()).toContain("hello-v");
  }, 120_000);
});

