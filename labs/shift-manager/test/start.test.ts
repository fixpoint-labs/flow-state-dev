/**
 * V1: the start command, as a person runs it. One process serves the Lab's
 * API and Shift Manager's pages over a Lab's own config (BR-1); a config that won't
 * load, or doesn't default-export a `FlowState`, stops it non-zero with the
 * loader's own message (BR-2).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const assets = fileURLToPath(new URL("./fixtures/assets", import.meta.url));
const devtoolAssets = fileURLToPath(new URL("./fixtures/devtool-assets", import.meta.url));

const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGTERM");
});

/**
 * Run the start script from the repo root, the way `pnpm --filter … start`
 * does, over a config path or a team profile by name.
 */
function start(config: string | { team: string }, extra: string[] = [], host = "127.0.0.1", env: Record<string, string | undefined> = {}) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "bin/start.mts", ...(typeof config === "string" ? ["--config", config] : ["--team", config.team]), "--port", "0", "--host", host, "--assets", assets, "--devtool-assets", devtoolAssets, ...extra],
    { cwd: pkg, env: { ...process.env, SHIFT_MANAGER_SHIFT: undefined, INIT_CWD: repo, ...env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  running.push(child);
  let output = "";
  child.stdout!.on("data", (d) => (output += String(d)));
  child.stderr!.on("data", (d) => (output += String(d)));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const listening = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no address printed:\n${output}`)), 60_000);
    const check = () => {
      const match = /Shift Manager: (http:\/\/\S+)/.exec(output);
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
  it("serves a Lab's API and Shift Manager's pages from one process, over the Lab's own config", async () => {
    const app = start("goals/multi-seat-collab/lab/fsdev.config.mts");
    const origin = await app.listening;
    const page = await fetch(`${origin}/w/anything/stream`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("shift-manager-test-pages");
    const sessions = await fetch(`${origin}/api/flows/sessions?userId=${encodeURIComponent("u_multi_seat_collab")}`);
    expect(sessions.status).toBe(200);
  }, 90_000);

  it("serves the devtool from the same process by default, over the same Lab, and points the trace link at it (BR-23)", async () => {
    // The trace link only works when the devtool reads the store the run is
    // in. Two processes over an in-memory Lab never do, so the default is a
    // devtool this process serves, over this FlowState, on its own port.
    const config = "labs/shift-manager/teams/devteam/fsdev.config.mts";
    const app = start(config);
    const origin = await app.listening;
    const page = await (await fetch(`${origin}/tasks`)).text();
    const devtool = /<meta name="shift-manager-devtool" content="([^"]+)">/.exec(page)?.[1];
    expect(devtool).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(devtool).not.toBe(`${origin}/`);

    const devtoolPage = await (await fetch(devtool!)).text();
    expect(devtoolPage).toContain("devtool-test-pages");
    // Handed the same connection config `fsdev dev` hands its DevTool page.
    expect(devtoolPage).toContain("__FSD_DEVTOOL_CONFIG__");

    // One store: the session the Lab raised its approval in, read through the
    // Shift Manager origin, is the same session the devtool's origin answers for.
    const config_ = JSON.parse(/__FSD_DEVTOOL_CONFIG__\s*=\s*(\{.*?\});?<\/script>/s.exec(devtoolPage)![1]!) as {
      userId: string;
      bearerToken?: string;
    };
    const headers = config_.bearerToken === undefined ? undefined : { authorization: `Bearer ${config_.bearerToken}` };
    const list = async (base: string) => {
      const res = await fetch(new URL(`api/flows/sessions?userId=${encodeURIComponent(config_.userId)}`, base), { headers });
      expect(res.status).toBe(200);
      // The ids are seeded, so they would match across two stores. When a
      // session was created and its lineage id would not.
      return ((await res.json()) as { sessions: Array<{ id: string; createdAt: number; lineageId?: string }> }).sessions
        .map((x) => `${x.id}@${x.createdAt}/${x.lineageId ?? ""}`)
        .sort();
    };
    const fromApp = await list(`${origin}/`);
    expect(fromApp.length).toBeGreaterThan(0);
    expect(await list(devtool!)).toEqual(fromApp);
  }, 120_000);

  it("writes --devtool into the served pages for the trace link instead, and serves no devtool of its own (BR-23)", async () => {
    const withFlag = start("goals/multi-seat-collab/lab/fsdev.config.mts", ["--devtool", "http://127.0.0.1:4000"]);
    const page = await (await fetch(`${await withFlag.listening}/tasks`)).text();
    expect(page).toContain('<meta name="shift-manager-devtool" content="http://127.0.0.1:4000/">');
    expect(page).toContain("shift-manager-test-pages");
    expect(withFlag.output()).not.toMatch(/Devtool:/);

    const refused = start("goals/multi-seat-collab/lab/fsdev.config.mts", ["--devtool", "javascript:alert(1)"]);
    expect(await refused.exited).not.toBe(0);
    expect(refused.output()).toMatch(/--devtool must be an http\(s\) address/);
  }, 120_000);

  it("removes the --devtool copy of the pages when it stops, and makes none when the Lab doesn't load", async () => {
    // A temp directory of this test's own: the system one is shared with every
    // other process on the machine, any of which may make a copy of its own.
    const tmp = mkdtempSync(join(tmpdir(), "shift-manager-start-test-"));
    const env = { TMPDIR: tmp, TMP: tmp, TEMP: tmp };
    const copies = () => new Set(readdirSync(tmp).filter((d) => d.startsWith("shift-manager-pages-")));
    const before = copies();
    const app = start("goals/multi-seat-collab/lab/fsdev.config.mts", ["--devtool", "http://127.0.0.1:4000"], "127.0.0.1", env);
    await app.listening;
    const made = [...copies()].filter((d) => !before.has(d));
    expect(made).toHaveLength(1);
    app.child.kill("SIGTERM");
    await app.exited;
    expect(existsSync(join(tmp, made[0]!))).toBe(false);

    const unloaded = start("labs/shift-manager/test/fixtures/missing/fsdev.config.mts", ["--devtool", "http://127.0.0.1:4000"], "127.0.0.1", env);
    expect(await unloaded.exited).not.toBe(0);
    expect([...copies()].filter((d) => !before.has(d))).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  }, 120_000);

  it("hands the page the Lab's bearer on a loopback host, and refuses a network host outright", async () => {
    const config = "labs/shift-manager/teams/devteam/fsdev.config.mts";
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
    expect(network.output()).not.toMatch(/Shift Manager: http/);
  }, 120_000);

  it("boots on the shift it is given, by --shift or SHIFT_MANAGER_SHIFT, and on none when given neither", async () => {
    const lab = "goals/multi-seat-collab/lab/fsdev.config.mts";
    const scheme = async (app: ReturnType<typeof start>) =>
      /<meta name="shift-manager-color-scheme" content="([^"]+)">/.exec(await (await fetch(`${await app.listening}/tasks`)).text())?.[1];

    // Unset: no forced scheme, so the page follows the OS setting.
    expect(await scheme(start(lab))).toBeUndefined();
    expect(await scheme(start(lab, ["--shift", "night"]))).toBe("dark");
    expect(await scheme(start(lab, ["--shift", "day"]))).toBe("light");
    expect(await scheme(start(lab, [], "127.0.0.1", { SHIFT_MANAGER_SHIFT: "night" }))).toBe("dark");
    // The flag wins over the environment.
    expect(await scheme(start(lab, ["--shift", "day"], "127.0.0.1", { SHIFT_MANAGER_SHIFT: "night" }))).toBe("light");

    const refused = start(lab, ["--shift", "dusk"]);
    expect(await refused.exited).not.toBe(0);
    expect(refused.output()).toMatch(/No shift "dusk".*day, night/);
  }, 180_000);

  it("opens the DevTeam team profile by name, the same team its config path opens", async () => {
    // The profile is the team's own config: a bearer-authenticated Lab whose
    // EM seat raises one ask at boot.
    const origin = await start({ team: "devteam" }).listening;
    const page = await (await fetch(`${origin}/inbox`)).text();
    const config_ = JSON.parse(/__FSD_DEVTOOL_CONFIG__\s*=\s*(\{.*?\});?<\/script>/s.exec(page)![1]!) as { userId: string; bearerToken?: string };
    expect(config_.bearerToken).toBeTruthy();
    const unauthenticated = await fetch(`${origin}/api/flows/sessions?userId=${encodeURIComponent(config_.userId)}`);
    expect(unauthenticated.status).toBe(401);
    const sessions = await fetch(`${origin}/api/flows/sessions?userId=${encodeURIComponent(config_.userId)}`, {
      headers: { authorization: `Bearer ${config_.bearerToken}` },
    });
    expect(sessions.status).toBe(200);
    expect(((await sessions.json()) as { sessions: unknown[] }).sessions.length).toBeGreaterThan(0);
  }, 120_000);

  it("refuses a team it has no profile for, naming the ones it has, and a second team or config", async () => {
    const unknown = start({ team: "nightwatch" });
    expect(await unknown.exited).not.toBe(0);
    expect(unknown.output()).toMatch(/No team profile "nightwatch". Known teams: devteam\./);

    const both = start({ team: "devteam" }, ["--config", "goals/multi-seat-collab/lab/fsdev.config.mts"]);
    expect(await both.exited).not.toBe(0);
    expect(both.output()).toMatch(/one team per process/);
    expect(both.output()).not.toMatch(/Shift Manager: http/);
  }, 60_000);

  it("refuses a config path with nothing at it, with the loader's message", async () => {
    const app = start("labs/shift-manager/test/fixtures/missing/fsdev.config.mts");
    const code = await app.exited;
    expect(code).not.toBe(0);
    expect(app.output()).toMatch(/fsdev\.config\.mts/);
    expect(app.output()).not.toMatch(/Shift Manager: http/);
  }, 90_000);

  it("refuses a config whose default export is not a FlowState, with the loader's message", async () => {
    const app = start("labs/shift-manager/test/fixtures/not-a-flowstate/fsdev.config.mts");
    const code = await app.exited;
    expect(code).not.toBe(0);
    expect(app.output()).toMatch(/FlowState/);
    expect(app.output()).not.toMatch(/Shift Manager: http/);
  }, 90_000);
});
