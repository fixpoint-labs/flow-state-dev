/** `testItems().data(dataType?)`: data records by type, so a test can assert a record without a type cast. */
import { describe, expect, it } from "vitest";
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import { testItems } from "../src/test-utilities/testItems";

const base = { status: "completed", requestId: "r", provenance: { blockName: "b", blockInstanceId: "b#1", phase: "main" }, ts: 1 } as const;
const items = [
  { ...base, id: "1", itemIndex: 1, type: "data", dataType: "route", value: { to: "a" } },
  { ...base, id: "2", itemIndex: 2, type: "data", dataType: "turn", value: { n: 1 } },
  { ...base, id: "3", itemIndex: 3, type: "message", role: "assistant", content: [] }
] as unknown as RuntimeItem[];

describe("testItems().data", () => {
  it("returns every data item, and only data items", () => {
    expect(testItems(items).data().map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("filters by dataType", () => {
    expect(testItems(items).data("route").map((item) => item.value)).toEqual([{ to: "a" }]);
  });
});
