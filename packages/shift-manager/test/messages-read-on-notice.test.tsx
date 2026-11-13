// @vitest-environment happy-dom
/**
 * The message log reads on a change, not every 5 s: when the view opens,
 * again on a notice of a message under the user's scope (`workforce/messages`)
 * and on each Lab read (`readAt`), and on nothing else while push covers the
 * page. Wherever push can miss a change, the subscription keeps the old 5 s
 * pace. A failed later read keeps the last messages; only a failed first read
 * shows, and a Lab that declares no log (404) reads as none.
 *
 * The client's own live read rides a subscription the test drives.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHttpError, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";

type Opened = { topics: readonly WireTopic[]; pollIntervalMs?: number; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const subscribe = (topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void; pollIntervalMs?: number }) => {
  const entry: Opened = { topics, pollIntervalMs: options.pollIntervalMs, onChange: options.onChange, closed: false };
  opened.push(entry);
  return { close: () => void (entry.closed = true) };
};
const hear = (notice: WireNotice) => opened.filter((o) => !o.closed).forEach((o) => o.onChange(notice));

const message = (id: string, at: number) => ({
  id,
  exchange: id,
  from: "researcher",
  to: "coordinator",
  text: `line ${id}`,
  at,
  fromSession: "s_researcher",
  fromFlow: "agent",
  toSession: "s_coordinator",
  toFlow: "agent",
  hop: 1,
  status: "delivered",
});
let logged = [message("msg_1", 1)];
let failWith: Error | undefined;
let logReads = 0;
const client = {
  userId: "u_1",
  resource: () => ({
    list: async () => {
      logReads += 1;
      if (failWith !== undefined) throw failWith;
      return { items: logged.map((m) => ({ topic: m.id, storageKey: `workforce/messages/${m.id}`, value: m })) };
    },
  }),
  live: (topics: readonly WireTopic[], options: Parameters<typeof liveRead>[2]) => liveRead(subscribe as never, topics, options),
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

import { useMessages } from "../src/lib/messages";

type Shown = ReturnType<typeof useMessages>;
const shown: Shown[] = [];
function Probe({ readAt }: { readAt: number }) {
  shown.push(useMessages(readAt));
  return null;
}
const ids = () => shown.at(-1)?.rows?.map((m) => m.id);
const settle = () => new Promise((r) => setTimeout(r, 50));
const resource = (path: string): WireNotice => ({ topic: { scope: "user", resource: path }, kind: "resource" });

beforeEach(() => {
  opened.splice(0);
  shown.splice(0);
  logged = [message("msg_1", 1)];
  failWith = undefined;
  logReads = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the message log", () => {
  it("reads on open, then only on a notice of a message under the user's scope and on a Lab read; at the old pace where push can miss one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = render(<Probe readAt={1} />);
    await waitFor(() => expect(ids()).toEqual(["msg_1"]));

    // Push covers the page: nothing on a clock, and nothing for another resource of the user's.
    await vi.advanceTimersByTimeAsync(12_000);
    hear(resource("lab-pins"));
    hear(resource("workforce/workers/eng"));
    hear(resource("workforce/message-chains/c1"));
    await settle();
    expect(logReads).toBe(1);
    const sub = opened.find((o) => !o.closed);
    expect(sub?.topics).toEqual([{ scope: "user" }]);
    expect(sub?.pollIntervalMs).toBe(5_000);

    logged = [message("msg_1", 1), message("msg_2", 2)];
    hear(resource("workforce/messages/msg_2"));
    await waitFor(() => expect(ids()).toEqual(["msg_1", "msg_2"]));
    expect(logReads).toBe(2);

    view.rerender(<Probe readAt={2} />);
    await waitFor(() => expect(logReads).toBe(3));
  });

  it("keeps the last messages when a later read fails; only a failed first read shows", async () => {
    failWith = new Error("store offline");
    render(<Probe readAt={1} />);
    await waitFor(() => expect(shown.at(-1)?.failure).toBeDefined());
    expect(shown.at(-1)?.rows).toBeUndefined();

    failWith = undefined;
    hear(resource("workforce/messages/msg_1"));
    await waitFor(() => expect(ids()).toEqual(["msg_1"]));
    expect(shown.at(-1)?.failure).toBeUndefined();

    failWith = new Error("store offline");
    const before = logReads;
    hear(resource("workforce/messages/msg_1"));
    await waitFor(() => expect(logReads).toBe(before + 1));
    await settle();
    expect(ids()).toEqual(["msg_1"]);
    expect(shown.at(-1)?.failure).toBeUndefined();
  });

  it("reads as none, not a failure, where no flow of the Lab declares the log", async () => {
    failWith = new ClientHttpError("Request failed (404) Not Found", { status: 404, body: { error: "unknown_resource" } });
    render(<Probe readAt={1} />);
    await waitFor(() => expect(shown.at(-1)?.rows).toBeNull());
    expect(shown.at(-1)?.failure).toBeUndefined();
  });
});
