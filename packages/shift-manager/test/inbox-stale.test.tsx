// @vitest-environment happy-dom
/**
 * A refresh of the inbox view that fails after a good read (FIX-2774). The
 * older list stays on screen, but "Nothing needs you" and the counts must not
 * read as current: the Inbox says the latest read failed, why, and offers
 * Retry, and the page's connection bar is told the Inbox has lapsed.
 *
 * `useView` is replaced by a stand-in whose answer each step sets.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionFeedStatus } from "../src/components/flow-state/connection-banner";
import { GAPS } from "../src/gaps";
import { FeedHealthContext } from "../src/lib/feed-health";
import type { LoadedSnapshot } from "../src/lib/derive";
import { Inbox } from "../src/surfaces/Inbox";

type Read = { value?: unknown; stale: boolean; failure?: { message: string; httpStatus?: number }; refresh: () => void };
const refresh = vi.fn();
let read: Read = { stale: false, refresh };

vi.mock("@flow-state-dev/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/react")>()),
  useView: () => read,
}));
vi.mock("../src/lib/lab-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/lab-data")>()),
  useLab: () => ({ client: {} }),
}));

afterEach(cleanup);

const EMPTY = { items: [], tasks: [] };

describe("an Inbox whose refresh failed after a good read", () => {
  it("keeps the older list, says the latest read failed and why, offers Retry, and tells the connection bar it lapsed", async () => {
    const reported: Array<ConnectionFeedStatus | null> = [];
    const report = (_key: string, state: ConnectionFeedStatus | null) => void reported.push(state);
    const screenOf = () => (
      <FeedHealthContext.Provider value={report}>
        <Inbox snapshot={{} as LoadedSnapshot} itemId={null} gaps={GAPS} />
      </FeedHealthContext.Provider>
    );

    read = { value: EMPTY, stale: false, refresh };
    const view = render(screenOf());
    expect(screen.getByTestId("inbox-empty").textContent).toMatch(/^Nothing needs you\./);
    expect(screen.queryByTestId("inbox-stale")).toBeNull();
    expect(reported.at(-1)).toBe("live");

    read = { value: EMPTY, stale: true, failure: { message: "The Lab could not read your sessions.", httpStatus: 503 }, refresh };
    view.rerender(screenOf());
    // The older answer is still drawn, with the reason beside it.
    expect(screen.getByTestId("inbox-empty")).toBeTruthy();
    const stale = screen.getByTestId("inbox-stale");
    expect(stale.textContent).toContain("The Lab could not read your sessions. (503)");
    expect(reported.at(-1)).toBe("lapsed");
    await act(async () => screen.getByRole("button", { name: "Retry" }).click());
    expect(refresh).toHaveBeenCalledTimes(1);

    // Once a read lands again, the notice goes and the bar hears the Inbox is live.
    read = { value: EMPTY, stale: false, refresh };
    view.rerender(screenOf());
    expect(screen.queryByTestId("inbox-stale")).toBeNull();
    expect(reported.at(-1)).toBe("live");
  });
});
