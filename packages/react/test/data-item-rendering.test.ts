// @vitest-environment happy-dom
/**
 * `data` items in the React layer: a data item is drawn by the renderer
 * registered for its `dataType`, and with none it renders nothing — never
 * the JSON dev fallback. It dedups by key, is managed by a container
 * renderer, and `useContainerItems` reads a container's state off the data
 * item that names it.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ContainerItem, DataItem, OutputItem } from "@flow-state-dev/core/items";
import { conversationLines, ItemRenderer, useContainerItems, type RendererRegistry } from "../src";
import { resolveRenderer } from "../src/registry/block-renderers";

const renderers: { current: RendererRegistry } = { current: {} };
vi.mock("../src/context/FlowContext", () => ({ useFlowContext: () => ({ renderers: renderers.current }) }));

function dataItem(id: string, dataType: string, value: Record<string, unknown>, overrides: Partial<DataItem> = {}): DataItem {
  return {
    id,
    type: "data",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "b", blockInstanceId: "b#1", phase: "main" },
    dataType,
    value,
    ...overrides
  };
}

describe("data renderers", () => {
  it("resolves a renderer by dataType, and never by a suspension renderer of the same name", () => {
    const Route = () => null;
    const registry: RendererRegistry = { data: { route: Route }, component: { other: Route } };
    expect(resolveRenderer(registry, "data", "route")).toBe(Route);
    expect(resolveRenderer(registry, "data", "other")).toBeUndefined();
  });

  it("renders a registered data renderer with the item", () => {
    const Route = () => null;
    renderers.current = { data: { route: Route } };
    const node = ItemRenderer({ item: dataItem("d1", "route", { to: "a" }) }) as { type: unknown; props: { item: OutputItem } };
    expect(node.type).toBe(Route);
    expect(node.props.item.id).toBe("d1");
  });

  it("renders nothing for an unregistered data item, rather than a JSON blob", () => {
    renderers.current = {};
    expect(ItemRenderer({ item: dataItem("d1", "task-change", { taskId: "t" }) })).toBeNull();
  });
});

describe("conversationLines with data items", () => {
  it("keeps only the latest keyed data record per request", () => {
    const items = [
      dataItem("item_data_keyed:k", "board", { n: 1 }, { key: "k" }),
      dataItem("x", "turn", { n: 1 }),
      dataItem("item_data_keyed:k", "board", { n: 2 }, { key: "k" })
    ];
    const lines = conversationLines(items);
    expect(lines.map((line) => (line.kind === "data" ? (line.item as DataItem).value : null))).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("leaves a container's data records to its registered container renderer", () => {
    const container: ContainerItem = {
      id: "c",
      type: "container",
      status: "completed",
      requestId: "req",
      itemIndex: 0,
      ts: 0,
      provenance: { blockName: "debate", blockInstanceId: "debate#1", phase: "main" },
      blockName: "debate",
      component: "debate"
    };
    const owned = dataItem("t", "debate-turn", { text: "hi" }, { ownedBy: "debate#1" });
    const lines = conversationLines([container, owned], [], { renderers: { container: { debate: () => null } } });
    expect(lines.map((line) => line.id)).toEqual(["c"]);
  });
});

describe("useContainerItems with data items", () => {
  it("reads the container's state from the latest data record named for it, and each keyed record by key", () => {
    const container: ContainerItem = {
      id: "c",
      type: "container",
      status: "completed",
      requestId: "req",
      itemIndex: 0,
      ts: 0,
      provenance: { blockName: "rs", blockInstanceId: "rs#1", phase: "main" },
      blockName: "rs",
      component: "routedSpecialists"
    };
    const items: OutputItem[] = [
      dataItem("a", "routedSpecialists", { iteration: 1 }, { ownedBy: "rs#1", key: "rs" }),
      dataItem("b", "routedSpecialists", { iteration: 2 }, { ownedBy: "rs#1", key: "rs" }),
      dataItem("c2", "note", { n: 1 }, { ownedBy: "rs#1", key: "note-1" })
    ];
    const { result } = renderHook(() => useContainerItems(container, items));
    expect(result.current.state).toEqual({ iteration: 2 });
    expect(result.current.dataByKey.get("rs")).toEqual({ iteration: 2 });
    expect(result.current.dataByKey.get("note-1")).toEqual({ n: 1 });
  });
});
