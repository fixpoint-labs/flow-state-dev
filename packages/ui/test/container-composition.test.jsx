/** Exercises the installed registry renderers through the documented React stack. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowProvider, ItemsRenderer } from "@flow-state-dev/react";
import { SessionItemsProvider, useSessionItems } from "../registry/components/session-items-context";
import { Conversation } from "../registry/components/conversation";
import { EventedActors } from "../registry/components/evented-actors";
import { Debate } from "../registry/components/debate";
import { RoutedSpecialists } from "../registry/components/routed-specialists";

afterEach(cleanup);

const cases = [
  ["eventedActors", EventedActors, "rb-entry", { type: "observation", topic: "A visible observation" }, "A visible observation"],
  ["debate", Debate, "debate-turn", { round: 1, agentName: "Researcher", stance: "Support", text: "A visible argument" }, "Researcher"],
  ["routedSpecialists", RoutedSpecialists, "routedSpecialists", { state: { finding: "A visible finding" }, iteration: 1, specialist: "Researcher", done: false }, "A visible finding"],
];

describe("documented container composition", () => {
  it.each(cases)("renders %s and updates its owned state without an extra provider", (name, Renderer, component, data, expected) => {
    const base = {
      status: "in_progress",
      requestId: "request-1",
      ts: 1,
      provenance: { blockName: name, blockInstanceId: "container-1", phase: "main" },
    };
    const container = { ...base, id: "container", type: "container", itemIndex: 0, component: name };
    const child = { ...base, id: "child", type: "component", itemIndex: 1, component, data, ownedBy: "container-1" };
    const view = (items) => (
      <FlowProvider renderers={{ container: { [name]: Renderer } }}>
        <Conversation><ItemsRenderer items={items} /></Conversation>
      </FlowProvider>
    );

    const result = render(view([container, child]));
    expect(result.container.textContent).toContain(expected);
    // The child must be rendered by its container, not the raw JSON fallback.
    expect(result.container.querySelector("pre")).toBeNull();
    const updated = JSON.parse(JSON.stringify(child).replaceAll(expected, "Updated content"));
    result.rerender(view([container, updated]));
    expect(result.container.textContent).toContain("Updated content");
    expect(result.container.textContent).not.toContain(expected);
    result.rerender(view([]));
    expect(result.container.textContent).toBe("");
    result.rerender(view([container, child]));
    expect(result.container.textContent).toContain(expected);
  });
});

// Nested renderers need the original item log, even when rendering a subset.
function ItemIds() {
  return <span>{useSessionItems().map((item) => item.id).join(",")}</span>;
}

it("preserves the enclosing item source through nested lists and explicit empty overrides", () => {
  const item = (id, component) => ({
    id, type: "component", component, data: {}, status: "completed", requestId: "req", itemIndex: 0,
    ts: 0, provenance: { blockName: "test", blockInstanceId: id, phase: "main" },
  });
  const probe = item("probe", "probe");
  const items = [item("outer", "nested"), item("hidden", "hidden")];
  function Nested() { return <ItemsRenderer items={[probe]} />; }
  const view = (source) => (
    <FlowProvider renderers={{ component: { nested: Nested, probe: ItemIds, hidden: false } }}>
      <SessionItemsProvider value={source}><ItemsRenderer items={items} /></SessionItemsProvider>
    </FlowProvider>
  );
  const result = render(view(undefined));
  expect(result.container.textContent).toBe("outer,hidden");
  result.rerender(view([item("explicit", "hidden")]));
  expect(result.container.textContent).toBe("explicit");
  result.rerender(view([]));
  expect(result.container.textContent).toBe("");
});
