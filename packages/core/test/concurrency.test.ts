import { describe, expect, it } from "vitest";
import { mapLimit } from "../src/helpers/concurrency";

describe("mapLimit", () => {
  it("preserves input order in the result", async () => {
    const out = await mapLimit([10, 20, 30], 2, async (n) => n * 2);
    expect(out).toEqual([20, 40, 60]);
  });

  it("passes the index to the mapper", async () => {
    const out = await mapLimit(["a", "b", "c"], 1, async (v, i) => `${i}:${v}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("never runs more than maxConcurrency mappers at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit(
      Array.from({ length: 6 }, (_, i) => i),
      2,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Yield across a macrotask so concurrent workers overlap.
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return n;
      }
    );
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("runs unbounded when maxConcurrency is undefined", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 5 }, (_, i) => i), undefined, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });
    expect(peak).toBe(5);
  });

  it("returns [] without invoking the mapper on empty input", async () => {
    let called = false;
    const out = await mapLimit([], 4, async () => {
      called = true;
      return 1;
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it("propagates the first rejecting mapper call", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow("boom");
  });
});
