// @vitest-environment happy-dom
/**
 * The shift summary says when its own reads last landed, never that it is
 * live (D1), and its refresh link and R read those again, and nothing else.
 *
 * The inbox view and the directory's reads are stood in for; the client's
 * `subscribe` is recorded, so a read the page started on its own would show.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireTopic } from "@flow-state-dev/client";
import { App } from "../src/App";
import { clockTime } from "../src/lib/shell";
import type { DirectoryFixture } from "./helpers/directory";

const USER = "u_test";

const subscribe = vi.fn((_topics: readonly WireTopic[]) => ({ close: () => {} }));
vi.mock("../src/lib/connection", () => ({
  connect: (connection: { userId: string }) => ({ userId: connection.userId, subscribe, live: () => ({ close: () => {}, refresh: () => {} }) }),
  readConnection: () => ({ userId: USER }),
}));
const workforce = { organization: async () => "acme", watchRoster: () => () => {} };
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
/** When the view's answer last landed, as `useInbox` says it, and its refresh. */
let viewReadAt = Date.UTC(2026, 10, 4, 14, 2);
const viewRefresh = vi.fn();
vi.mock("../src/lib/inbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/inbox")>();
  return { ...real, useInbox: () => ({ section: { ok: true, value: { items: [], tasks: [] } }, stale: false, refresh: viewRefresh, readAt: viewReadAt }) };
});
/** The directory the page draws: one good read, as one landed. */
const directory: DirectoryFixture = { sessions: [], inventory: { ok: true, value: { workers: [] } } };
vi.mock("../src/lib/directory-reads", async () => {
  const { useFixedReads } = await import("./helpers/directory");
  return { useDirectoryReads: () => useFixedReads(() => directory) };
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

beforeEach(() => {
  subscribe.mockClear();
  viewReadAt = Date.UTC(2026, 10, 4, 14, 2);
  viewRefresh.mockClear();
});
afterEach(() => cleanup());

describe("the summary's age and R", () => {
  async function openShiftCoordinator() {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://lab.local/");
    render(<App connection={{ userId: USER }} />);
    return screen.findByTestId("shift-coordinator-as-of");
  }

  it("says when the summary's own reads last landed, never that it is live (D1)", async () => {
    viewReadAt = Date.UTC(2026, 10, 4, 14, 7);
    const line = await openShiftCoordinator();
    expect(line.textContent).toBe(`as of ${clockTime(viewReadAt)} · refresh`);
    expect(line.textContent).not.toMatch(/live/i);
  });

  it("reads the summary's reads again from its refresh link and from R, and nothing else; not from R typed in a field", async () => {
    await openShiftCoordinator();
    await settle();
    const subscribed = subscribe.mock.calls.length;
    fireEvent.click(screen.getByTestId("shift-coordinator-as-of-refresh"));
    await settle();
    expect(viewRefresh).toHaveBeenCalledTimes(1);

    act(() => void fireEvent.keyDown(window, { key: "r" }));
    await settle();
    expect(viewRefresh).toHaveBeenCalledTimes(2);

    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => void fireEvent.keyDown(field, { key: "r" }));
    act(() => void fireEvent.keyDown(window, { key: "r", metaKey: true }));
    await settle();
    expect(viewRefresh).toHaveBeenCalledTimes(2);
    field.remove();
    // Nothing on the page opened a read of its own on the refresh or on R.
    expect(subscribe.mock.calls.length).toBe(subscribed);
  });
});
