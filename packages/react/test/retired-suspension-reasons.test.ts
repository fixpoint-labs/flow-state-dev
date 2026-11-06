/**
 * The suspension reasons said `human` through core 0.2.0, which stored them.
 * A stop stored under the old reason is a user's stop to the hooks: a `user_*`
 * filter finds it and a stored `human_input` draws as input. A filter written
 * with the old reason matches nothing new, so it throws, naming the new one.
 */
import { describe, expect, it } from "vitest";
import type { ItemProvenance, SuspensionItem } from "@flow-state-dev/core/items";
import { deriveSuspensions } from "../src/hooks/useSuspensions";
import { suspensionShape } from "../src/hooks/useSuspensionForm";

const provenance: ItemProvenance = { blockName: "gate", blockInstanceId: "b1", phase: "main" };

function suspension(reason: string, id: string): SuspensionItem {
  return {
    id: `item_${id}`,
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance,
    ts: 0,
    suspensionId: id,
    reason,
    message: "Ship it?",
  } as SuspensionItem;
}

describe("a suspension under a retired human_* reason, in the hooks", () => {
  it("a user_* filter finds a stop stored under the old reason", () => {
    const items = [suspension("human_approval", "old"), suspension("user_approval", "new"), suspension("custom", "other")];
    const { pending } = deriveSuspensions(items, { reasons: ["user_approval"] });
    expect(pending.map((s) => s.item.suspensionId)).toEqual(["old", "new"]);
  });

  it.each([
    ["human_approval", "user_approval"],
    ["human_input", "user_input"],
  ])("a filter naming %s throws, naming %s", (old, replacement) => {
    expect(() => deriveSuspensions([], { reasons: [old] })).toThrow(
      `useSuspensions: reason "${old}" was retired. Use "${replacement}". This refusal is removed in @flow-state-dev/contracts 0.6.0.`,
    );
  });

  it("a stored human_input stop with a submit path draws as input, not an approval", () => {
    expect(suspensionShape({ reason: "human_input", allow: ["submit"] })).toBe("question");
    expect(suspensionShape({ reason: "user_input", allow: ["submit"] })).toBe("question");
  });
});
