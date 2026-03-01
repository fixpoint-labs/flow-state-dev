import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { encodeStreamEvent } from "@flow-state-dev/server";

const mockItem: OutputItem = {
  id: "item-1",
  type: "status",
  status: "completed",
  requestId: "req-1",
  itemIndex: 0,
  ts: Date.now(),
  provenance: {
    blockName: "testing",
    blockInstanceId: "testing-1",
    phase: "main"
  },
  message: "ok"
};

const event: RequestStreamEvent = {
  stream: "request",
  requestId: "req-1",
  sequence_number: 1,
  ts: Date.now(),
  type: "item.added",
  item: mockItem
};

const encoded = encodeStreamEvent(event);
const payloadLine = encoded.split("\n").find((line) => line.startsWith("data:"));
if (payloadLine !== undefined) {
  const decoded = JSON.parse(payloadLine.slice(5).trim()) as RequestStreamEvent;
  if (decoded.type === "item.added" || decoded.type === "item.done") {
    void decoded.item.provenance.blockName;
  }
}

export const testingImportBoundarySmoke = true;
