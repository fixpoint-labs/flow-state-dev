/**
 * Takes back a port that a stale instance of this checkout still holds.
 *
 * Quitting the super app can leave its apps behind: a closed terminal or a
 * killed `run.mjs` never reaches its shutdown, and a Next dev server keeps
 * running with nothing to stop it. The next start then finds its ports taken.
 * `reclaimPort` finds what listens on a port and, when that process is running
 * from inside this repository (its working directory is under `repo`), stops it
 * and whatever it started, so the port is free for the new run. A process
 * running from anywhere else is somebody else's: nothing is stopped, and the
 * caller says so.
 *
 * Needs `lsof` to find the listener. Without it the answer is `unknown` and
 * nothing is touched, so the start behaves as it did before.
 */
import { execFileSync } from "node:child_process";
import { readlinkSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * @typedef {{ status: "free" }
 *   | { status: "unknown" }
 *   | { status: "reclaimed", pids: number[], commands: string[] }
 *   | { status: "foreign", pid: number, command: string, cwd: string | undefined }
 *   | { status: "stuck", pid: number, command: string }} Reclaimed
 *   What became of the port: nothing held it, we can't tell, we stopped the stale
 *   holder, a process from outside the repository holds it, or the holder wouldn't stop.
 */

/** Runs a command and returns its stdout; `undefined` when it can't run, `""` when it exits non-zero with nothing to say. */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    return error.code === "ENOENT" ? undefined : String(error.stdout ?? "");
  }
}

/** Pids listening on `port`, or `undefined` when `lsof` isn't there to ask. */
function listeners(port) {
  const out = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (out === undefined) return undefined;
  return [...new Set(out.split("\n").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/** A process's working directory, or `undefined` when it can't be read (gone, or not ours to read). */
function cwdOf(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {}
  const out = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]) ?? "";
  const line = out.split("\n").find((l) => l.startsWith("n"));
  return line === undefined ? undefined : line.slice(1);
}

/** A process's command line, for the message that says what was stopped. */
function commandOf(pid) {
  return (run("ps", ["-o", "command=", "-p", String(pid)]) ?? "").trim().slice(0, 120) || `pid ${pid}`;
}

/** `pid` and every process still descended from it. A child orphaned to init is no longer found. */
function withDescendants(pid) {
  const children = new Map();
  for (const line of (run("ps", ["-axo", "pid=,ppid="]) ?? "").split("\n")) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(p) && Number.isInteger(pp)) children.set(pp, [...(children.get(pp) ?? []), p]);
  }
  const found = [];
  const queue = [pid];
  while (queue.length > 0) {
    const next = queue.shift();
    if (found.includes(next)) continue;
    found.push(next);
    queue.push(...(children.get(next) ?? []));
  }
  return found;
}

function signal(pids, sig) {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {}
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Waits for `port` to have no listener, up to `ms`. */
async function freed(port, ms) {
  for (let waited = 0; ; waited += 100) {
    if ((listeners(port) ?? []).length === 0) return true;
    if (waited >= ms) return false;
    await sleep(100);
  }
}

/**
 * Frees `port` when a stale instance from `repo` holds it.
 *
 * Stops the holder and its descendants with SIGTERM, so a stale `run.mjs`
 * shuts its own apps down, then SIGKILL for whatever is still listening after
 * `graceMs`.
 *
 * @param {number} port
 * @param {{ repo: string, graceMs?: number }} options  `repo`: the checkout's root.
 * @returns {Promise<Reclaimed>}
 */
export async function reclaimPort(port, { repo, graceMs = 8000 }) {
  const holders = listeners(port);
  if (holders === undefined) return { status: "unknown" };
  const holder = holders.find((pid) => pid !== process.pid);
  if (holder === undefined) return { status: "free" };

  const root = realpathSync(resolve(repo));
  for (const pid of holders) {
    const cwd = cwdOf(pid);
    const real = cwd === undefined ? undefined : safeRealpath(cwd);
    if (real === undefined || (real !== root && !real.startsWith(root + sep))) {
      return { status: "foreign", pid, command: commandOf(pid), cwd };
    }
  }

  const commands = holders.map(commandOf);
  const victims = [...new Set(holders.flatMap(withDescendants))].filter((pid) => pid !== process.pid);
  signal(victims, "SIGTERM");
  if (await freed(port, graceMs)) return { status: "reclaimed", pids: victims, commands };
  signal(victims, "SIGKILL");
  if (await freed(port, 2000)) return { status: "reclaimed", pids: victims, commands };
  return { status: "stuck", pid: holder, command: commandOf(holder) };
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}
