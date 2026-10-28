/** Claim order for tasks filed in the same millisecond (FIX-2219). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStateBackedTaskCollection } from "../../src/tasks";
import { generateId } from "../../src/tasks/generate-id";
import { createFakeSequencerState } from "../helpers";

function counterOf(id: string): number {
  return Number(id.split("_")[2]);
}

/** The counter is process-wide, so the boundary sits above wherever this worker has minted. */
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
  it("are claimed in filing order across a digit boundary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const boundary = straddleNextDigitBoundary();
    const collection = createStateBackedTaskCollection({
      collectionId: "claim-order",
      state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    });
    const a = await collection.createTask({ goal: "a" });
    const b = await collection.createTask({ goal: "b" });
    const c = await collection.createTask({ goal: "c" });
    expect(counterOf(b.id)).toBe(boundary - 1);
    expect(counterOf(c.id)).toBe(boundary);

    const claimed = [];
    for (let i = 0; i < 3; i += 1) claimed.push((await collection.claim("w1"))?.id);
    expect(claimed).toEqual([a.id, b.id, c.id]);
  });
});
