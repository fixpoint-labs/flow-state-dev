// @vitest-environment happy-dom
/**
 * The `stopped` slot of the renderer registry, read by `ItemsRenderer`
 * through a real provider tree. A host that registers its own stopped line
 * on an outer `FlowProvider` must see it drawn under an inner provider that
 * sets other renderers, and an inner `stopped: false` must hide the line
 * even when the outer provider registered one; otherwise a host's stop UI
 * silently falls back to the plain "Stopped" text.
 */
import { createElement, type ReactNode } from "react";
import { cleanup, render as draw } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowProvider, ItemsRenderer, type ItemLine, type RendererRegistry } from "../src";

const stoppedLine: ItemLine = { kind: "stopped", id: "stopped:r1", requestId: "r1" };

function CustomStopped(): ReactNode {
  return createElement("p", { "data-custom": "stopped" }, "You stopped this turn");
}

function Lines(): ReactNode {
  return createElement("div", null, ...ItemsRenderer({ lines: [stoppedLine] }));
}

afterEach(cleanup);

function render(outer: RendererRegistry, inner: RendererRegistry): string {
  const inside = createElement(FlowProvider, { renderers: inner, children: createElement(Lines) });
  return draw(createElement(FlowProvider, { renderers: outer, children: inside })).container.innerHTML;
}

describe("ItemsRenderer: the stopped slot", () => {
  it("draws a stopped renderer registered on a parent provider", () => {
    const html = render({ stopped: CustomStopped }, { message: false });
    expect(html).toContain("You stopped this turn");
    expect(html).not.toContain('data-line="stopped"');
  });

  it("hides the line when an inner provider sets stopped to false over a parent's renderer", () => {
    const html = render({ stopped: CustomStopped }, { stopped: false });
    expect(html).toBe("<div></div>");
  });

  it("draws the plain fallback when no provider registers one", () => {
    const html = render({}, { message: false });
    expect(html).toContain('data-line="stopped"');
  });
});
