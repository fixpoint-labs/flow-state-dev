/**
 * `mapBounded`: the session listing's status reads run a few at a time, so
 * a long unlimited listing is never a burst of concurrent store reads.
 */
import { describe, expect, it } from "vitest";
import { mapBounded } from "../../src/utils/map-bounded";

describe("mapBounded", () => {
  it("never has more than the limit in flight, and keeps the input's order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapBounded(Array.from({ length: 30 }, (_, i) => i), 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n % 3));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(out).toEqual(Array.from({ length: 30 }, (_, i) => i * 2));
  });

  it("maps nothing to nothing", async () => {
    expect(await mapBounded([], 8, async () => 1)).toEqual([]);
  });
});
