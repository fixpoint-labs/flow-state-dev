import { describe, it, expect } from "vitest";
import { trackProcess } from "../../src/sdk/process-exit";

const node = (script: string, signal = new AbortController().signal) => ({
  command: process.execPath,
  args: ["-e", script],
  env: { ...process.env },
  signal,
});

describe("trackProcess", () => {
  it("has nothing to wait on until something is spawned through it", () => {
    expect(trackProcess().exited()).toBeNull();
  });

  it("resolves exited() when the process exits, and keeps the end of its stderr", async () => {
    const tracked = trackProcess();
    tracked.spawn(node("process.stderr.write('auth failed: no key'); process.exit(1)"));
    await tracked.exited();
    expect(tracked.stderrTail()).toBe("auth failed: no key");
  });

  it("does not count the abort-time `error` as an exit — only the process going does", async () => {
    // Node emits `error` the moment the forwarded signal aborts, before the
    // child it is killing has exited. Treating that as the exit is the window
    // this module exists to close.
    const controller = new AbortController();
    const tracked = trackProcess();
    const child = tracked.spawn(
      node("process.on('SIGTERM', () => setTimeout(() => process.exit(0), 150)); setInterval(() => {}, 1000)", controller.signal),
    );
    child.on("error", () => {});
    await new Promise((resolve) => setTimeout(resolve, 100)); // let it install its handler
    let exited = false;
    void tracked.exited()!.then(() => {
      exited = true;
    });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exited).toBe(false);
    await tracked.exited();
    expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });

  it("resolves exited() for a process that never started, so nothing waits on it", async () => {
    const tracked = trackProcess();
    const child = tracked.spawn({
      command: "/nonexistent/claude-binary",
      args: [],
      env: { ...process.env },
      signal: new AbortController().signal,
    });
    child.on("error", () => {});
    await tracked.exited();
    expect(child.pid).toBeUndefined();
  });
});
