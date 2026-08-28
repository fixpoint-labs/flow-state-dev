import { describe, expect, it } from "vitest";
import { activityFromEvent } from "../src/conductor/dispatch";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";

describe("activityFromEvent", () => {
  it("prints a status line once, on item.done, not on item.added", () => {
    const item = { type: "status" as const, message: "seeded ASK-1--implement" };
    expect(
      activityFromEvent({ type: "item.added", item } as RequestStreamEventWithId),
    ).toBeUndefined();
    expect(
      activityFromEvent({ type: "item.done", item } as RequestStreamEventWithId),
    ).toBe("status · seeded ASK-1--implement");
  });
});
