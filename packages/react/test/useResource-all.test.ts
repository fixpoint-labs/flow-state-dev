// @vitest-environment happy-dom
// FIX-2775 D2.
/**
 * `useResource(def, { all: true })`: a whole user or org collection, every
 * page of it, kept current. What matters to a screen: no row past the first
 * page goes missing, a change notice that names entries costs just those
 * entries' reads (an append-only log never re-lists for a new message), the
 * list is read whole only when the notice can't be placed, and a read that
 * fails says why in `useView`'s own words.
 *
 * The hook reads through the real client (`createClient`) over a fetcher that
 * serves the entries route as the engine does: storage-key order, cursor
 * pages of at most `limit`, `topicPrefix` as a storage-key prefix. Only the
 * push channel is faked, so a test hands the hook its notices.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createClient, type ClientFetch, type SubscribeOptions, type WireNotice, type WireTopic } from "@flow-state-dev/client";
import { useResource } from "../src";

type Value = { name: string };
type Stored = { value: Value; version: number };

const BASE = "/api/flows/resources/org/projects%2F*";
const projects = { scope: "org" as const, pattern: "projects/*", ClientType: { name: "" } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** `n` entries, `projects/e000` onward. */
const many = (n: number): Map<string, Stored> =>
  new Map(Array.from({ length: n }, (_, i) => [`projects/e${String(i).padStart(3, "0")}`, { value: { name: `E${i}` }, version: 1 }]));

/**
 * A server holding one org collection, keyed by storage key, and a client
 * over it whose push channel the test drives. `repeatCursor` hands back the
 * same cursor forever, a transport bug `listAll()` stops on.
 */
function lab(stored: Map<string, Stored>, options: { repeatCursor?: boolean; failEntry?: boolean } = {}) {
  const lists: string[] = [];
  const entryReads: string[] = [];
  const fetcher = vi.fn<ClientFetch>(async (input) => {
    const url = new URL(String(input), "http://x");
    const shaped = (storageKey: string, entry: Stored) => ({ topic: storageKey.slice("projects/".length), storageKey, ...entry });
    if (url.pathname === `${BASE}/entries`) {
      lists.push(url.search);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const cursor = url.searchParams.get("cursor");
      const prefix = url.searchParams.get("topicPrefix");
      const after = [...stored.keys()]
        .sort()
        .filter((key) => prefix === null || key.startsWith(prefix))
        .filter((key) => cursor === null || options.repeatCursor === true || key > cursor);
      const page = after.slice(0, limit);
      const nextCursor = after.length > limit ? page.at(-1) : undefined;
      return json({ items: page.map((key) => shaped(key, stored.get(key)!)), ...(nextCursor === undefined ? {} : { nextCursor }) });
    }
    const one = /\/entries\/(.+)$/.exec(url.pathname);
    if (one !== null) {
      const key = decodeURIComponent(one[1]!);
      entryReads.push(key);
      if (options.failEntry === true) return json({ error: "entry_unavailable", message: "entry read failed" }, 500);
      const found = stored.get(key);
      return json(found === undefined ? null : shaped(key, found));
    }
    throw new Error(`unrouted ${url.pathname}`);
  });
  const real = createClient({ userId: "alice", baseUrl: "", fetcher });
  const subscriptions: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions }> = [];
  const client = {
    resource: real.resource.bind(real) as typeof real.resource,
    subscribe: (topics: readonly WireTopic[], subscribeOptions: SubscribeOptions) => {
      subscriptions.push({ topics, options: subscribeOptions });
      return { close() {} };
    }
  };
  /** Hand every subscription the hook opened a notice, as the push channel would. */
  const hear = async (notice: WireNotice | null) => {
    await act(async () => {
      for (const { options: heard } of subscriptions) heard.onChange(notice);
    });
  };
  return { client, lists, entryReads, subscriptions, hear };
}

const keys = (entries: readonly { storageKey: string }[] | null) => (entries ?? []).map((entry) => entry.storageKey);

describe("useResource(def, { all: true })", () => {
  it("reads every page of a 450-entry collection, not the first 200", async () => {
    const stored = many(450);
    const { client } = lab(stored);
    const { result } = renderHook(() => useResource(projects, { all: true, client }));
    await waitFor(() => expect(result.current.value).toHaveLength(450));
    expect(keys(result.current.value)).toEqual([...stored.keys()].sort());
  });

  const named = (...ids: string[]): WireNotice => ({ topic: { scope: "org", resource: ids[0] }, kind: "resource", ids });

  it("reads just the entries a notice names, held or new, and places a new one in storage-key order without re-listing", async () => {
    const stored = many(450);
    const { client, lists, entryReads, hear } = lab(stored);
    const { result } = renderHook(() => useResource(projects, { all: true, client }));
    await waitFor(() => expect(result.current.value).toHaveLength(450));
    const listed = lists.length;

    // A held entry changes: one entry read.
    stored.set("projects/e300", { value: { name: "E300 renamed" }, version: 2 });
    await hear(named("projects/e300"));
    await waitFor(() => expect(result.current.value?.find((e) => e.storageKey === "projects/e300")?.value).toEqual({ name: "E300 renamed" }));

    // A new entry lands past the first page (an appended message): one entry read, never a list.
    stored.set("projects/e449a", { value: { name: "new" }, version: 1 });
    await hear(named("projects/e449a"));
    await waitFor(() => expect(result.current.value).toHaveLength(451));

    expect(entryReads).toEqual(["projects/e300", "projects/e449a"]);
    expect(lists).toHaveLength(listed);
    // What the merges left is what reading the collection whole would show.
    expect(result.current.value).toEqual(
      [...stored.keys()].sort().map((storageKey) => ({ topic: storageKey.slice("projects/".length), storageKey, ...stored.get(storageKey)! }))
    );
  });

  it("drops a named entry that is gone without re-listing, though more than a page is held", async () => {
    // The first-page rule (a full page re-lists so the next entry moves in) has nothing to bring in here.
    const stored = many(450);
    const { client, lists, hear } = lab(stored);
    const { result } = renderHook(() => useResource(projects, { all: true, client }));
    await waitFor(() => expect(result.current.value).toHaveLength(450));
    const listed = lists.length;
    stored.delete("projects/e005");
    await hear(named("projects/e005"));
    await waitFor(() => expect(result.current.value).toHaveLength(449));
    expect(keys(result.current.value)).toEqual([...stored.keys()].sort());
    expect(lists).toHaveLength(listed);
  });

  it("re-lists whole on a notice with no ids, a gap, or a named entry whose read failed, and shows no failure", async () => {
    const stored = many(450);
    const server = lab(stored, { failEntry: true });
    const { result } = renderHook(() => useResource(projects, { all: true, client: server.client }));
    await waitFor(() => expect(result.current.value).toHaveLength(450));
    const pagesPerList = server.lists.length;

    stored.set("projects/e010", { value: { name: "changed" }, version: 2 });
    await server.hear(named("projects/e010"));
    await waitFor(() => expect(server.lists).toHaveLength(2 * pagesPerList));
    await waitFor(() => expect(result.current.value?.[10]?.value).toEqual({ name: "changed" }));
    expect(server.entryReads).toEqual(["projects/e010"]);
    expect(result.current.stale).toBe(false);

    stored.set("projects/e500", { value: { name: "late" }, version: 1 });
    await server.hear({ topic: { scope: "org", resource: "projects" }, kind: "resource" });
    await waitFor(() => expect(result.current.value).toHaveLength(451));
    await server.hear({ topic: { scope: "org" }, kind: "resync" } as WireNotice);
    await waitFor(() => expect(server.lists).toHaveLength(4 * pagesPerList));
    expect(server.entryReads).toEqual(["projects/e010"]);
  });

  it("says why a read stopped: a repeated cursor's own readable message, and not part of the list as all of it", async () => {
    const { client } = lab(many(450), { repeatCursor: true });
    const { result } = renderHook(() => useResource(projects, { all: true, client }));
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.failure).toEqual({
      message: "Stopped because the server returned the same page cursor twice, rather than show part of the list as all of it."
    });
    expect(result.current.value).toBeNull();
  });
});

describe("useResource(def, { all: true, topicPrefix })", () => {
  const named = (...ids: string[]): WireNotice => ({ topic: { scope: "org", resource: ids[0] }, kind: "resource", ids });
  const entry = (name: string): Stored => ({ value: { name }, version: 1 });

  it("holds only the entries under the prefix, and hears only notices that may touch them", async () => {
    // One project's entries beside another's, as a project's workstreams sit beside the next project's.
    const stored = new Map([
      ["projects/p1/a", entry("p1a")],
      ["projects/p1/b", entry("p1b")],
      ["projects/p2/a", entry("p2a")]
    ]);
    const { client, lists, entryReads, hear } = lab(stored);
    const { result } = renderHook(() => useResource(projects, { all: true, topicPrefix: "projects/p1/", client }));
    await waitFor(() => expect(keys(result.current.value)).toEqual(["projects/p1/a", "projects/p1/b"]));
    const listed = lists.length;

    // The other project changes: nothing is read.
    stored.set("projects/p2/a", { value: { name: "p2a renamed" }, version: 2 });
    await hear(named("projects/p2/a"));
    // A change under the other project that names no entry would read the list whole, if heard.
    await hear({ topic: { scope: "org", resource: "projects/p2" }, kind: "resource" });
    // This project gains an entry, in a notice that also names the other's: only this one's is merged.
    stored.set("projects/p1/c", entry("p1c"));
    stored.set("projects/p2/b", entry("p2b"));
    await hear(named("projects/p1/c", "projects/p2/b"));
    await waitFor(() => expect(keys(result.current.value)).toEqual(["projects/p1/a", "projects/p1/b", "projects/p1/c"]));
    expect(entryReads).toEqual(["projects/p1/c"]);
    expect(lists).toHaveLength(listed);
  });
});

describe("useResource's failure and refresh()", () => {
  it("gives a refused read the server's words and status, as useView does, and refresh() reads again and clears it", async () => {
    let refuse = true;
    const fetcher = vi.fn<ClientFetch>(async () =>
      refuse
        ? json({ error: "not_readable", message: "State read not permitted for \"pins\"" }, 403)
        : json({ value: { pinned: ["a"] }, version: 1 })
    );
    const real = createClient({ userId: "alice", baseUrl: "", fetcher });
    const client = { resource: real.resource.bind(real) as typeof real.resource, subscribe: () => ({ close() {} }) };
    const pins = { scope: "user" as const, ref: "pins", ClientType: { pinned: [] as string[] } };
    const { result } = renderHook(() => useResource(pins, { client, pollIntervalMs: 60_000 }));
    await waitFor(() => expect(result.current.failure).toEqual({ message: "not_readable", httpStatus: 403 }));
    expect(result.current.stale).toBe(true);

    refuse = false;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.value).toEqual({ pinned: ["a"] }));
    expect(result.current.stale).toBe(false);
    expect(result.current.failure).toBeUndefined();
  });
});

describe("useResource on a single resource, given the collection options", () => {
  it("still hears its own path: `all` and `topicPrefix` narrow nothing for a single resource", async () => {
    const pins = { scope: "org" as const, ref: "pins", ClientType: { name: "" } };
    let reads = 0;
    const fetcher = vi.fn<ClientFetch>(async (input) => {
      if (new URL(String(input), "http://x").pathname !== "/api/flows/resources/org/pins") throw new Error(`unrouted ${String(input)}`);
      reads += 1;
      return json({ value: { name: `read ${reads}` }, version: reads });
    });
    const real = createClient({ userId: "alice", baseUrl: "", fetcher });
    const heard: SubscribeOptions[] = [];
    const client = {
      resource: real.resource.bind(real) as typeof real.resource,
      subscribe: (_topics: readonly WireTopic[], options: SubscribeOptions) => {
        heard.push(options);
        return { close() {} };
      }
    };
    renderHook(() => useResource(pins, { all: true, topicPrefix: "projects/p1/", client }));
    await waitFor(() => expect(reads).toBe(1));
    // A change to `pins` itself: the resource reads again.
    await act(async () => {
      for (const options of heard) options.onChange({ topic: { scope: "org", resource: "pins" }, kind: "resource" } as WireNotice);
    });
    await waitFor(() => expect(reads).toBe(2));
  });
});
