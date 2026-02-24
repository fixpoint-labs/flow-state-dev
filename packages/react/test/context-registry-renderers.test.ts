import type { OutputItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import {
  ItemRenderer,
  ItemsRenderer,
  MessagesRenderer,
  getFlowContext,
  setFlowContext,
  withFlowContext
} from "../src";
import {
  resolveRenderer,
  type BlockRendererMap
} from "../src/registry/block-renderers";

describe("FlowContext legacy helpers", () => {
  it("sets, reads, and restores context values", () => {
    setFlowContext({
      flowKind: "demo",
      userId: "devuser"
    });

    expect(getFlowContext()).toMatchObject({
      flowKind: "demo",
      userId: "devuser"
    });

    const value = withFlowContext(
      {
        flowKind: "nested",
        userId: "inner"
      },
      () => getFlowContext()
    );

    expect(value.flowKind).toBe("nested");
    expect(getFlowContext().flowKind).toBe("demo");

    setFlowContext({});
  });
});

describe("renderer map utilities", () => {
  it("resolves renderers by item type", () => {
    const renderer = () => "ok";
    const map: BlockRendererMap = {
      shared: renderer
    };

    expect(resolveRenderer(map, "shared")).toBe(renderer);
  });
});

describe("render helpers", () => {
  it("renders item collections with sorting and message filtering", () => {
    const items: OutputItem[] = [
      {
        id: "item_2",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "hello"
          }
        ],
        status: "completed",
        requestId: "req_1",
        itemIndex: 2,
        provenance: {
          blockName: "runtime",
          blockInstanceId: "runtime",
          phase: "main"
        },
        ts: 2
      },
      {
        id: "item_1",
        type: "status",
        message: "working",
        status: "in_progress",
        requestId: "req_1",
        itemIndex: 1,
        provenance: {
          blockName: "runtime",
          blockInstanceId: "runtime",
          phase: "main"
        },
        ts: 1
      }
    ];

    const renderedList = ItemsRenderer({ items }) as Array<{
      type: string;
      props: Record<string, unknown>;
    }>;
    expect(renderedList).toHaveLength(2);
    // Sorted by itemIndex: status (1) then message (2).
    // Status renders as createElement("div", { "data-status": ... }).
    expect(renderedList[0]?.props?.["data-status"]).toBe("in_progress");

    const renderedMessages = MessagesRenderer({ items }) as Array<{
      type: string;
      props: Record<string, unknown>;
    }>;
    expect(renderedMessages).toHaveLength(1);
    expect(renderedMessages[0]?.props?.["data-role"]).toBe("assistant");

    const oneItem = ItemRenderer({ item: items[0] }) as {
      type: string;
      props: Record<string, unknown>;
    };
    // Message renders as createElement("div", { "data-role": ... }, ...).
    expect(oneItem.type).toBe("div");
    expect(oneItem.props?.["data-role"]).toBe("assistant");
  });
});
