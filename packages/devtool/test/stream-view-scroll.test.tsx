/**
 * The stream view opens on a session's newest request, already there: a
 * session's history arriving in an empty view lands at the end with no
 * animation, rather than scrolling down from the top every time a session is
 * opened. After that, what arrives never moves the view, even at the end, since
 * the reader may be reading: a jump-to-latest arrow offers it instead. An
 * action the person sends rises to near the top, so its reply streams in below
 * it, in view.
 */
import { afterEach, describe, it, expect } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import React from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

import { StreamView, type RequestGroup } from "../src/react/components/workspace/stream-view";
import { DebugProvider } from "../src/react/context/debug-context";
import { SelectionProvider } from "../src/react/context/selection-context";

function view(requestGroups: RequestGroup[], sends?: number) {
  return (
    <DebugProvider>
      <SelectionProvider>
        <StreamView requestGroups={requestGroups} streamStatus="completed" sends={sends} />
      </SelectionProvider>
    </DebugProvider>
  );
}

/** One request holding one item the stream view draws. */
function group(n: number): RequestGroup {
  const requestId = `req-${n}`;
  const item = {
    id: `cont-${n}`,
    type: "continuation",
    status: "completed",
    requestId,
    itemIndex: 0,
    ts: n,
    trigger: "recovery",
    priorItemCount: 0,
    continuedAt: n,
  } as unknown as OutputItem;
  return { requestId, action: "sendMessage", status: "completed", startedAt: n, items: [item] as any };
}

const saved = ["scrollHeight", "clientHeight", "scrollTop", "scrollTo", "getBoundingClientRect"].map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
);
afterEach(() => {
  for (const [name, was] of saved) {
    if (was === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    else Object.defineProperty(HTMLElement.prototype, name, was);
  }
});

/**
 * Lay the stream's scrolling column out as a browser would (happy-dom lays nothing out):
 * 200px per request in a 500px view (the jump-to-latest arrow takes none). Every scroll it is asked
 * for is recorded, and lands at once.
 */
function layOut() {
  const isStream = (el: HTMLElement) => el.classList.contains("overflow-auto") && el.classList.contains("bg-fs-surface");
  const tops = new WeakMap<HTMLElement, number>();
  const requests = (el: HTMLElement) => [...el.children].filter((child) => !child.classList.contains("sticky")) as HTMLElement[];
  // The space the stream keeps under a request just sent is its bottom padding.
  const height = (el: HTMLElement) => requests(el).length * 200 + (Number.parseFloat(el.style.paddingBottom) || 0);
  const scrolls: (ScrollBehavior | undefined)[] = [];
  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isStream(this) ? height(this) : 0; } },
    clientHeight: { configurable: true, get(this: HTMLElement) { return isStream(this) ? 500 : 0; } },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return tops.get(this) ?? 0; },
      set(this: HTMLElement, value: number) {
        tops.set(this, isStream(this) ? Math.max(0, Math.min(value, height(this) - 500)) : 0);
      },
    },
    // A request's box: 200px tall, stacked, moved up by the stream's scroll. The stream's own top is 0.
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        const parent = this.parentElement;
        const top = parent !== null && isStream(parent) ? requests(parent).indexOf(this) * 200 - parent.scrollTop : 0;
        return { top, bottom: top + 200, left: 0, right: 0, width: 0, height: 200, x: 0, y: top, toJSON: () => ({}) };
      },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (isStream(this)) scrolls.push(options.behavior);
        this.scrollTop = options.top ?? 0;
      },
    },
  });
  return scrolls;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const stream = (container: HTMLElement) => container.querySelector<HTMLElement>(".overflow-auto.bg-fs-surface")!;

describe("StreamView — where it opens, and how it follows", () => {
  it("lands a session's history at its newest request at once, with no scroll to watch", async () => {
    const scrolls = layOut();
    const groups = Array.from({ length: 20 }, (_, i) => group(i));
    // Empty while the session's requests are read, then all of them at once.
    const { container, rerender } = render(view([]));
    rerender(view(groups));
    await settle();
    expect(stream(container).scrollTop).toBe(20 * 200 - 500);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.filter((s) => s !== "instant")).toEqual([]);
  });

  it("leaves the stream where it is when a request arrives, even at the end, and offers the jump to it", async () => {
    const scrolls = layOut();
    const groups = Array.from({ length: 20 }, (_, i) => group(i));
    const { container, rerender } = render(view(groups));
    await settle();
    await nextFrame();
    const el = stream(container);
    expect(within(el).queryByRole("button", { name: "Jump to latest" })).toBeNull();
    scrolls.length = 0;
    rerender(view([...groups, group(20)]));
    await settle();
    expect(scrolls).toEqual([]);
    expect(el.scrollTop).toBe(20 * 200 - 500);

    // The arrow for what arrived below is the hook's own test (useJumpToLatest.test.ts). Here the
    // reader moves up a little, which shows it without leaning on happy-dom's MutationObserver:
    // it holds its record callback in a WeakRef, so a collection mid-test can silence it.
    act(() => {
      el.scrollTop = 20 * 200 - 600;
      el.dispatchEvent(new Event("scroll"));
    });
    fireEvent.click(within(el).getByRole("button", { name: "Jump to latest" }));
    expect(scrolls).toEqual(["smooth"]);
    expect(el.scrollTop).toBe(21 * 200 - 500);
    expect(within(el).queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("brings an action the person sends near the top, from wherever they had scrolled to", async () => {
    const scrolls = layOut();
    const groups = Array.from({ length: 20 }, (_, i) => group(i));
    const { container, rerender } = render(view(groups, 0));
    await settle();
    await nextFrame();
    const el = stream(container);
    el.scrollTop = 400;
    el.dispatchEvent(new Event("scroll"));
    scrolls.length = 0;
    // The request lands in the same render as the send is counted: it is the one that rises.
    rerender(view([...groups, group(20)], 1));
    await settle();
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every((s) => s === "smooth")).toBe(true);
    const top = el.querySelector(`[data-sent-line="req-20"]`)!.getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(48);
  });

  it("brings up the request the person sent when it lands after the send is counted", async () => {
    layOut();
    const groups = Array.from({ length: 20 }, (_, i) => group(i));
    const { container, rerender } = render(view(groups, 0));
    await settle();
    await nextFrame();
    const el = stream(container);
    rerender(view(groups, 1));
    await settle();
    expect(el.scrollTop).toBe(20 * 200 - 500);
    rerender(view([...groups, group(20)], 1));
    await settle();
    const top = el.querySelector(`[data-sent-line="req-20"]`)!.getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(48);
  });

  it("brings up the first request sent into an empty session, with space kept under it for the reply", async () => {
    layOut();
    // The panel counts the send before the request exists: the stream is still its empty state then.
    const { container, rerender } = render(view([], 0));
    rerender(view([], 1));
    rerender(view([group(0)], 1));
    await settle();
    await nextFrame();
    const el = stream(container);
    const top = el.querySelector(`[data-sent-line="req-0"]`)!.getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(48);
    expect(Number.parseFloat(el.style.paddingBottom) || 0).toBeGreaterThan(0);
  });
});
