#!/usr/bin/env node
/**
 * Bring up every hosted app and the proxy in front of them.
 *
 *     node apps/super-app/run.mjs dev     # root `pnpm dev`: Kitchen Sink on `next dev`, the labs' pages rebuilt first
 *     node apps/super-app/run.mjs serve   # root `pnpm serve`: what `pnpm build` built
 *
 * Settings, from the environment:
 *
 * - `PORT` (default 80 for `serve`, 8080 for `dev`) and `HOST` (default
 *   `0.0.0.0` for `serve`, `127.0.0.1` for `dev`): where the proxy listens.
 * - `SUPER_APP_USERNAME` and `SUPER_APP_PASSWORD`: the one sign-in. With them
 *   set, nothing but `/login` gets through without the session cookie it sets
 *   (`auth.mjs`). `serve` refuses to start without them, and so does `dev` on
 *   any host but loopback: the labs run coding agents on this machine.
 * - `SUPER_APP_SECRET`: signs the session cookie, so sign-ins survive a
 *   restart. Unset, a random one per process.
 * - `SUPER_APP_SECURE_COOKIE=1`: HTTPS is in front of this server. The cookie
 *   is marked `Secure`. Off loopback, this or `SUPER_APP_ALLOW_HTTP=1` must be
 *   set, or the start is refused: the password would cross the network in the clear.
 * - `SUPER_APP_ALLOW_HTTP=1`: serve plain HTTP off loopback anyway, on a
 *   network you trust.
 * - `SUPER_APP_ONLY=kitchen-sink,teammates`: start only these apps.
 *
 * The DevTool page at `/devtool/` is built into `dist/` (`pnpm build:devtool`):
 * `dev` builds it and keeps rebuilding it (and the labs' pages) as the source
 * changes; `serve` serves what `pnpm build` made.
 *
 * The rules are `settings.mjs`. An app that stops leaves the others running; its route answers 502 and the
 * landing page marks it stopped. Ctrl-C stops everything.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { REPO } from "./apps.mjs";
import { createAuth } from "./auth.mjs";
import { createProxy } from "./proxy.mjs";
import { reclaimPort } from "./reclaim.mjs";
import { resolveSettings } from "./settings.mjs";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "serve") {
  process.stderr.write("Usage: run.mjs <dev|serve>\n");
  process.exit(2);
}

const settings = resolveSettings(mode, process.env);
if (settings.error !== undefined) {
  process.stderr.write(`${settings.error}\n`);
  process.exit(settings.exitCode);
}
const { port, host, apps } = settings;
const auth =
  settings.credentials === undefined
    ? undefined
    : createAuth({ ...settings.credentials, ...(settings.secret === undefined ? {} : { secret: settings.secret }) });

/** Every process started, so Ctrl-C reaches each one's whole group. */
const children = new Set();
/** @type {Map<string, "starting"|"running"|"stopped">} */
const state = new Map(apps.map((a) => [a.id, "starting"]));
let stopping = false;

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

/** Run one step to its end (or, for the last, for as long as it lives), with `port` as its `PORT`. Resolves with its exit code. */
function runStep(step, label, port) {
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...step.env, PORT: String(port), FORCE_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group: tsx and next start children of their own.
      detached: true,
    });
    children.add(child);
    prefixLines(child.stdout, label, process.stdout);
    prefixLines(child.stderr, label, process.stderr);
    child.on("error", (error) => {
      process.stderr.write(`${label} could not start ${step.cmd}: ${error.message}\n`);
    });
    child.on("close", (code) => {
      children.delete(child);
      if (stopping && children.size === 0) process.exit(0);
      resolve(code ?? 1);
    });
  });
}

/** Watchers wait for the app to answer: the checkout may still be building the pages they'd rebuild. */
function startWatchers(app, i) {
  const label = `${color(i)}[${app.id}]\x1b[0m`;
  for (const step of app.run[mode].filter((s) => s.background)) {
    void runStep(step, label, app.port).then((code) => {
      if (!stopping) process.stderr.write(`${label} ${step.args.join(" ")} stopped (exit ${code}); changes to its source won't show until a restart.\n`);
    });
  }
}

async function startApp(app, i) {
  const label = `${color(i)}[${app.id}]\x1b[0m`;
  const steps = app.run[mode].filter((s) => !s.background);
  for (const [n, step] of steps.entries()) {
    const code = await runStep(step, label, app.port);
    if (stopping) return;
    const last = n === steps.length - 1;
    if (!last && code === 0) continue;
    state.set(app.id, "stopped");
    process.stderr.write(`${label} ${last ? "stopped" : "failed before starting"} (exit ${code}). The other apps keep running.\n`);
    return;
  }
}

/** Marks an app running once its port answers. */
function watchPort(app, i) {
  const probe = () => {
    if (stopping || state.get(app.id) !== "starting") return;
    const socket = connect(app.port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      if (state.get(app.id) === "starting") {
        state.set(app.id, "running");
        startWatchers(app, i);
      }
    });
    socket.once("error", () => setTimeout(probe, 1000));
  };
  probe();
}

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  setTimeout(() => {
    for (const child of children) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
    process.exit(0);
  }, 5000).unref();
  if (children.size === 0) process.exit(0);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
// A closed terminal: without this the apps are left running with nothing to stop them.
process.on("SIGHUP", stopAll);
process.on("exit", () => {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
});

/**
 * A run that was quit badly (terminal closed, process killed) can leave its
 * proxy or apps listening. Take those ports back when they belong to this
 * checkout; leave a stranger's alone and say so. An app that can't have its
 * port is marked stopped rather than started into a conflict.
 */
const blocked = new Set();
for (const [what, wanted, id] of [["the proxy", port, undefined], ...apps.map((a) => [a.title, a.port, a.id])]) {
  const result = await reclaimPort(wanted, { repo: REPO });
  if (result.status === "reclaimed") {
    process.stdout.write(`[super-app] took :${wanted} back from a stale instance (${result.commands.join("; ")})\n`);
  } else if (result.status === "foreign" || result.status === "stuck") {
    const why = result.status === "foreign" ? `a process from outside this checkout${result.cwd ? ` (${result.cwd})` : ""}, left alone` : "a stale instance that wouldn't stop";
    process.stderr.write(`[super-app] :${wanted} (${what}) is held by ${why}: ${result.command} (pid ${result.pid})\n`);
    if (id === undefined) process.exit(1);
    blocked.add(id);
    state.set(id, "stopped");
  }
}

const devtoolDir = fileURLToPath(new URL("./dist", import.meta.url));
if (mode === "dev") {
  // Builds the page, then rebuilds it as its source changes; a refresh picks the new build up.
  // Until the first build is written, /devtool/ answers that it isn't built.
  void runStep({ cmd: "pnpm", args: ["run", "build:devtool", "--watch"], cwd: fileURLToPath(new URL(".", import.meta.url)) }, "[devtool]", port);
} else if (!existsSync(`${devtoolDir}/index.html`)) {
  process.stderr.write("[super-app] the DevTool page isn't built (run `pnpm build`); /devtool/ won't load.\n");
}

const proxy = createProxy({ apps, auth, status: (id) => state.get(id) ?? "stopped", devtoolDir });
proxy.on("error", (error) => {
  const hint = error.code === "EACCES" ? ` Port ${port} needs root here; run with PORT=8080, or grant node the bind capability.` : "";
  process.stderr.write(`[super-app] can't listen on ${host}:${port}: ${error.message}.${hint}\n`);
  stopAll();
  process.exitCode = 1;
});
proxy.listen(port, host, () => {
  const origin = `http://${host === "0.0.0.0" ? "localhost" : host}${port === 80 ? "" : `:${port}`}`;
  process.stdout.write(`[super-app] ${mode} on ${origin}${auth ? " (sign-in required)" : " (no sign-in: loopback dev)"}\n`);
  for (const app of apps) process.stdout.write(`[super-app]   ${origin}${app.prefix}/  ->  127.0.0.1:${app.port}\n`);
});

apps.forEach((app, i) => {
  if (blocked.has(app.id)) return;
  watchPort(app, i);
  void startApp(app, i);
});
