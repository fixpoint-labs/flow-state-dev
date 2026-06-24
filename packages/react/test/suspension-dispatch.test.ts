// @vitest-environment happy-dom
/**
 * ItemRenderer dispatch for suspension items (FIX-849).
 *
 * Verifies the default-renderer selection: a `human_input` suspension routes to
 * the form/selection/question card by schema shape; a registered
 * `render.component` wins over the reason default; and a registered
 * `renderers.suspension` (or `false`) still overrides everything.
 */
import { createElement } from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ItemProvenance, SuspensionItem } from "@flow-state-dev/core/items";
import { FlowProvider, ItemRenderer, type RendererRegistry } from "../src";

afterEach(cleanup);

const provenance: ItemProvenance = { blockName: "ask", blockInstanceId: "b1", phase: "main" };

function suspension(overrides: Partial<SuspensionItem> = {}): SuspensionItem {
  return {
    id: "item_sus",
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance,
    ts: 0,
    suspensionId: "sus_1",
    reason: "human_input",
    message: "Tell us more",
    ...overrides
  } as SuspensionItem;
}

function renderItem(item: SuspensionItem, renderers?: RendererRegistry) {
  return render(
    createElement(FlowProvider, { flowKind: "demo", renderers }, createElement(ItemRenderer, { item }))
  );
}

describe("ItemRenderer suspension dispatch", () => {
  it("renders the flat-form card for an object resumeSchema", () => {
    const { container } = renderItem(
      suspension({
        allow: ["submit"],
        resumeSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] }
      })
    );
    // SchemaFormRenderer marks each property with data-field.
    expect(container.querySelector('[data-field="note"]')).not.toBeNull();
  });

  it("renders the selection card for an enum resumeSchema", () => {
    const { container } = renderItem(
      suspension({ allow: ["submit"], resumeSchema: { type: "string", enum: ["yes", "no"] } })
    );
    expect(container.querySelector('input[type="radio"]')).not.toBeNull();
  });

  it("renders the question card for a free-text human_input", () => {
    const { container } = renderItem(suspension({ allow: ["submit"] }));
    expect(container.querySelector('[data-suspension-input="question"]')).not.toBeNull();
  });

  it("renders the approval card for a human_approval suspension", () => {
    const { getByText } = renderItem(suspension({ reason: "human_approval", allow: ["approve", "reject"] }));
    expect(getByText("Approve")).not.toBeNull();
    expect(getByText("Reject")).not.toBeNull();
  });

  it("renders the approval card for a legacy human_input with no allow set", () => {
    // A human_input gate persisted before `allow` existed has no submit path
    // (the route treats missing allow as binary), so it must render approve/reject
    // rather than a submit-only card the server would 409.
    const { getByText, container } = renderItem(suspension({ reason: "human_input", allow: undefined }));
    expect(getByText("Approve")).not.toBeNull();
    expect(container.querySelector('[data-suspension-input="question"]')).toBeNull();
  });

  it("prefers a registered render.component over the reason default", () => {
    const Custom = () => createElement("div", { "data-testid": "custom-widget" }, "custom");
    const { getByTestId } = renderItem(
      suspension({
        allow: ["submit"],
        render: { component: "myWidget" },
        resumeSchema: { type: "object", properties: { note: { type: "string" } } }
      }),
      { component: { myWidget: Custom } }
    );
    expect(getByTestId("custom-widget")).not.toBeNull();
  });

  it("lets a registered renderers.suspension override the default cards", () => {
    const Custom = () => createElement("div", { "data-testid": "suspension-override" }, "x");
    const { getByTestId } = renderItem(
      suspension({ allow: ["submit"], resumeSchema: { type: "object", properties: { note: { type: "string" } } } }),
      { suspension: Custom }
    );
    expect(getByTestId("suspension-override")).not.toBeNull();
  });

  it("suppresses inline rendering when renderers.suspension is false", () => {
    const { container } = renderItem(suspension({ allow: ["submit"] }), { suspension: false });
    expect(container.querySelector("[data-suspension]")).toBeNull();
  });
});
