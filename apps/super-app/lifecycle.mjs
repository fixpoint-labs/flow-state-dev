/**
 * Each hosted app's processes: starting its steps, knowing when it answers,
 * and restarting its server alone.
 *
 * `run.mjs` starts every app through one of these. Each app keeps its own
 * handle on its server process, so one app can be restarted while the others
 * keep running and keep their state. A restart stops that server's process
 * group, takes its port back (`reclaimPort`), and runs only the server step
 * (the last of `app.run[mode]`) again: the page build before it and the
 * rebuild watchers beside it are left as they are, and the watchers are never
 * started twice.
 *
 * A server step that records what it loaded (`serverInputs`, see
 * `record-server-inputs.mjs`) can be asked whether that code changed since it
 * started (`changed`). Only those apps can be restarted: an app without the
 * record has nothing to tell you it needs one, and Kitchen Sink's `next dev`
 * reloads itself.
 *
 * Processes are started through the injected `spawn`, so the sequence can be
 * tested without starting any.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BUILD_INPUTS_FILE, staleBuildInputs } from "../../scripts/build-inputs.mjs";

/** @typedef {"starting"|"running"|"stopped"} AppState */

/**
 * The outcome of a restart request: started, or why not, as an HTTP status.
 *
 * @typedef {{ ok: true } | { ok: false, status: 404 | 409, message: string }} RestartResult
 */

const color = (i) => `\x1b[3${(i % 6) + 1}m`;

function prefixLines(stream, label, out) {
  let buffered = "";
  stream.on("data", (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) out.write(`${label} ${line}\n`);
  });
  stream.on("end", () => buffered && out.write(`${label} ${buffered}\n`));
}

/**
 * @param {object} options
 * @param {import("./apps.mjs").HostedApp[]} options.apps
 * @param {"dev"|"serve"} options.mode
 * @param {string} options.repoRoot
 * @param {typeof import("node:child_process").spawn} options.spawn
 * @param {(port: number) => Promise<boolean>} options.answers  Whether something accepts connections on the loopback port.
 * @param {(port: number) => Promise<{ status: string, command?: string, pid?: number }>} options.reclaimPort  Frees a port this checkout holds (`reclaim.mjs`).
 * @param {(options: { outDir: string, repoRoot: string, build: () => Promise<unknown> }) => unknown} options.rebuildOnChange
 * @param {(pid: number, signal: NodeJS.Signals) => void} [options.kill]  Signals a process group (a negative pid).
 * @param {{ write(s: string): unknown }} [options.stdout]
 * @param {{ write(s: string): unknown }} [options.stderr]
 * @param {number} [options.probeMs]   How often a starting app's port is tried.
 * @param {number} [options.graceMs]   How long a stopped server has to exit before SIGKILL.
 * @param {number} [options.changedTtlMs]  How long one answer to `changed` is reused (it re-hashes every recorded file). Longer than the pages' poll (`button.mjs`), so polls from open tabs share one answer.
 */
export function createLifecycle({
  apps,
  mode,
  repoRoot,
  spawn,
  answers,
  reclaimPort,
  rebuildOnChange,
  kill = (pid, signal) => process.kill(pid, signal),
  stdout = process.stdout,
  stderr = process.stderr,
  probeMs = 1000,
  graceMs = 5000,
  changedTtlMs = 5000,
}) {
  /** Every process running, so a shutdown reaches each one's whole group. */
  const children = new Set();
  /** @type {Map<string, AppState>} */
  const state = new Map(apps.map((a) => [a.id, "starting"]));
  /** Each app's server process while it runs. */
  const servers = new Map();
  /** Bumped by a restart, so the server it stopped doesn't report its exit as the app stopping. */
  const generation = new Map(apps.map((a) => [a.id, 0]));
  const watchersStarted = new Set();
  const restarting = new Set();
  /** Apps whose `start` has run. Before it, `dev` may still be installing what a server would load. */
  const begun = new Set();
  /** @type {Map<string, { at: number, changed: boolean }>} */
  const changedMemo = new Map();
  let stopping = false;
  /** Called once the last process exits after `stop()`. */
  let onDrained = () => {};

  const byId = new Map(apps.map((a, i) => [a.id, { app: a, i }]));
  const labelOf = (i, app) => `${color(i)}[${app.id}]\x1b[0m`;
  const serverStep = (app) => app.run[mode].filter((s) => !s.background).at(-1);

  /** Starts one step with `port` as its `PORT`. `done` resolves with its exit code. */
  function spawnStep(step, label, port) {
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...step.env, PORT: String(port), FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group: tsx and next start children of their own.
      detached: true,
    });
    children.add(child);
    prefixLines(child.stdout, label, stdout);
    prefixLines(child.stderr, label, stderr);
    const done = new Promise((resolve) => {
      child.on("error", (error) => stderr.write(`${label} could not start ${step.cmd}: ${error.message}\n`));
      child.on("close", (code) => {
        children.delete(child);
        if (stopping && children.size === 0) onDrained();
        resolve(code ?? 1);
      });
    });
    return { child, done };
  }

  /** Runs one step to its end (or, for a server, for as long as it lives). Resolves with its exit code. */
  const runStep = (step, label, port) => spawnStep(step, label, port).done;

  /** Watchers wait for the app to answer: the checkout may still be building the pages they'd rebuild. Once per app. */
  function startWatchers(app, i) {
    if (watchersStarted.has(app.id)) return;
    watchersStarted.add(app.id);
    const label = labelOf(i, app);
    for (const step of app.run[mode].filter((s) => s.background)) {
      if (step.rebuildOnChange !== undefined) {
        rebuildOnChange({ outDir: step.rebuildOnChange, repoRoot, build: () => (stopping ? Promise.resolve() : runStep(step, label, app.port)) });
        continue;
      }
      void runStep(step, label, app.port).then((code) => {
        if (!stopping) stderr.write(`${label} ${step.args.join(" ")} stopped (exit ${code}); changes to its source won't show until a restart.\n`);
      });
    }
  }

  /** Marks an app running once its port answers, and starts its watchers then. */
  function watchPort(app, i) {
    const gen = generation.get(app.id);
    const probe = async () => {
      if (stopping || state.get(app.id) !== "starting" || generation.get(app.id) !== gen) return;
      if (!(await answers(app.port))) return void setTimeout(probe, probeMs);
      if (state.get(app.id) === "starting" && generation.get(app.id) === gen) {
        state.set(app.id, "running");
        startWatchers(app, i);
      }
    };
    void probe();
  }

  /** Runs the server step until it exits. Its exit stops the app unless a restart replaced it. */
  async function runServer(app, i, step) {
    const gen = generation.get(app.id);
    const label = labelOf(i, app);
    const { child, done } = spawnStep(step, label, app.port);
    servers.set(app.id, child);
    const code = await done;
    if (servers.get(app.id) === child) servers.delete(app.id);
    if (stopping || generation.get(app.id) !== gen) return;
    state.set(app.id, "stopped");
    stderr.write(`${label} stopped (exit ${code}). The other apps keep running.\n`);
  }

  /** Runs an app's steps in order; the last is its server. */
  async function start(id) {
    const { app, i } = byId.get(id);
    begun.add(id);
    const gen = generation.get(id);
    watchPort(app, i);
    const label = labelOf(i, app);
    const steps = app.run[mode].filter((s) => !s.background);
    for (const step of steps.slice(0, -1)) {
      const code = await runStep(step, label, app.port);
      // A restart while these ran has started the server already.
      if (stopping || generation.get(id) !== gen) return;
      if (code === 0) continue;
      state.set(app.id, "stopped");
      stderr.write(`${label} failed before starting (exit ${code}). The other apps keep running.\n`);
      return;
    }
    await runServer(app, i, steps.at(-1));
  }

  /** Whether `id` names an app whose server records what it loaded, and so can say it changed and be restarted. */
  const restartable = (id) => {
    const found = byId.get(id);
    return found !== undefined && serverStep(found.app)?.serverInputs !== undefined;
  };

  /**
   * Whether a file the app's server loaded has different content now than when it loaded.
   * A save that leaves a file as it was is not a change. `false` with no record yet.
   */
  function changed(id) {
    if (!restartable(id)) return false;
    const memo = changedMemo.get(id);
    if (memo !== undefined && Date.now() - memo.at < changedTtlMs) return memo.changed;
    const dir = serverStep(byId.get(id).app).serverInputs;
    let result = false;
    // No record yet (a server still loading, or one that never started): nothing to compare.
    if (existsSync(join(dir, BUILD_INPUTS_FILE))) {
      try {
        result = staleBuildInputs(dir, repoRoot) !== undefined;
      } catch {
        // A record that can't be read says nothing either way.
      }
    }
    changedMemo.set(id, { at: Date.now(), changed: result });
    return result;
  }

  /** Waits for `child` to exit, SIGTERM to its group first, then SIGKILL after `graceMs`. */
  function stopServer(child) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          kill(-child.pid, "SIGKILL");
        } catch {}
      }, graceMs);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        kill(-child.pid, "SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /**
   * Restarts one app's server: stops its process group, frees its port, and
   * starts the server step again. Resolves once the new server is started, not once it answers.
   *
   * @param {string} id
   * @returns {Promise<RestartResult>}
   */
  async function restart(id) {
    const found = byId.get(id);
    if (found === undefined) return { ok: false, status: 404, message: `No app is called ${id}.` };
    if (!restartable(id)) return { ok: false, status: 409, message: `${found.app.title} can't be restarted from here.` };
    if (stopping) return { ok: false, status: 409, message: "The super app is shutting down." };
    if (!begun.has(id)) return { ok: false, status: 409, message: `${found.app.title} hasn't started yet; restart it once it has.` };
    if (restarting.has(id)) return { ok: false, status: 409, message: `${found.app.title} is already restarting.` };
    const { app, i } = found;
    const label = labelOf(i, app);
    restarting.add(id);
    try {
      generation.set(id, generation.get(id) + 1);
      state.set(id, "starting");
      stdout.write(`${label} restarting its server; work in progress there stops.\n`);
      const old = servers.get(id);
      servers.delete(id);
      if (old !== undefined) await stopServer(old);
      const freed = await reclaimPort(app.port);
      if (freed.status === "foreign" || freed.status === "stuck") {
        state.set(id, "stopped");
        const message = `${app.title}'s port ${app.port} is still held by ${freed.command ?? "another process"}${freed.pid === undefined ? "" : ` (pid ${freed.pid})`}.`;
        stderr.write(`${label} ${message}\n`);
        return { ok: false, status: 409, message };
      }
      const step = serverStep(app);
      // The record describes the server that just stopped: the new one writes its own.
      rmSync(step.serverInputs, { recursive: true, force: true });
      changedMemo.delete(id);
      watchPort(app, i);
      void runServer(app, i, step);
      return { ok: true };
    } finally {
      restarting.delete(id);
    }
  }

  /** Marks the run as shutting down; `drained` is called once its last process exits. */
  function stop(drained) {
    stopping = true;
    onDrained = drained;
  }

  return {
    children,
    state,
    start,
    restart,
    restartable,
    changed,
    runStep,
    stop,
    get stopping() {
      return stopping;
    },
  };
}
