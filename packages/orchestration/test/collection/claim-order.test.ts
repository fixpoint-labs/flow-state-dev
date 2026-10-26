/**
 * Claim order for tasks filed in the same millisecond (FIX-2219).
 *
 * A claim takes the earliest `createdAt` first and breaks a tie on the task
 * id. Ids carry a per-process counter, so the tie-break is filing order only
 * while ids compare in the order they were minted, including across a digit
 * boundary such as 99 → 100.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStateBackedTaskCollection } from "../../src/tasks";
import { generateId } from "../../src/tasks/generate-id";
import { createFakeSequencerState } from "../helpers";

function makeCollection() {
  return createStateBackedTaskCollection({
    collectionId: "claim-order",
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
  });
}

/** The counter `generateId` minted into `id`. */
function counterOf(id: string): number {
  return Number(id.split("_")[2]);
}

/**
 * Mint ids so the next three straddle a digit boundary: the counter is shared
 * by every file a worker runs, so the boundary is picked above wherever it is.
 */
function straddleNextDigitBoundary(): number {
  let n = counterOf(generateId("probe"));
  const boundary = 10 ** String(n + 3).length;
  while (n < boundary - 3) n = counterOf(generateId("probe"));
  return boundary;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tasks filed in the same millisecond", () => {
  it.each([1, 2, 3])("are claimed in filing order across a counter digit boundary (%i)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const boundary = straddleNextDigitBoundary();
    const collection = makeCollection();
    const a = await collection.addTask({ goal: "a" });
    const b = await collection.addTask({ goal: "b" });
    const c = await collection.addTask({ goal: "c" });
    // The case is only meaningful if the three really straddle the boundary.
    expect(counterOf(b.id)).toBe(boundary - 1);
    expect(counterOf(c.id)).toBe(boundary);

    const claimed = [];
    for (let i = 0; i < 3; i += 1) claimed.push((await collection.claim("w1"))?.id);
    expect(claimed).toEqual([a.id, b.id, c.id]);
  });
});
