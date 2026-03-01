import type { OutputItem } from "@flow-state-dev/core/items";
import type { ItemRendererProps } from "./ItemRenderer";
import type { ItemsRendererProps } from "./ItemsRenderer";

const single: ItemRendererProps = {
  item: {
    id: "item-1",
    type: "message",
    status: "completed",
    requestId: "req-1",
    itemIndex: 0,
    ts: Date.now(),
    provenance: {
      blockName: "answer",
      blockInstanceId: "answer-1",
      phase: "main"
    },
    role: "assistant",
    content: [{ type: "output_text", text: "hello" }]
  }
};

const list: ItemsRendererProps = {
  items: [single.item as OutputItem]
};

if (single.item.type === "message") {
  void single.item.content;
}

void list;

export const reactItemTypeCompatSmoke = true;
