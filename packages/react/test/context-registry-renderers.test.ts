import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { ItemRenderer } from "../src";
import {
  resolveRenderer,
  type RendererRegistry
} from "../src/registry/block-renderers";

describe("renderer map utilities", () => {
  it("resolves data renderers by dataType", () => {
    const chartRenderer = () => "chart";
    const registry: RendererRegistry = {
      data: { chart: chartRenderer }
    };

    expect(resolveRenderer(registry, "data", "chart")).toBe(chartRenderer);
    expect(resolveRenderer(registry, "data", "missing")).toBeUndefined();
  });

  it("resolves type-level renderers", () => {
    const messageRenderer = () => "msg";
    const registry: RendererRegistry = {
      message: messageRenderer
    };

    expect(resolveRenderer(registry, "message")).toBe(messageRenderer);
    expect(resolveRenderer(registry, "status")).toBeUndefined();
  });

  it("returns false for suppressed type-level renderers", () => {
    const registry: RendererRegistry = {
      status: false,
      message: false
    };

    expect(resolveRenderer(registry, "status")).toBe(false);
    expect(resolveRenderer(registry, "message")).toBe(false);
    expect(resolveRenderer(registry, "error")).toBeUndefined();
  });

  it("returns false for suppressed data renderers", () => {
    const registry: RendererRegistry = {
      data: { chart: false }
    };

    expect(resolveRenderer(registry, "data", "chart")).toBe(false);
    expect(resolveRenderer(registry, "data", "other")).toBeUndefined();
  });
});

describe("ItemRenderer dispatch", () => {
  it("returns null for non-client types", () => {
    const stateChangeItem: OutputItem = {
      id: "sc_1",
      type: "state_change",
      scope: "session",
      operation: "patch",
      delta: {},
      version: 1,
      status: "completed",
      requestId: "req_1",
      itemIndex: 2,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: 2
    };

    expect(ItemRenderer({ item: stateChangeItem })).toBeNull();

    const resourceChangeItem: OutputItem = {
      id: "rc_1",
      type: "resource_change",
      scope: "session",
      resourcePath: "/data",
      changeType: "updated",
      status: "completed",
      requestId: "req_1",
      itemIndex: 3,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: 3
    };

    expect(ItemRenderer({ item: resourceChangeItem })).toBeNull();
  });

  it("returns null for suspension_resume items (non-renderable type)", () => {
    const resumeItem: OutputItem = {
      id: "sr_1",
      type: "suspension_resume",
      suspensionId: "susp_abc",
      resolution: "approved",
      resolvedAt: 2000,
      status: "completed",
      requestId: "req_1",
      itemIndex: 1,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: 2000
    };

    expect(ItemRenderer({ item: resumeItem })).toBeNull();
  });

  it("returns null for continuation items (non-renderable type, FIX-865)", () => {
    const continuationItem: OutputItem = {
      id: "cont_1",
      type: "continuation",
      trigger: "recovery",
      priorItemCount: 4,
      continuedAt: 3000,
      status: "completed",
      requestId: "req_1",
      itemIndex: 5,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: 3000
    };

    expect(ItemRenderer({ item: continuationItem })).toBeNull();
  });
});

describe("suspension RendererRegistry slot", () => {
  it("resolveRenderer returns undefined when no suspension renderer is registered (falls through to built-in)", () => {
    // undefined → ItemRenderer uses the BUILT_IN_FALLBACKS ApprovalRenderer entry.
    const registry: RendererRegistry = {};
    expect(resolveRenderer(registry, "suspension")).toBeUndefined();
  });

  it("resolveRenderer returns false when suspension is suppressed (headless layout)", () => {
    // false → ItemRenderer returns null; consumer uses useSuspensions for custom layout.
    const registry: RendererRegistry = { suspension: false };
    expect(resolveRenderer(registry, "suspension")).toBe(false);
  });

  it("resolveRenderer returns the custom suspension component", () => {
    // Custom component wins over the built-in ApprovalRenderer fallback.
    const customCard = (props: { item: SuspensionItem }) => `custom:${props.item.suspensionId}`;
    const registry: RendererRegistry = { suspension: customCard };
    expect(resolveRenderer(registry, "suspension")).toBe(customCard);
  });
});

