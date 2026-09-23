// @vitest-environment happy-dom
/**
 * Documented composition must supply session items to container renderers
 * (FIX-1498). EventedActors / Debate / RoutedSpecialists call
 * `useSessionItems()` and render nothing when the list is empty. The
 * README stack is FlowProvider + ItemsRenderer — no extra provider.
 *
 * This test fails if ItemsRenderer does not mount SessionItemsProvider:
 * the probe sees `[]`, `useContainerItems` finds no owned snapshot, and
 * the container returns null.
 */
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  ComponentItem,
  ContainerItem,
  ItemProvenance
} from "@flow-state-dev/core/items";
import {
  FlowProvider,
  ItemsRenderer,
  SessionItemsProvider,
  useContainerItems,
  useSessionItems
} from "../src";

afterEach(cleanup);

const provenance: ItemProvenance = {
  blockName: "debate",
  blockInstanceId: "debate-1",
  phase: "main"
};

function containerItem(): ContainerItem {
  return {
    id: "ctr_1",
    type: "container",
    status: "in_progress",
    requestId: "req_1",
    itemIndex: 0,
    ts: 0,
    provenance,
    component: "debate"
  };
}

function ownedSnapshot(): ComponentItem {
  return {
    id: "cmp_1",
    type: "component",
    status: "completed",
    requestId: "req_1",
    itemIndex: 1,
    ts: 1,
    provenance,
    ownedBy: "debate-1",
    component: "debate",
    data: { label: "visible-turn" }
  };
}

function ProbeContainer({ item }: { item: ContainerItem }): ReactNode {
  const allItems = useSessionItems();
  const { state } = useContainerItems<{ label: string }>(item, allItems);
  if (state === undefined) return null;
  return createElement("div", { "data-testid": "container-probe" }, state.label);
}

describe("ItemsRenderer session-items provider (FIX-1498)", () => {
  it("lets a container renderer read session items under FlowProvider + ItemsRenderer", () => {
    const items = [containerItem(), ownedSnapshot()];

    render(
      createElement(
        FlowProvider,
        { renderers: { container: { debate: ProbeContainer } } },
        createElement(ItemsRenderer, { items })
      )
    );

    expect(screen.getByTestId("container-probe").textContent).toBe("visible-turn");
  });

  it("keeps an ancestor session list when ItemsRenderer is given a filtered subset", () => {
    // RequestGroup drops task-owned items before ItemsRenderer so they
    // render only inside TaskPlan. TaskPlan reads useSessionItems().
    // Replacing the ancestor list with that subset empties the expansion.
    const visible = containerItem();
    const taskOwned = ownedSnapshot();

    function ExpansionProbe(): ReactNode {
      const ids = useSessionItems().map((item) => item.id);
      return createElement("div", { "data-testid": "seen-ids" }, ids.join(" "));
    }

    render(
      createElement(
        SessionItemsProvider,
        { value: [visible, taskOwned] },
        createElement(
          FlowProvider,
          { renderers: { container: { debate: ExpansionProbe } } },
          createElement(ItemsRenderer, { items: [visible] })
        )
      )
    );

    expect(screen.getByTestId("seen-ids").textContent).toContain("cmp_1");
  });
});
