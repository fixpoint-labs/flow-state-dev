/**
 * Unit tests for the shared `mapLimit` bounded-concurrency helper.
 *
 * `mapLimit` is the throttle behind the live data fan-outs (FRED macro series,
 * portfolio quotes). The two properties that matter for correctness are encoded
 * here: it never exceeds the concurrency cap (the whole point — otherwise a
 * 20-ticker portfolio bursts the provider and drops quotes), and it preserves
 * input order in the result regardless of completion order (the quote at index
 * i must line up with ticker i).
 */
import { describe, expect, it } from "vitest";
import { mapLimit, sleep } from "../lib/concurrency";

describe("mapLimit", () => {
  it("preserves input order even when later items finish first", async () => {
    // Descending delay: the LAST item resolves first. Output must still be in
    // input order — this is what keeps quote[i] aligned with ticker[i].
    const out = await mapLimit([10, 20, 30, 40], 4, async (n) => {
      await sleep(50 - n); // 40ms, 30ms, 20ms, 10ms → item 40 finishes first
      return n * 2;
    });
    expect(out).toEqual([20, 40, 60, 80]);
  });

  it("never runs more than `limit` calls in flight, and saturates the pool", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async (i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10);
      inFlight -= 1;
      return i;
    });
    // The cap is respected (the bug fix) AND the pool is actually used (with 12
    // items and a 10ms body, all 3 slots overlap).
    expect(maxInFlight).toBe(3);
  });

  it("clamps the worker count to the item count (no over-spawn)", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const out = await mapLimit([1, 2], 10, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
      return n;
    });
    expect(out).toEqual([1, 2]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("resolves an empty input to [] without invoking fn", async () => {
    let called = false;
    const out = await mapLimit([], 5, async () => {
      called = true;
      return 1;
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});
