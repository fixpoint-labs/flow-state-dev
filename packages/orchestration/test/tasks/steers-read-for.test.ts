// FIX-2795.
/**
 * Which steers a stopped request gives back: the ones its own read took, named
 * by the read's `takenIn`. Matched on a whole `:`-separated segment, never a
 * substring, so a stop of one request never gives back a steer another one
 * (whose id it is a prefix of) is answering.
 */
import { describe, expect, it } from "vitest";
import { readFor, untakenBy } from "../../src/tasks/steers";

const steer = (id: string, takenIn: string | undefined) => ({
  id,
  message: `steer ${id}`,
  from: "user" as const,
  at: 1,
  ...(takenIn !== undefined ? { takenBy: 1, takenIn } : {}),
});

describe("a read's owner", () => {
  it("is the request a whole segment names, in each read shape the board writes", () => {
    expect(readFor("turn:req_1", "req_1")).toBe(true);
    expect(readFor("step:req_1", "req_1")).toBe(true);
    expect(readFor("live:req_1:2:0", "req_1")).toBe(true);
  });

  it("is never a request whose id is only a prefix of the one the read names", () => {
    expect(readFor("step:req_10", "req_1")).toBe(false);
    expect(readFor("live:req_10:0:0", "req_1")).toBe(false);
    expect(readFor(undefined, "req_1")).toBe(false);
  });
});

describe("the steers a stopped request gives back", () => {
  it("are only the ones its own read took: another request's steer stays taken", () => {
    const task = { attempts: 1, steers: [steer("a", "step:req_1"), steer("b", "step:req_10"), steer("c", undefined)] };
    const back = untakenBy(task as never, "req_1") as typeof task;
    expect(back.steers.map((s) => [s.id, "takenBy" in s ? s.takenBy : undefined])).toEqual([
      ["a", undefined],
      ["b", 1],
      ["c", undefined],
    ]);
  });

  it("leave the task as it was when its read took none", () => {
    const task = { attempts: 1, steers: [steer("b", "step:req_10")] };
    expect(untakenBy(task as never, "req_1")).toBe(task);
  });
});
