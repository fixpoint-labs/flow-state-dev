/**
 * Tests for `onTaskChangeFor` — wake filter helper paired with
 * `.waitForCondition`'s `wakeOn` option (FIX-660). The filter must
 * match `task-change` data items for its collection only, and
 * reject every other item type or sibling collection.
 */
import { describe, expect, it } from "vitest";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import { onTaskChangeFor } from "../../src/tasks/collection/predicates";
import { TASK_CHANGE_DATA_TYPE } from "../../src/tasks/collection/get-or-create";

function makeTaskChange(collectionId: string): OutputItem {
  return {
    id: `i_${Math.random().toString(36).slice(2)}`,
    type: "data",
    dataType: TASK_CHANGE_DATA_TYPE,
    value: { collectionId, taskId: "t_0", kind: "added", task: {} },
    status: "completed",
    requestId: "req_test",
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test_1", phase: "main" },
    ts: 1
  } as OutputItem;
}

function makeData(dataType: string): OutputItem {
  return {
    id: "i_other",
    type: "data",
    dataType,
    value: {},
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

  it("rejects data items of other data types", () => {
    const filter = onTaskChangeFor("c1");
    expect(filter(makeData("resource-change"))).toBe(false);
    expect(filter(makeData("plan"))).toBe(false);
  });

  it("rejects non-data items (the wake-storm sources)", () => {
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
        blockName: "test",
        blockInstanceId: "test_1",
        blockKind: "handler"
      } satisfies BlockTraceItem)
    ).toBe(false);
  });
});
