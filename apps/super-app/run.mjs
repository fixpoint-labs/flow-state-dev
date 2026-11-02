#!/usr/bin/env node
/**
 * Bring up every hosted app and the proxy in front of them.
 *
 *     node apps/super-app/run.mjs dev     # root `pnpm dev`: Kitchen Sink on `next dev`, the labs' pages rebuilt first
 *     node apps/super-app/run.mjs serve   # root `pnpm serve`: what `pnpm build` built
 *
 * Settings, from the environment:
 *
 * - `PORT` (default 80) and `HOST` (default `0.0.0.0` for `serve`, `127.0.0.1`
 *   for `dev`): where the proxy listens.
 * - `SUPER_APP_USERNAME` and `SUPER_APP_PASSWORD`: the one sign-in. With them
 *   set, nothing but `/login` gets through without the session cookie it sets
 *   (`auth.mjs`). `serve` refuses to start without them, and so does `dev` on
 *   any host but loopback: the labs run coding agents on this machine.
 * - `SUPER_APP_SECRET`: signs the session cookie, so sign-ins survive a
 *   restart. Unset, a random one per process.
 * - `SUPER_APP_SECURE_COOKIE=1`: mark the cookie `Secure` even when no proxy in
 *   front says the request came over HTTPS.
 * - `SUPER_APP_ONLY=kitchen-sink,teammates`: start only these apps.
 *
 * An app that stops leaves the others running; its route answers 502 and the
 * landing page marks it stopped. Ctrl-C stops everything.
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { APPS } from "./apps.mjs";
import { createAuth } from "./auth.mjs";
import { createProxy } from "./proxy.mjs";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "serve") {
  process.stderr.write("Usage: run.mjs <dev|serve>\n");
  process.exit(2);
}

const only = process.env.SUPER_APP_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const apps = only === undefined ? APPS : APPS.filter((a) => only.includes(a.id));
if (only !== undefined && apps.length !== only.length) {
  process.stderr.write(`SUPER_APP_ONLY names an app that isn't hosted. Hosted: ${APPS.map((a) => a.id).join(", ")}\n`);
  process.exit(2);
}

const port = Number(process.env.PORT ?? 80);
const host = process.env.HOST ?? (mode === "serve" ? "0.0.0.0" : "127.0.0.1");
const username = process.env.SUPER_APP_USERNAME || undefined;
const password = process.env.SUPER_APP_PASSWORD || undefined;
if ((username === undefined) !== (password === undefined)) {
  process.stderr.write("Set both SUPER_APP_USERNAME and SUPER_APP_PASSWORD, or neither.\n");
  process.exit(3);
}
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (username === undefined && (mode === "serve" || !loopback)) {
  process.stderr.write(
    `Refusing to ${mode === "serve" ? "serve" : `serve on ${host}`} with no sign-in: these apps run coding agents on this machine.\n` +
      "Set SUPER_APP_USERNAME and SUPER_APP_PASSWORD.\n",
  );
  process.exit(3);
}
const auth =
  username === undefined
    ? undefined
    : createAuth({ username, password, ...(process.env.SUPER_APP_SECRET ? { secret: process.env.SUPER_APP_SECRET } : {}) });

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

/** Run one step to its end (or, for the last, for as long as it lives). Resolves with its exit code. */
function runStep(app, step, label) {
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...step.env, PORT: String(app.port), FORCE_COLOR: "1" },
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

async function startApp(app, i) {
  const label = `${color(i)}[${app.id}]\x1b[0m`;
  const steps = app.run[mode];
  for (const [n, step] of steps.entries()) {
    const code = await runStep(app, step, label);
    if (stopping) return;
    const last = n === steps.length - 1;
    if (!last && code === 0) continue;
    state.set(app.id, "stopped");
    process.stderr.write(`${label} ${last ? "stopped" : "failed before starting"} (exit ${code}). The other apps keep running.\n`);
    return;
  }
}

/** Marks an app running once its port answers. */
function watchPort(app) {
  const probe = () => {
    if (stopping || state.get(app.id) !== "starting") return;
    const socket = connect(app.port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      if (state.get(app.id) === "starting") state.set(app.id, "running");
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
process.on("exit", () => {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
});

const proxy = createProxy({ apps, auth, status: (id) => state.get(id) ?? "stopped" });
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
  watchPort(app);
  void startApp(app, i);
});
