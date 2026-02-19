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
  normalizeRendererKey,
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
  it("normalizes keys and resolves renderers", () => {
    const renderer = () => "ok";
    const map: BlockRendererMap = {
      [normalizeRendererKey(" shared ")]: renderer
    };

    expect(resolveRenderer(map, "shared")).toBe(renderer);
  });

  it("throws on empty renderer keys", () => {
    expect(() => normalizeRendererKey("   ")).toThrow("non-empty");
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

    const renderedList = ItemsRenderer({ items }) as Array<{
      type: string;
    }>;
    expect(renderedList).toHaveLength(2);
    expect(renderedList[0]?.type).toBe("status");

    const renderedMessages = MessagesRenderer({ items }) as Array<{
      type: string;
    }>;
    expect(renderedMessages).toHaveLength(1);
    expect(renderedMessages[0]?.type).toBe("message");

    const oneItem = ItemRenderer({ item: items[0] }) as {
      type: string;
      text: string;
    };
    expect(oneItem.type).toBe("message");
    expect(oneItem.text).toBe("hello");
  });
});
