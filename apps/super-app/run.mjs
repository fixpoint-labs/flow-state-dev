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
 * `dev` builds it and rebuilds it (and the labs' pages) as the source changes,
 * one ordinary build per change (`rebuild.mjs`); `serve` serves what
 * `pnpm build` made.
 *
 * `dev` also installs what the lockfile names before any app starts
 * (`workspace.mjs`). Packages need no build: they run from `src/`.
 *
 * The rules are `settings.mjs`. An app that stops leaves the others running; its route answers 502 and the
 * landing page marks it stopped. In `dev`, a lab whose server code changed since it started is marked changed,
 * and can be restarted on its own (`lifecycle.mjs`). Ctrl-C stops everything.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { REPO } from "./apps.mjs";
import { createAuth } from "./auth.mjs";
import { createLifecycle } from "./lifecycle.mjs";
import { createProxy } from "./proxy.mjs";
import { rebuildOnChange } from "./rebuild.mjs";
import { reclaimPort } from "./reclaim.mjs";
import { resolveSettings } from "./settings.mjs";
import { installWorkspace } from "./workspace.mjs";

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

const lifecycle = createLifecycle({
  apps,
  mode,
  repoRoot: REPO,
  spawn,
  answers: (port) =>
    new Promise((resolve) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    }),
  reclaimPort: (port) => reclaimPort(port, { repo: REPO }),
  rebuildOnChange,
});
const { children, state, runStep } = lifecycle;

function stopAll() {
  if (lifecycle.stopping) return;
  lifecycle.stop(() => process.exit(0));
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
/** Settled once `dev` has what the apps need; `serve` needs nothing. The proxy listens meanwhile, so a slow install leaves the landing page up. */
let ready = Promise.resolve();
if (mode === "dev") {
  ready = (async () => {
    // Before any app starts, so each comes up on the dependencies the lockfile names. Only ever here: replacing
    // `node_modules` under a running server would break it.
    await installWorkspace({
      run: (step) => runStep({ cmd: step.cmd, args: step.args, cwd: REPO }, step.label, 0),
      warn: (line) => process.stderr.write(`[super-app] ${line}\n`),
    });
    // Builds the page when it is missing or stale, then rebuilds it as its source changes; a refresh picks the new build up.
    // Until the first build is written, /devtool/ answers that it isn't built.
    const step = { cmd: "pnpm", args: ["run", "build:devtool"], cwd: fileURLToPath(new URL(".", import.meta.url)) };
    rebuildOnChange({ outDir: devtoolDir, repoRoot: REPO, build: () => (lifecycle.stopping ? Promise.resolve() : runStep(step, "[devtool]", port)) });
  })();
} else if (!existsSync(`${devtoolDir}/index.html`)) {
  process.stderr.write("[super-app] the DevTool page isn't built (run `pnpm build`); /devtool/ won't load.\n");
}

const proxy = createProxy({
  apps,
  auth,
  status: (id) => state.get(id) ?? "stopped",
  devtoolDir,
  ...(mode === "dev" ? { changed: lifecycle.changed, restartable: lifecycle.restartable, restart: lifecycle.restart } : {}),
});
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

await ready;
for (const app of apps) {
  if (lifecycle.stopping || blocked.has(app.id)) continue;
  void lifecycle.start(app.id);
}
