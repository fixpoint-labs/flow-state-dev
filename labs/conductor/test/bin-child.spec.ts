/**
 * A stop signal on the PATH wrapper must stop the TUI child.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { attachConductorChild, CONDUCTOR_CHILD_SIGNALS } from "../bin/child.mjs";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean;
    kill: (signal?: string) => boolean;
  };
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    child.emit("exit", null, signal ?? "SIGTERM");
    return true;
  });
  return child;
}

function fakeProc() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    pid: 4242,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(fn);
      handlers.set(event, set);
      return undefined;
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(fn);
      return undefined;
    }),
    kill: vi.fn(),
    exit: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
  };
}

describe("attachConductorChild", () => {
  it("forwards SIGINT, SIGTERM, and SIGHUP to the child", () => {
    const child = fakeChild();
    const proc = fakeProc();
    attachConductorChild(child, proc as unknown as NodeJS.Process);
    expect(CONDUCTOR_CHILD_SIGNALS).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    proc.emit("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("exits the wrapper with the child's code, and re-raises a signal once", () => {
    const child = fakeChild();
    const proc = fakeProc();
    attachConductorChild(child, proc as unknown as NodeJS.Process);
    child.emit("exit", 0, null);
    expect(proc.exit).toHaveBeenCalledWith(0);
    expect(proc.kill).not.toHaveBeenCalled();

    const signaled = fakeChild();
    const proc2 = fakeProc();
    attachConductorChild(signaled, proc2 as unknown as NodeJS.Process);
    signaled.emit("exit", null, "SIGINT");
    expect(proc2.kill).toHaveBeenCalledWith(4242, "SIGINT");
    expect(proc2.off).toHaveBeenCalled();
  });
});
