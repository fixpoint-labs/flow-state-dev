// @vitest-environment happy-dom
/**
 * The message log reads on a change, not on a clock (FIX-2775): its newest page
 * when the view opens through react's `useResource` (FIX-2845), and then only on
 * a notice of a message under the user's scope (`workforce/messages`). A notice
 * that names a new message reads that one entry, never the page again; one that
 * names none reads the newest page again. The log is never read whole, and
 * nothing reads it on a Lab read. A failed later read
 * keeps the last messages; only a failed first read shows, and a Lab that
 * declares no log (404) reads as none.
 *
 * The client's direct read and its subscription are the test's.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHttpError, type WireNotice, type WireTopic } from "@flow-state-dev/client";

type Opened = { topics: readonly WireTopic[]; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const subscribe = (topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void }) => {
  const entry: Opened = { topics, onChange: options.onChange, closed: false };
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
const keyOf = (id: string) => `workforce/messages/${id}`;
let logged = [message("msg_1", 1)];
let failWith: Error | undefined;
let logReads = 0;
const entryReads: string[] = [];
const handle = {
  scope: "user",
  key: "workforce/messages/*",
  // The newest page: the only list read the log makes.
  list: async (options: { order?: string }) => {
    logReads += 1;
    if (options.order !== "newest") throw new Error(`the log lists its newest page, not ${JSON.stringify(options)}`);
    if (failWith !== undefined) throw failWith;
    const ranked = [...logged].sort((a, b) => b.at - a.at);
    return { items: ranked.map((m) => ({ topic: m.id, storageKey: keyOf(m.id), value: m, version: 1 })) };
  },
  listAll: async () => {
    throw new Error("the log is never read whole");
  },
  entry: (storageKey: string) => ({
    read: async () => {
      entryReads.push(storageKey);
      if (failWith !== undefined) throw failWith;
      const found = logged.find((m) => keyOf(m.id) === storageKey);
      return { value: found ?? null, version: 1 };
    },
  }),
};
const client = { userId: "u_1", resource: () => handle, subscribe };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

import { useMessages } from "../src/lib/messages";

type Shown = ReturnType<typeof useMessages>;
const shown: Shown[] = [];
function Probe() {
  shown.push(useMessages());
  return null;
}
const ids = () => shown.at(-1)?.rows?.map((m) => m.id);
const settle = () => new Promise((r) => setTimeout(r, 50));
const resource = (path: string, named?: string[]): WireNotice => ({ topic: { scope: "user", resource: path }, kind: "resource", ...(named === undefined ? {} : { ids: named }) });

beforeEach(() => {
  opened.splice(0);
  shown.splice(0);
  logged = [message("msg_1", 1)];
  failWith = undefined;
  logReads = 0;
  entryReads.splice(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the message log", () => {
  it("reads whole on open, then only on a notice under the user's messages: a new message is one entry read", async () => {
    render(<Probe />);
    await waitFor(() => expect(ids()).toEqual(["msg_1"]));
    const sub = opened.find((o) => !o.closed);
    expect(sub?.topics).toEqual([{ scope: "user" }]);

    // Another resource of the user's: nothing is read.
    hear(resource("lab-pins"));
    hear(resource("workforce/workers/eng"));
    hear(resource("workforce/message-chains/c1"));
    await settle();
    expect(logReads).toBe(1);
    expect(entryReads).toEqual([]);

    // A new message, named: that one entry is read and placed, and the log isn't listed again.
    logged = [message("msg_1", 1), message("msg_2", 2)];
    hear(resource("workforce/messages", [keyOf("msg_2")]));
    await waitFor(() => expect(ids()).toEqual(["msg_2", "msg_1"]));
    expect(entryReads).toEqual([keyOf("msg_2")]);
    expect(logReads).toBe(1);

    // A notice that names nothing under the log reads the newest page again.
    logged = [...logged, message("msg_3", 3)];
    hear(resource("workforce/messages"));
    await waitFor(() => expect(ids()).toEqual(["msg_3", "msg_2", "msg_1"]));
    expect(logReads).toBe(2);
  });

  it("keeps the last messages when a later read fails; only a failed first read shows", async () => {
    failWith = new Error("store offline");
    render(<Probe />);
    await waitFor(() => expect(shown.at(-1)?.failure).toBeDefined());
    expect(shown.at(-1)?.rows).toBeUndefined();

    failWith = undefined;
    hear(resource("workforce/messages"));
    await waitFor(() => expect(ids()).toEqual(["msg_1"]));
    expect(shown.at(-1)?.failure).toBeUndefined();

    failWith = new Error("store offline");
    const before = logReads;
    hear(resource("workforce/messages"));
    await waitFor(() => expect(logReads).toBe(before + 1));
    await settle();
    expect(ids()).toEqual(["msg_1"]);
    expect(shown.at(-1)?.failure).toBeUndefined();
  });

  it("reads as none, not a failure, where no flow of the Lab declares the log", async () => {
    failWith = new ClientHttpError("Request failed (404) Not Found", { status: 404, body: { error: "unknown_resource" } });
    render(<Probe />);
    await waitFor(() => expect(shown.at(-1)?.rows).toBeNull());
    expect(shown.at(-1)?.failure).toBeUndefined();
  });
});
