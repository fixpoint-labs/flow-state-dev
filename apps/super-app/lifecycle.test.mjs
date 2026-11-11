/**
 * `createLifecycle` restarts one app's server and leaves everything else as it
 * was: the other apps' processes, this app's page build and its rebuild
 * watchers. And it only marks an app changed when a file its server loaded now
 * holds different content.
 */
import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { REPO } from "./apps.mjs";
import { createLifecycle } from "./lifecycle.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (text) => createHash("sha256").update(text).digest("hex");
const quiet = { write() {} };

/** Waits until `check()` is true, or fails after `ms`. */
async function until(check, ms = 2000, what = "condition") {
  for (let waited = 0; !check(); waited += 10) {
    if (waited >= ms) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** A `spawn` whose processes are fakes: each records its command, and exits when its group is signalled. */
function fakeProcesses() {
  const started = [];
  let nextPid = 100;
  const spawn = (cmd, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { cmd, args, options, pid: nextPid++, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
    child.exit = (code) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.exitCode = code;
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit("close", code));
    };
    started.push(child);
    // A page build ends on its own; a server runs until it is stopped.
    if (args.includes("build")) setImmediate(() => child.exit(0));
    return child;
  };
  const signals = [];
  const kill = (pid, signal) => {
    signals.push([pid, signal]);
    started.find((c) => c.pid === -pid)?.exit(1);
  };
  return { spawn, kill, started, signals };
}

let dir;
/** Every lifecycle a test made, stopped after it so no probe outlives it. */
const made = [];
beforeEach(() => {
  dir = mkdtempSync(join(REPO, "apps/super-app/.lifecycle-test-"));
});
afterEach(() => {
  for (const lifecycle of made.splice(0)) lifecycle.stop(() => {});
  rmSync(dir, { recursive: true, force: true });
});

/** Two labs, each a page build, a rebuild watcher and a recording server, as `apps.mjs` declares them. */
function labs() {
  const lab = (id, port) => ({
    id,
    title: id,
    blurb: "",
    prefix: `/${id}`,
    kind: "spa",
    port,
    run: {
      dev: [
        { cmd: "vite", args: ["build"], cwd: dir },
        { cmd: "vite", args: ["build"], cwd: dir, background: true, rebuildOnChange: join(dir, id, "dist-client") },
        { cmd: "tsx", args: ["server.mts"], cwd: dir, serverInputs: join(dir, id, "server-inputs") },
      ],
      serve: [],
    },
  });
  return [lab("one", 4001), lab("two", 4002), { id: "next", title: "Next", blurb: "", prefix: "/next", kind: "next", port: 4003, run: { dev: [{ cmd: "next", args: ["dev"], cwd: dir }], serve: [] } }];
}

function lifecycleOver(apps, procs, overrides = {}) {
  const watchers = [];
  const reclaimed = [];
  const lifecycle = createLifecycle({
    apps,
    mode: "dev",
    repoRoot: REPO,
    spawn: procs.spawn,
    kill: procs.kill,
    answers: async (port) => procs.started.some((c) => c.args.includes("server.mts") && c.exitCode === null && c.options.env.PORT === String(port)),
    reclaimPort: async (port) => (reclaimed.push(port), { status: "free" }),
    rebuildOnChange: (options) => watchers.push(options),
    stdout: quiet,
    stderr: quiet,
    probeMs: 5,
    ...overrides,
  });
  made.push(lifecycle);
  return { lifecycle, watchers, reclaimed };
}

const servers = (procs, port) => procs.started.filter((c) => c.args.includes("server.mts") && c.options.env.PORT === String(port));

describe("restarting one app", () => {
  it("stops that app's server group, frees its port, and starts only the server step again", async () => {
    const procs = fakeProcesses();
    const apps = labs();
    const { lifecycle, watchers, reclaimed } = lifecycleOver(apps, procs);
    for (const app of apps) void lifecycle.start(app.id);
    await until(() => lifecycle.state.get("one") === "running" && lifecycle.state.get("two") === "running", 2000, "both labs running");
    const [oldOne] = servers(procs, 4001);
    const [two] = servers(procs, 4002);
    const builds = procs.started.filter((c) => c.args.includes("build")).length;
    assert.equal(watchers.length, 2, "one rebuild watcher per lab");
    mkdirSync(join(dir, "one", "server-inputs"), { recursive: true });
    writeFileSync(join(dir, "one", "server-inputs", "build-inputs.json"), "{}");

    assert.deepEqual(await lifecycle.restart("one"), { ok: true });

    assert.deepEqual(procs.signals[0], [-oldOne.pid, "SIGTERM"], "the whole process group of that server is stopped");
    assert.equal(procs.signals.length, 1, "nothing else is signalled");
    assert.deepEqual(reclaimed, [4001], "its port is freed before the new server starts");
    assert.equal(existsSync(join(dir, "one", "server-inputs")), false, "the old server's record goes with it");
    await until(() => lifecycle.state.get("one") === "running", 2000, "the lab running again");
    assert.equal(servers(procs, 4001).length, 2, "a second server on the same port");
    assert.equal(procs.started.filter((c) => c.args.includes("build")).length, builds, "the page build doesn't run again");
    assert.equal(watchers.length, 2, "the rebuild watchers aren't started twice");
    assert.equal(two.exitCode, null, "the other lab's server keeps running");
    assert.equal(lifecycle.state.get("two"), "running");
  });

  it("doesn't count the server it stopped as the app stopping", async () => {
    const procs = fakeProcesses();
    const apps = labs();
    const { lifecycle } = lifecycleOver(apps, procs);
    void lifecycle.start("one");
    await until(() => lifecycle.state.get("one") === "running");
    await lifecycle.restart("one");
    await sleep(30);
    assert.notEqual(lifecycle.state.get("one"), "stopped");
    // But the new server exiting on its own does stop it.
    servers(procs, 4001).at(-1).exit(1);
    await until(() => lifecycle.state.get("one") === "stopped", 2000, "the app marked stopped");
  });

  it("restarts an app whose server already stopped (a bad edit, say)", async () => {
    const procs = fakeProcesses();
    const { lifecycle } = lifecycleOver(labs(), procs);
    void lifecycle.start("one");
    await until(() => lifecycle.state.get("one") === "running");
    servers(procs, 4001)[0].exit(1);
    await until(() => lifecycle.state.get("one") === "stopped");
    assert.deepEqual(await lifecycle.restart("one"), { ok: true });
    await until(() => lifecycle.state.get("one") === "running");
    assert.equal(procs.signals.length, 0, "nothing left to stop");
  });

  it("refuses an unknown app, one with no server record, and a second restart while one runs", async () => {
    const procs = fakeProcesses();
    // A server that takes its time to stop, so the first restart is still running when the second arrives.
    const { lifecycle } = lifecycleOver(labs(), procs, { kill: (pid, signal) => setTimeout(() => procs.kill(pid, signal), 50) });
    void lifecycle.start("one");
    await until(() => lifecycle.state.get("one") === "running");
    assert.equal((await lifecycle.restart("nope")).status, 404);
    assert.equal((await lifecycle.restart("next")).status, 409, "Kitchen Sink-like apps reload themselves");
    const first = lifecycle.restart("one");
    assert.equal((await lifecycle.restart("one")).status, 409);
    assert.deepEqual(await first, { ok: true });
  });

  it("refuses before the app has started, while dev may still be installing what its server loads", async () => {
    const procs = fakeProcesses();
    const { lifecycle } = lifecycleOver(labs(), procs);
    const result = await lifecycle.restart("one");
    assert.equal(result.status, 409);
    assert.equal(procs.started.length, 0, "no server started ahead of the run's own start");
  });

  it("stops at a port something else still holds, and marks the app stopped", async () => {
    const procs = fakeProcesses();
    const { lifecycle } = lifecycleOver(labs(), procs, { reclaimPort: async () => ({ status: "foreign", pid: 9, command: "nc -l" }) });
    void lifecycle.start("one");
    await until(() => lifecycle.state.get("one") === "running");
    const result = await lifecycle.restart("one");
    assert.equal(result.status, 409);
    assert.match(result.message, /nc -l/);
    assert.equal(lifecycle.state.get("one"), "stopped");
    assert.equal(servers(procs, 4001).length, 1, "no server is started into a port it can't have");
  });
});

describe("whether an app's server code changed", () => {
  const record = (inputs) => {
    mkdirSync(join(dir, "one", "server-inputs"), { recursive: true });
    writeFileSync(join(dir, "one", "server-inputs", "build-inputs.json"), JSON.stringify({ inputs }));
  };
  const rel = (name) => join(dir, name).slice(REPO.length).replace(/^\//, "");

  it("is true only when a recorded file's content differs, not when it is rewritten as it was", () => {
    writeFileSync(join(dir, "flow.mts"), "export const v = 1;");
    writeFileSync(join(dir, "page.tsx"), "<div/>");
    record({ [rel("flow.mts")]: hash("export const v = 1;") });
    const { lifecycle } = lifecycleOver(labs(), fakeProcesses(), { changedTtlMs: 0 });

    assert.equal(lifecycle.changed("one"), false);
    writeFileSync(join(dir, "flow.mts"), "export const v = 1;");
    assert.equal(lifecycle.changed("one"), false, "a save that leaves the content as it was");
    writeFileSync(join(dir, "page.tsx"), "<main/>");
    assert.equal(lifecycle.changed("one"), false, "a file the server never loaded");
    writeFileSync(join(dir, "flow.mts"), "export const v = 2;");
    assert.equal(lifecycle.changed("one"), true);
    assert.equal(lifecycle.changed("two"), false, "another lab's record is its own");
  });

  it("is false with no record yet, and for an app that keeps none", () => {
    const { lifecycle } = lifecycleOver(labs(), fakeProcesses(), { changedTtlMs: 0 });
    assert.equal(lifecycle.changed("one"), false);
    assert.equal(lifecycle.changed("next"), false);
    assert.equal(lifecycle.restartable("next"), false);
    assert.equal(lifecycle.restartable("one"), true);
  });
});

describe("a real server, recorded and restarted", () => {
  it("is marked changed by an edit to a module it loaded, and runs the edited code after a restart", async () => {
    // The whole path on real processes: tsx with the recording preload, the record, the check, the restart.
    const port = await new Promise((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });
    writeFileSync(join(dir, "answer.mts"), 'export const answer = "before";');
    writeFileSync(join(dir, "page.tsx"), "export const Page = () => null;");
    writeFileSync(
      join(dir, "server.mts"),
      'import { createServer } from "node:http";\nconst { answer } = await import("./answer.mts");\ncreateServer((_q, r) => r.end(answer)).listen(Number(process.env.PORT), "127.0.0.1");\n',
    );
    const inputs = join(dir, "server-inputs");
    const app = {
      id: "real",
      title: "Real",
      blurb: "",
      prefix: "/real",
      kind: "spa",
      port,
      run: {
        dev: [
          {
            cmd: join(REPO, "node_modules/.bin/tsx"),
            args: ["--import", join(REPO, "apps/super-app/record-server-inputs.mjs"), "server.mts"],
            cwd: dir,
            env: { SUPER_APP_SERVER_INPUTS: inputs },
            serverInputs: inputs,
          },
        ],
        serve: [],
      },
    };
    const started = [];
    const lifecycle = createLifecycle({
      apps: [app],
      mode: "dev",
      repoRoot: REPO,
      spawn: (...args) => {
        const child = realSpawn(...args);
        started.push(child);
        return child;
      },
      answers: (p) => fetch(`http://127.0.0.1:${p}/`).then(() => true, () => false),
      reclaimPort: async () => ({ status: "free" }),
      rebuildOnChange: () => {},
      stdout: quiet,
      stderr: quiet,
      probeMs: 50,
      changedTtlMs: 0,
    });
    const answer = () => fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    try {
      void lifecycle.start("real");
      await until(() => lifecycle.state.get("real") === "running", 20000, "the server answering");
      assert.equal(await answer(), "before");
      await until(() => existsSync(join(inputs, "build-inputs.json")), 20000, "the record");
      assert.equal(lifecycle.changed("real"), false);

      writeFileSync(join(dir, "page.tsx"), "export const Page = () => 1;");
      assert.equal(lifecycle.changed("real"), false, "the server never loaded the page");
      writeFileSync(join(dir, "answer.mts"), 'export const answer = "after";');
      assert.equal(lifecycle.changed("real"), true);
      assert.equal(await answer(), "before", "the running server still has the old code");

      assert.deepEqual(await lifecycle.restart("real"), { ok: true });
      await until(() => lifecycle.state.get("real") === "running", 20000, "the restarted server answering");
      assert.equal(await answer(), "after");
      await until(() => existsSync(join(inputs, "build-inputs.json")), 20000, "the new record");
      assert.equal(lifecycle.changed("real"), false, "the mark clears with the restart");
    } finally {
      lifecycle.stop(() => {});
      for (const child of started) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
    }
  });
});
