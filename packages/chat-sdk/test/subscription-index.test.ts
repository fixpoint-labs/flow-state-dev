/**
 * Unit tests for the chat subscription index (FIX-667). Verifies grouping
 * by event key, handling of flows without `chat.on`, binding-reference
 * preservation, and overlapping subscriptions across flows.
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance, ChatEventBinding } from "@flow-state-dev/core";
import {
  buildChatSubscriptionIndex,
  hasChatSubscriptions
} from "../src/subscription-index";

function flow(
  kind: string,
  on?: Record<string, ChatEventBinding>
): FlowInstance {
  return {
    kind,
    id: kind,
    actions: {},
    ...(on !== undefined ? { chat: { on } } : {})
  } as unknown as FlowInstance;
}

const binding = (action: string): ChatEventBinding => ({
  action,
  input: (e) => e
});

describe("buildChatSubscriptionIndex", () => {
  it("returns an empty index when no flow declares chat.on", () => {
    const index = buildChatSubscriptionIndex([flow("a"), flow("b")]);
    expect(index.byEventKey.size).toBe(0);
    expect(hasChatSubscriptions(index)).toBe(false);
  });

  it("groups a flow's bindings by event key", () => {
    const index = buildChatSubscriptionIndex([
      flow("support", {
        mention: binding("reply"),
        directMessage: binding("dm")
      })
    ]);
    expect([...index.byEventKey.keys()].sort()).toEqual([
      "directMessage",
      "mention"
    ]);
    expect(index.byEventKey.get("mention")?.[0]).toMatchObject({
      flowKind: "support",
      eventKey: "mention"
    });
    expect(hasChatSubscriptions(index)).toBe(true);
  });

  it("places overlapping subscriptions from two flows in the same bucket", () => {
    const index = buildChatSubscriptionIndex([
      flow("a", { mention: binding("x") }),
      flow("b", { mention: binding("y") })
    ]);
    const bucket = index.byEventKey.get("mention") ?? [];
    expect(bucket.map((e) => e.flowKind).sort()).toEqual(["a", "b"]);
  });

  it("preserves the original binding reference for predicate evaluation", () => {
    const original = binding("reply");
    const index = buildChatSubscriptionIndex([flow("a", { mention: original })]);
    expect(index.byEventKey.get("mention")?.[0]?.binding).toBe(original);
  });

  it("ignores a flow with an empty on map", () => {
    const index = buildChatSubscriptionIndex([flow("a", {})]);
    expect(index.byEventKey.size).toBe(0);
  });
});
