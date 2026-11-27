// @vitest-environment happy-dom
/** A nested FlowProvider merges the `data` renderer slot, as it does `component` and `container`. */
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { FlowProvider, useFlowContext } from "../src";

describe("nested FlowProvider data renderers", () => {
  it("keeps the parent's data renderers and adds the child's", () => {
    const Parent = () => null;
    const Child = () => null;
    let seen: Record<string, unknown> | undefined;
    const Probe = (): ReactNode => {
      seen = useFlowContext().renderers?.data;
      return null;
    };
    const inner = createElement(FlowProvider, { renderers: { data: { received: Child } }, children: createElement(Probe) });
    render(createElement(FlowProvider, { renderers: { data: { route: Parent } }, children: inner }));
    expect(seen).toEqual({ route: Parent, received: Child });
  });
});
