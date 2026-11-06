// @vitest-environment happy-dom
/**
 * The registry Conversation scrolls by `useJumpToLatest`'s rule, through the
 * feed it carries to its children. The rule's behaviour in a real layout is the
 * goal's (`goals/conversation-scroll/sent-line-rises-reply-stays`, the
 * `registry/*` surfaces); these pin the wiring a layout can't show:
 *
 * - the person's line is marked by their message's id, and only inside a
 *   Conversation, so `feed.sent()` has a line to raise and a view with no feed
 *   raises nothing;
 * - the last request group keeps no room of its own (the hook keeps the room);
 * - the jump button reads the feed it is given or the Conversation's, and
 *   shows only while there is more below.
 *
 * Renders registry source, which imports shadcn helpers through `@/`; the
 * vitest config aliases those to Storybook's stubs.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JumpToLatest } from "@flow-state-dev/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Conversation, ConversationScrollButton } from "../../registry/components/conversation";
import { RequestGroupRenderer } from "../../registry/components/request-group";
import { messageItem } from "../../stories/fixtures/items";

afterEach(cleanup);

const turn = (requestId: string) => [
  messageItem({ id: `${requestId}-user`, role: "user", text: `asked in ${requestId}`, requestId }),
  messageItem({ id: `${requestId}-reply`, role: "assistant", text: `answered in ${requestId}`, requestId }),
];

const marks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-sent-line]")).map((el) => el.getAttribute("data-sent-line"));

/** A feed the test controls, with the real hook's `mine`. */
function fakeFeed(atEnd: boolean): JumpToLatest {
  return { ref: vi.fn(), atEnd, jump: vi.fn(), sent: vi.fn(), mine: (key) => ({ "data-sent-line": key }) };
}

describe("the person's line, inside a Conversation", () => {
  it("is the segment holding their message, named by that message's id", () => {
    const { container } = render(
      <Conversation>
        <RequestGroupRenderer items={[...turn("r1"), ...turn("r2")]} isStreaming={false} />
      </Conversation>,
    );
    expect(marks(container)).toEqual(["r1-user", "r2-user"]);
    // The mark is on the segment, so the line that rises is the person's message and what follows it.
    expect(container.querySelector('[data-sent-line="r2-user"]')?.getAttribute("data-request-id")).toBe("r2");
  });

  it("is not marked on a segment with no message of theirs", () => {
    const agentOnly = [messageItem({ id: "x-reply", role: "assistant", text: "a scheduled run", requestId: "x" })];
    const { container } = render(
      <Conversation>
        <RequestGroupRenderer items={[...turn("r1"), ...agentOnly]} isStreaming={false} />
      </Conversation>,
    );
    expect(marks(container)).toEqual(["r1-user"]);
  });

  it("is not marked outside a Conversation", () => {
    const { container } = render(<RequestGroupRenderer items={turn("r1")} isStreaming={false} />);
    expect(marks(container)).toEqual([]);
  });

  it("uses the app's feed when one is passed, and attaches it to the scrolling element", () => {
    const feed = fakeFeed(true);
    const mine = vi.spyOn(feed, "mine");
    render(
      <Conversation feed={feed}>
        <RequestGroupRenderer items={turn("r1")} isStreaming={false} />
      </Conversation>,
    );
    expect(mine).toHaveBeenCalledWith("r1-user");
    expect(feed.ref).toHaveBeenCalledWith(screen.getByRole("log"));
  });
});

describe("the last request group", () => {
  it("keeps no room of its own below the reply", () => {
    const { container } = render(
      <Conversation>
        <RequestGroupRenderer items={[...turn("r1"), ...turn("r2")]} isStreaming />
      </Conversation>,
    );
    for (const group of Array.from(container.querySelectorAll<HTMLElement>("[data-request-id]"))) {
      expect(group.style.minHeight).toBe("");
    }
  });
});

describe("ConversationScrollButton", () => {
  it("shows while there is more below, and jumps the feed it was given", () => {
    const feed = fakeFeed(false);
    render(<ConversationScrollButton feed={feed} />);
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(feed.jump).toHaveBeenCalledOnce();
  });

  it("is not drawn at the end", () => {
    render(<ConversationScrollButton feed={fakeFeed(true)} />);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("reads the Conversation's feed when it is given none", () => {
    const feed = fakeFeed(false);
    render(
      <Conversation feed={feed}>
        <ConversationScrollButton />
      </Conversation>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(feed.jump).toHaveBeenCalledOnce();
  });

  it("takes no height when it shows, so showing it never moves the feed", () => {
    render(<ConversationScrollButton feed={fakeFeed(false)} />);
    const wrapper = screen.getByRole("button", { name: "Jump to latest" }).parentElement!;
    expect(wrapper.className.split(/\s+/)).toContain("h-0");
  });
});
