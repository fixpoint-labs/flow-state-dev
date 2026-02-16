import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import {
  BlockRenderer,
  ItemRenderer,
  ItemsRenderer,
  MessagesRenderer,
  clearBlockRenderers,
  getBlockRenderer,
  getFlowContext,
  listBlockRendererKeys,
  registerBlockRenderer,
  setFlowContext,
  withFlowContext
} from "../src";

function buildBlockOutputItem(overrides: Partial<BlockOutputItem> = {}): BlockOutputItem {
  return {
    id: "item_block",
    type: "fsd:block_output",
    status: "completed",
    visibility: "ui",
    requestId: "req_1",
    itemIndex: 1,
    provenance: {
      blockName: "renderable",
      blockInstanceId: "inst_1",
      phase: "main"
    },
    ts: 1,
    blockName: "renderable",
    renderName: "shared",
    output: {
      value: 1
    },
    ...overrides
  };
}

describe("FlowContext helpers", () => {
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
  });
});

describe("block renderer registry", () => {
  it("registers, resolves, lists, and clears renderers", () => {
    clearBlockRenderers();

    const renderer = () => ({
      rendered: true
    });

    registerBlockRenderer("shared", renderer);

    expect(getBlockRenderer("shared")).toBe(renderer);
    expect(listBlockRendererKeys()).toEqual(["shared"]);

    clearBlockRenderers();
    expect(getBlockRenderer("shared")).toBeUndefined();
  });
});

describe("render helpers", () => {
  it("renders block output with custom renderer when available", () => {
    clearBlockRenderers();
    registerBlockRenderer("shared", (props) => ({
      kind: "custom",
      blockName: props.blockName
    }));

    const rendered = BlockRenderer({
      item: buildBlockOutputItem()
    });

    expect(rendered).toEqual({
      kind: "custom",
      blockName: "renderable"
    });
  });

  it("falls back to default payload when no custom renderer exists", () => {
    clearBlockRenderers();

    const rendered = BlockRenderer({
      item: buildBlockOutputItem({
        renderName: undefined
      })
    }) as { type: string; renderKey: string };

    expect(rendered.type).toBe("block-output");
    expect(rendered.renderKey).toBe("renderable");
  });

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
        visibility: "ui",
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
        type: "fsd:status",
        message: "working",
        status: "in_progress",
        visibility: "internal",
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

    const renderedList = ItemsRenderer({ items }) as Array<{ type: string }>;
    expect(renderedList).toHaveLength(2);
    expect(renderedList[0]?.type).toBe("status");

    const renderedMessages = MessagesRenderer({ items }) as Array<{ type: string }>;
    expect(renderedMessages).toHaveLength(1);
    expect(renderedMessages[0]?.type).toBe("message");

    const oneItem = ItemRenderer({ item: items[0] }) as { type: string; text: string };
    expect(oneItem.type).toBe("message");
    expect(oneItem.text).toBe("hello");
  });
});
