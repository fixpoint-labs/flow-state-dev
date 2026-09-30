/**
 * V1: the start command, as a person runs it. One process serves the Lab's
 * API and App Lab's pages over a Lab's own config (BR-1); a config that won't
 * load, or doesn't default-export a `FlowState`, stops it non-zero with the
 * loader's own message (BR-2).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const assets = fileURLToPath(new URL("./fixtures/assets", import.meta.url));

const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGTERM");
});

/** Run the start script from the repo root, the way `pnpm --filter … start` does. */
function start(config: string, extra: string[] = [], host = "127.0.0.1") {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "bin/start.mts", "--config", config, "--port", "0", "--host", host, "--assets", assets, ...extra],
    { cwd: pkg, env: { ...process.env, INIT_CWD: repo }, stdio: ["ignore", "pipe", "pipe"] },
  );
  running.push(child);
  let output = "";
  child.stdout!.on("data", (d) => (output += String(d)));
  child.stderr!.on("data", (d) => (output += String(d)));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const listening = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no address printed:\n${output}`)), 60_000);
    const check = () => {
      const match = /App Lab: (http:\/\/\S+)/.exec(output);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    };
    child.stderr!.on("data", check);
    void exited.then(() => {
      clearTimeout(timer);
      reject(new Error(`exited before listening:\n${output}`));
    });
  });
  // A test that expects the refusal never awaits this; keep its rejection handled.
  listening.catch(() => undefined);
  return { child, listening, exited, output: () => output };
}

describe("the start command", () => {
  it("serves a Lab's API and App Lab's pages from one process, over the Lab's own config", async () => {
    const app = start("goals/multi-seat-collab/lab/fsdev.config.mts");
    const origin = await app.listening;
    const page = await fetch(`${origin}/w/anything/stream`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("app-lab-test-pages");
    const sessions = await fetch(`${origin}/api/flows/sessions?userId=${encodeURIComponent("u_multi_seat_collab")}`);
    expect(sessions.status).toBe(200);
  }, 90_000);

  it("writes --devtool into the served pages for the trace link, and leaves it out without the flag (BR-23)", async () => {
    const withFlag = start("goals/multi-seat-collab/lab/fsdev.config.mts", ["--devtool", "http://127.0.0.1:4000"]);
    const page = await (await fetch(`${await withFlag.listening}/tasks`)).text();
    expect(page).toContain('<meta name="app-lab-devtool" content="http://127.0.0.1:4000/">');
    expect(page).toContain("app-lab-test-pages");

    const without = start("goals/multi-seat-collab/lab/fsdev.config.mts");
    expect(await (await fetch(`${await without.listening}/tasks`)).text()).not.toContain("app-lab-devtool");

    const refused = start("goals/multi-seat-collab/lab/fsdev.config.mts", ["--devtool", "javascript:alert(1)"]);
    expect(await refused.exited).not.toBe(0);
    expect(refused.output()).toMatch(/--devtool must be an http\(s\) address/);
  }, 120_000);

  it("removes the --devtool copy of the pages when it stops, and makes none when the Lab doesn't load", async () => {
    const copies = () => new Set(readdirSync(tmpdir()).filter((d) => d.startsWith("app-lab-pages-")));
    const before = copies();
    const app = start("goals/multi-seat-collab/lab/fsdev.config.mts", ["--devtool", "http://127.0.0.1:4000"]);
    await app.listening;
    const made = [...copies()].filter((d) => !before.has(d));
    expect(made).toHaveLength(1);
    app.child.kill("SIGTERM");
    await app.exited;
    expect(existsSync(join(tmpdir(), made[0]!))).toBe(false);

    const unloaded = start("labs/app-lab/test/fixtures/missing/fsdev.config.mts", ["--devtool", "http://127.0.0.1:4000"]);
    expect(await unloaded.exited).not.toBe(0);
    expect([...copies()].filter((d) => !before.has(d))).toEqual([]);
  }, 120_000);

  it("hands the page the Lab's bearer on a loopback host, and refuses a network host outright", async () => {
    const config = "goals/devforce-lab/lab/fsdev.config.mts";
    const loopback = await start(config).listening;
    const local = await (await fetch(`${loopback}/inbox`)).text();
    expect(local).toContain("__FSD_DEVTOOL_CONFIG__");
    expect(local).toContain("bearerToken");

    // A network bind would hand the token to a page served off-machine; the
    // start command refuses before it listens, so no page is ever served.
    const network = start(config, [], "0.0.0.0");
    const code = await network.exited;
    expect(code).not.toBe(0);
    expect(network.output()).toMatch(/won't serve 0\.0\.0\.0: this Lab hands its page a bearer token/);
    expect(network.output()).not.toMatch(/App Lab: http/);
  }, 120_000);

  it("refuses a config path with nothing at it, with the loader's message", async () => {
    const app = start("labs/app-lab/test/fixtures/missing/fsdev.config.mts");
    const code = await app.exited;
    expect(code).not.toBe(0);
    expect(app.output()).toMatch(/fsdev\.config\.mts/);
    expect(app.output()).not.toMatch(/App Lab: http/);
  }, 90_000);

  it("refuses a config whose default export is not a FlowState, with the loader's message", async () => {
    const app = start("labs/app-lab/test/fixtures/not-a-flowstate/fsdev.config.mts");
    const code = await app.exited;
    expect(code).not.toBe(0);
    expect(app.output()).toMatch(/FlowState/);
    expect(app.output()).not.toMatch(/App Lab: http/);
  }, 90_000);
});
