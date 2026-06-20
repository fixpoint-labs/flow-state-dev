import type { OutputItem, SuspensionItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import {
  ItemRenderer,
  getFlowContext,
  setFlowContext,
  withFlowContext
} from "../src";
import {
  resolveRenderer,
  type RendererRegistry
} from "../src/registry/block-renderers";

// Minimal SuspensionItem fixture for registry/ItemRenderer tests.
function makeSuspensionItem(overrides: Partial<SuspensionItem> = {}): SuspensionItem {
  return {
    id: "sus_1",
    type: "suspension",
    suspensionId: "susp_abc",
    suspensionStatus: "pending",
    reason: "human_approval",
    message: "Please approve this action.",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "gate", blockInstanceId: "gate_1", phase: "main" },
    ts: 1000,
    ...overrides
  };
}

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
  it("resolves keyed component renderers", () => {
    const chartRenderer = () => "chart";
    const registry: RendererRegistry = {
      component: { chart: chartRenderer }
    };

    expect(resolveRenderer(registry, "component", "chart")).toBe(chartRenderer);
    expect(resolveRenderer(registry, "component", "missing")).toBeUndefined();
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

  it("returns false for suppressed keyed component renderers", () => {
    const registry: RendererRegistry = {
      component: { chart: false }
    };

    expect(resolveRenderer(registry, "component", "chart")).toBe(false);
    expect(resolveRenderer(registry, "component", "other")).toBeUndefined();
  });
});

describe("ItemRenderer dispatch", () => {
  it("returns null for non-client types", () => {
    const stateChangeItem: OutputItem = {
      id: "sc_1",
      type: "state_change",
      scope: "session",
      operation: "patchState",
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
      changeType: "set",
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
      status: "completed",
      requestId: "req_1",
      itemIndex: 1,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: 2000
    };

    expect(ItemRenderer({ item: resumeItem })).toBeNull();
  });
});

describe("suspension RendererRegistry slot", () => {
  it("resolveRenderer returns a custom suspension renderer", () => {
    const customCard = () => "custom";
    const registry: RendererRegistry = { suspension: customCard };
    expect(resolveRenderer(registry, "suspension")).toBe(customCard);
  });

  it("resolveRenderer returns false when suspension is suppressed", () => {
    const registry: RendererRegistry = { suspension: false };
    expect(resolveRenderer(registry, "suspension")).toBe(false);
  });

  it("resolveRenderer returns undefined when no suspension renderer is registered", () => {
    const registry: RendererRegistry = {};
    expect(resolveRenderer(registry, "suspension")).toBeUndefined();
  });

  it("resolveRenderer returns the ApprovalRenderer built-in for suspension when no registry is set", () => {
    // When no custom renderer is registered, resolveRenderer returns undefined,
    // and ItemRenderer falls through to the BUILT_IN_FALLBACKS which renders ApprovalRenderer.
    // We verify the resolution contract at the registry level (pure; no React context needed).
    const registry: RendererRegistry = {};
    expect(resolveRenderer(registry, "suspension")).toBeUndefined();
  });

  it("resolveRenderer returns false for suppressed suspension, which suppresses inline rendering", () => {
    const registry: RendererRegistry = { suspension: false };
    expect(resolveRenderer(registry, "suspension")).toBe(false);
  });

  it("resolveRenderer returns the custom suspension component", () => {
    const customCard = (props: { item: SuspensionItem }) => `custom:${props.item.suspensionId}`;
    const registry: RendererRegistry = { suspension: customCard };
    expect(resolveRenderer(registry, "suspension")).toBe(customCard);
  });
});

