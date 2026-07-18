/**
 * Tests for `onTaskChangeFor` — wake filter helper paired with
 * `.waitForCondition`'s `wakeOn` option (FIX-660). The filter must
 * match `task-change` component items for its collection only, and
 * reject every other item type or sibling collection.
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import { onTaskChangeFor } from "../../src/tasks/collection/predicates";
import { TASK_CHANGE_COMPONENT_TYPE } from "../../src/tasks/collection/get-or-create";

function makeTaskChange(collectionId: string): OutputItem {
  return {
    id: `i_${Math.random().toString(36).slice(2)}`,
    type: "component",
    component: TASK_CHANGE_COMPONENT_TYPE,
    data: { collectionId, taskId: "t_0", kind: "added", task: {} },
    status: "completed",
    requestId: "req_test",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 1
  } as OutputItem;
}

function makeComponent(component: string): OutputItem {
  return {
    id: "i_other",
    type: "component",
    component,
    data: {},
    status: "completed",
    requestId: "req_test",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 1
  } as OutputItem;
}

function makeMessage(): OutputItem {
  return {
    id: "i_msg",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "hi" }],
    status: "completed",
    requestId: "req_test",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 1
  } as OutputItem;
}

describe("onTaskChangeFor", () => {
  it("matches a task-change for the target collection", () => {
    const filter = onTaskChangeFor("c1");
    expect(filter(makeTaskChange("c1"))).toBe(true);
  });

  it("rejects task-change for a different collection", () => {
    const filter = onTaskChangeFor("c1");
    expect(filter(makeTaskChange("c2"))).toBe(false);
  });

  it("rejects component items of other component types", () => {
    const filter = onTaskChangeFor("c1");
    expect(filter(makeComponent("resource-change"))).toBe(false);
    expect(filter(makeComponent("plan"))).toBe(false);
  });

  it("rejects non-component items (the wake-storm sources)", () => {
    const filter = onTaskChangeFor("c1");
    expect(filter(makeMessage())).toBe(false);
    expect(
      filter({
        id: "i_trace",
        type: "block_trace",
        status: "completed",
        requestId: "req_test",
        itemIndex: 0,
        provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
        ts: 1,
        transient: true,
        traceEvent: "started",
        blockKind: "handler"
      } as OutputItem)
    ).toBe(false);
  });
});
