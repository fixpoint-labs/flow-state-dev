// @vitest-environment happy-dom
// FIX-2775 D2.
/**
 * `useResource(def, { all: true })`: a whole user or org collection, every
 * page of it, kept current. What matters to a screen: no row past the first
 * page goes missing, a change notice that names entries costs just those
 * entries' reads (an append-only log never re-lists for a new message), a
 * gap diffs the manifest and reads only what changed, and a read that fails
 * says why in `useView`'s own words.
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

type Value = { name: string; at?: number };
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
function lab(stored: Map<string, Stored>, options: { repeatCursor?: boolean; failEntryReads?: number } = {}) {
  const lists: string[] = [];
  const entryReads: string[] = [];
  let entryFailuresLeft = options.failEntryReads ?? 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetcher = vi.fn<ClientFetch>(async (input) => {
    const url = new URL(String(input), "http://x");
    const shaped = (storageKey: string, entry: Stored) => ({ topic: storageKey.slice("projects/".length), storageKey, ...entry });
    if (url.pathname === `${BASE}/entries`) {
      lists.push(url.search);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const cursor = url.searchParams.get("cursor");
      const prefix = url.searchParams.get("topicPrefix");
      const manifest = url.searchParams.get("manifest") === "1";
      const newest = url.searchParams.get("order") === "newest";
      const stamp = (key: string) => stored.get(key)?.value.at;
      const ranked = [...stored.keys()]
        .filter((key) => prefix === null || key.startsWith(prefix))
        .sort((a, b) => {
          if (!newest) return a < b ? -1 : a > b ? 1 : 0;
          const left = stamp(a);
          const right = stamp(b);
          if (left !== undefined && right !== undefined && left !== right) return right - left;
          if (left !== undefined && right === undefined) return -1;
          if (left === undefined && right !== undefined) return 1;
          return a < b ? -1 : a > b ? 1 : 0;
        });
      const after = newest
        ? ranked.filter((key) => {
            if (cursor === null || options.repeatCursor === true) return true;
            const mark = JSON.parse(cursor) as [number | null, string];
            const at = stamp(key);
            if (mark[0] !== null && at !== undefined) return at < mark[0] || (at === mark[0] && key > mark[1]);
            if (mark[0] !== null && at === undefined) return true;
            if (mark[0] === null && at !== undefined) return false;
            return key > mark[1];
          })
        : ranked.filter((key) => cursor === null || options.repeatCursor === true || key > cursor);
      const page = after.slice(0, limit);
      const lastKey = page.at(-1);
      const nextCursor =
        after.length > limit && lastKey !== undefined
          ? newest
            ? JSON.stringify([stamp(lastKey) ?? null, lastKey])
            : lastKey
          : undefined;
      const items = page.map((key) => {
        const entry = stored.get(key)!;
        return manifest ? { storageKey: key, version: entry.version } : shaped(key, entry);
      });
      return json({ items, ...(nextCursor === undefined ? {} : { nextCursor }) });
    }
    const one = /\/entries\/(.+)$/.exec(url.pathname);
    if (one !== null) {
      const key = decodeURIComponent(one[1]!);
      entryReads.push(key);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (entryFailuresLeft > 0) {
        entryFailuresLeft -= 1;
        return json({ error: "entry_unavailable", message: "entry read failed" }, 500);
      }
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
  return { client, lists, entryReads, subscriptions, hear, maxInFlight: () => maxInFlight };
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

  it("on a gap, a notice with no ids, or a failed entry read, diffs the manifest and does not listAll, even past 450 entries", async () => {
    const stored = many(450);
    // The named read fails once. The resync that follows reads that entry again, and it answers.
    const server = lab(stored, { failEntryReads: 1 });
    const { result } = renderHook(() => useResource(projects, { all: true, client: server.client }));
    await waitFor(() => expect(result.current.value).toHaveLength(450));
    const valueLists = () => server.lists.filter((search) => !search.includes("manifest=1"));
    const manifestLists = () => server.lists.filter((search) => search.includes("manifest=1"));
    const pages = valueLists().length;
    expect(pages).toBeGreaterThan(1);

    stored.set("projects/e010", { value: { name: "changed" }, version: 2 });
    await server.hear(named("projects/e010"));
    await waitFor(() => expect(result.current.value?.find((entry) => entry.storageKey === "projects/e010")?.value).toEqual({ name: "changed" }));
    expect(valueLists()).toHaveLength(pages);
    expect(manifestLists().length).toBeGreaterThan(0);
    // The failed read, then the one read the diff asked for. Nothing else moved.
    expect(server.entryReads).toEqual(["projects/e010", "projects/e010"]);
    expect(result.current.stale).toBe(false);

    stored.set("projects/e500", { value: { name: "late" }, version: 1 });
    stored.delete("projects/e000");
    await server.hear({ topic: { scope: "org", resource: "projects" }, kind: "resource" });
    await waitFor(() => expect(result.current.value).toHaveLength(450));
    expect(result.current.value?.some((entry) => entry.storageKey === "projects/e000")).toBe(false);
    expect(result.current.value?.some((entry) => entry.storageKey === "projects/e500")).toBe(true);

    const readsBeforeGap = server.entryReads.length;
    const manifestsBeforeGap = manifestLists().length;
    await server.hear({ topic: { scope: "org" }, kind: "resync" } as WireNotice);
    await waitFor(() => expect(manifestLists().length).toBeGreaterThan(manifestsBeforeGap));
    // A gap where nothing changed reads the manifest and no entry.
    expect(server.entryReads).toHaveLength(readsBeforeGap);
    expect(valueLists()).toHaveLength(pages);
  });

  it("reads the entries a gap finds changed a few at a time, and does not list every value", async () => {
    const stored = many(40);
    const server = lab(stored);
    const { result } = renderHook(() => useResource(projects, { all: true, client: server.client }));
    await waitFor(() => expect(result.current.value).toHaveLength(40));
    const valueLists = () => server.lists.filter((search) => !search.includes("manifest=1"));
    const pages = valueLists().length;
    for (const [key, entry] of stored) stored.set(key, { value: entry.value, version: 2 });

    await server.hear({ topic: { scope: "org" }, kind: "resync" } as WireNotice);
    await waitFor(() => expect(server.entryReads).toHaveLength(40));
    expect(server.maxInFlight()).toBeLessThanOrEqual(20);
    expect(server.maxInFlight()).toBeGreaterThan(1);
    expect(valueLists()).toHaveLength(pages);
    expect(result.current.value?.every((entry) => entry.version === 2)).toBe(true);
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

describe("useResource(def, { newest: true })", () => {
  const named = (...ids: string[]): WireNotice => ({ topic: { scope: "org", resource: ids[0] }, kind: "resource", ids });

  it("reads the newest page, then older pages, and merges a new entry by id without listing the collection again", async () => {
    const stored = new Map<string, Stored>(
      Array.from({ length: 250 }, (_, i) => [`projects/e${String(i).padStart(3, "0")}`, { value: { name: `E${i}`, at: i }, version: 1 }])
    );
    const { client, lists, entryReads, hear } = lab(stored);
    const { result } = renderHook(() => useResource(projects, { newest: true, client }));
    await waitFor(() => expect(result.current.value).toHaveLength(200));
    expect(result.current.value?.[0]?.storageKey).toBe("projects/e249");
    expect(result.current.value?.[199]?.storageKey).toBe("projects/e050");
    expect(result.current.hasOlder).toBe(true);
    const listed = lists.length;

    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.value).toHaveLength(250));
    expect(result.current.value?.[249]?.storageKey).toBe("projects/e000");
    expect(result.current.hasOlder).toBe(false);
    // The older page is one request. The first page is not read again.
    expect(lists).toHaveLength(listed + 1);
    expect(lists.at(-1)).toContain("cursor=");

    stored.set("projects/e300", { value: { name: "new", at: 300 }, version: 1 });
    await hear(named("projects/e300"));
    await waitFor(() => expect(result.current.value?.[0]?.storageKey).toBe("projects/e300"));
    expect(entryReads).toEqual(["projects/e300"]);
    expect(lists).toHaveLength(listed + 1);
    expect(result.current.value).toHaveLength(251);
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
