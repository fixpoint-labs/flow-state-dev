import { describe, expect, it } from "vitest";
import { boundedDispose } from "../src/conductor/leave";
import { conductorLeavesProcess } from "../src/commands/conductor";

describe("boundedDispose", () => {
  it("returns settled when dispose finishes first", async () => {
    const result = await boundedDispose(async () => {}, 50);
    expect(result).toBe("settled");
  });

  it("returns left when dispose never finishes", async () => {
    const started = Date.now();
    const result = await boundedDispose(() => new Promise(() => {}), 30);
    expect(result).toBe("left");
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("does not wait when the bound is 0", async () => {
    let started = false;
    const result = await boundedDispose(() => {
      started = true;
      return new Promise(() => {});
    }, 0);
    expect(result).toBe("left");
    expect(started).toBe(true);
  });
});

describe("conductorLeavesProcess", () => {
  it("leaves after a fullscreen board", () => {
    expect(conductorLeavesProcess([])).toBe(true);
    expect(conductorLeavesProcess(["tui"])).toBe(true);
    expect(conductorLeavesProcess(["tui", "FIX-1"])).toBe(true);
  });

  it("leaves after interactive start", () => {
    expect(conductorLeavesProcess(["start", "FIX-1"], { tty: true })).toBe(true);
  });

  it("waits the host drain for headless verbs", () => {
    expect(conductorLeavesProcess(["status"])).toBe(false);
    expect(conductorLeavesProcess(["watch"])).toBe(false);
    expect(conductorLeavesProcess(["start", "FIX-1"], { tty: false })).toBe(false);
  });
});
