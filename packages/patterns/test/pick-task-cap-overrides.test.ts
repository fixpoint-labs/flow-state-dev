import { describe, expect, it } from "vitest";
import { pickTaskCapOverrides } from "../src/shared/task-caps";

describe("pickTaskCapOverrides", () => {
  it("omits unset axes and forwards null as the unbounded opt-out", () => {
    expect(pickTaskCapOverrides({})).toEqual({});
    expect(pickTaskCapOverrides({ maxTotalTasks: 10 })).toEqual({
      maxTotalTasks: 10,
    });
    expect(
      pickTaskCapOverrides({
        maxTotalRetries: null,
        maxEnqueuedTasks: 4,
      }),
    ).toEqual({
      maxTotalRetries: null,
      maxEnqueuedTasks: 4,
    });
  });
});
