// @vitest-environment happy-dom
/**
 * `ScrollOnNewRequest` brings a new request into view. A conversation that
 * opens (its first load, or a switch to another session) lands at the bottom
 * at once: scrolling smoothly down from the top every time a session opened
 * was the bug. Only a request that follows one already on screen glides.
 *
 * Renders registry source, which imports shadcn helpers through `@/`; the
 * vitest config aliases those to Storybook's stubs.
 */
import { cleanup, render } from "@testing-library/react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { Conversation, ScrollOnNewRequest } from "../../registry/components/conversation";

const scrolls: (ScrollBehavior | undefined)[] = [];
const original = HTMLElement.prototype.scrollTo;
afterEach(() => {
  cleanup();
  scrolls.length = 0;
  HTMLElement.prototype.scrollTo = original;
});
function recordScrolls() {
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (this.getAttribute("role") === "log" && typeof options === "object") scrolls.push(options.behavior);
  } as typeof HTMLElement.prototype.scrollTo;
}

const item = (id: string, requestId: string) => ({ id, requestId, type: "message" }) as unknown as OutputItem;
const view = (items: OutputItem[]) => (
  <Conversation>
    <ScrollOnNewRequest items={items} />
  </Conversation>
);

describe("ScrollOnNewRequest", () => {
  it("lands a conversation's first load at the bottom at once", () => {
    recordScrolls();
    const { rerender } = render(view([]));
    rerender(view([item("a", "r1"), item("b", "r2")]));
    expect(scrolls).toEqual(["instant"]);
  });

  it("lands a switch to another session at the bottom at once", () => {
    recordScrolls();
    const { rerender } = render(view([item("a", "r1")]));
    rerender(view([item("x", "s1"), item("y", "s2")]));
    expect(scrolls).toEqual(["instant", "instant"]);
  });

  it("glides to a request that follows one already on screen", () => {
    recordScrolls();
    const { rerender } = render(view([item("a", "r1")]));
    rerender(view([item("a", "r1"), item("b", "r2")]));
    expect(scrolls).toEqual(["instant", "smooth"]);
  });
});
