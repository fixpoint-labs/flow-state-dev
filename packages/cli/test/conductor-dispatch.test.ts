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

  it("surfaces a finished assistant message in the activity log", () => {
    const item = {
      type: "message" as const,
      role: "assistant" as const,
      content: [{ type: "output_text" as const, text: "opened the pull request" }],
    };
    expect(
      activityFromEvent({ type: "item.done", item } as RequestStreamEventWithId),
    ).toBe("message · opened the pull request");
  });
});
