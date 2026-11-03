/**
 * `reclaimPort` against real processes: a stale holder from the checkout is
 * stopped (with what it started), one from anywhere else is left alone, and
 * a holder that ignores SIGTERM still loses the port.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { reclaimPort } from "./reclaim.mjs";

const scratch = (name) => mkdtempSync(join(realpathSync(tmpdir()), `${name}-`));
const repo = scratch("repo");
const elsewhere = scratch("elsewhere");
const spawned = [];

/**
 * A process that listens on a free port, started from `cwd`. It prints
 * `<port> <child pid>` once up: the child is a sleeper it started, to show
 * descendants go with it. `ignoreTerm` makes it survive SIGTERM.
 */
function holder(cwd, { ignoreTerm = false } = {}) {
  const script = `
    const { createServer } = require("node:net");
    const { spawn } = require("node:child_process");
    ${ignoreTerm ? 'process.on("SIGTERM", () => {});' : ""}
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    createServer().listen(0, "127.0.0.1", function () {
      console.log(this.address().port + " " + child.pid);
    });`;
  const proc = spawn(process.execPath, ["-e", script], { cwd, stdio: ["ignore", "pipe", "inherit"] });
  spawned.push(proc);
  return new Promise((resolve) => {
    proc.stdout.once("data", (d) => {
      const [port, child] = d.toString().trim().split(" ").map(Number);
      resolve({ proc, port, child });
    });
  });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const answers = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
/** The process has gone, allowing a moment for its exit to land. */
async function gone(pid) {
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
}

after(() => {
  for (const proc of spawned) proc.kill("SIGKILL");
  rmSync(repo, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

describe("reclaimPort", () => {
  it("says a port nobody holds is free", async () => {
    const { proc, port } = await holder(repo);
    proc.kill("SIGKILL");
    await gone(proc.pid);
    assert.deepEqual(await reclaimPort(port, { repo }), { status: "free" });
  });

  it("stops a stale holder from the checkout, and what it started, so the port can be listened on again", async () => {
    const { proc, port, child } = await holder(repo);
    assert.equal(await answers(port), true);

    const result = await reclaimPort(port, { repo, graceMs: 3000 });

    assert.equal(result.status, "reclaimed");
    assert.equal(await gone(proc.pid), true, "the holder is gone");
    assert.equal(await gone(child), true, "so is the process it started");
    assert.equal(await answers(port), false, "nothing answers on the port");
  });

  it("leaves alone a holder running from outside the checkout, and says who it is", async () => {
    const { proc, port, child } = await holder(elsewhere);

    const result = await reclaimPort(port, { repo, graceMs: 500 });

    assert.equal(result.status, "foreign");
    assert.equal(result.pid, proc.pid);
    assert.equal(alive(proc.pid), true, "the holder still runs");
    assert.equal(alive(child), true, "and so does its child");
    assert.equal(await answers(port), true, "the port is still held");
  });

  it("kills a holder that ignores SIGTERM once the grace period passes", async () => {
    const { proc, port } = await holder(repo, { ignoreTerm: true });

    const result = await reclaimPort(port, { repo, graceMs: 300 });

    assert.equal(result.status, "reclaimed");
    assert.equal(await gone(proc.pid), true);
    assert.equal(await answers(port), false);
  });

  it("doesn't treat a sibling directory that shares the checkout's name as the checkout", async () => {
    // `<repo>-other` starts with the same characters as `<repo>`: a prefix test without the separator would claim it.
    const sibling = `${repo}-other`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sibling);
    try {
      const { proc, port } = await holder(sibling);
      const result = await reclaimPort(port, { repo, graceMs: 500 });
      assert.equal(result.status, "foreign");
      assert.equal(alive(proc.pid), true);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});
