// @vitest-environment happy-dom
// FIX-2624 D2.
/**
 * `useResource(def, { session })`: one hook for one resource or
 * collection at any scope. A user or org one is read by scope and key with no
 * session, read again when a change notice under its path lands (and only
 * then), and written through its handle; a session one comes from the
 * session's snapshot, as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";

const { subscriptions, handles } = vi.hoisted(() => ({
  subscriptions: [] as Array<{ topics: readonly WireTopic[]; options: SubscribeOptions }>,
  handles: new Map<string, Record<string, ReturnType<typeof vi.fn>>>()
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  return {
    ...actual,
    createClient: () =>
      fakeClient({
        subscribe: (topics, options) => {
          subscriptions.push({ topics, options });
          return { close() {} };
        },
        resource: (def: { ref?: string; pattern?: string }) => handles.get(def.ref ?? def.pattern!)
      })
  };
});

const { FlowProvider, useResource } = await import("../src");
const { createElement } = await import("react");

afterEach(() => {
  subscriptions.length = 0;
  handles.clear();
});

const wrapper = ({ children }: { children: unknown }) =>
  createElement(FlowProvider as never, { baseUrl: "", userId: "alice" } as never, children as never);

const pins = { scope: "user" as const, ref: "pins", ClientType: { pinned: [] as string[] } };
const projects = { scope: "org" as const, pattern: "projects/*", ClientType: { name: "" } };

const notice = (resource: string | undefined, scope: "user" | "org" = "user"): WireNotice => ({
  topic: { scope, ...(resource === undefined ? {} : { resource }) },
  kind: "resource"
});

describe("useResource at user or org scope", () => {
  it("reads by scope and key with no session, again on a notice under its path, and not on another's", async () => {
    let stored = { pinned: ["a"] };
    const read = vi.fn(async () => ({ value: stored, version: 1 }));
    handles.set("pins", { read, update: vi.fn() });
    const { result } = renderHook(() => useResource(pins), { wrapper });
    await waitFor(() => expect(result.current.value).toEqual({ pinned: ["a"] }));
    expect(result.current.stale).toBe(false);
    expect(subscriptions[0]!.topics).toEqual([{ scope: "user" }]);
    stored = { pinned: ["a", "b"] };
    await act(async () => subscriptions[0]!.options.onChange(notice("drafts/x")));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => subscriptions[0]!.options.onChange(notice("pins")));
    await waitFor(() => expect(result.current.value).toEqual({ pinned: ["a", "b"] }));
  });

  it("writes through the resource's handle and reads again, without waiting for the notice", async () => {
    let stored = { pinned: [] as string[] };
    const update = vi.fn(async (fn: (value: { pinned: string[] }) => { pinned: string[] }) => {
      stored = fn(stored);
      return { version: 2 };
    });
    handles.set("pins", { read: vi.fn(async () => ({ value: stored, version: 1 })), update });
    const { result } = renderHook(() => useResource(pins), { wrapper });
    await waitFor(() => expect(result.current.value).toEqual({ pinned: [] }));
    await act(async () => {
      await result.current.update((value) => ({ pinned: [...value.pinned, "t1"] }));
    });
    await waitFor(() => expect(result.current.value).toEqual({ pinned: ["t1"] }));
  });

  it("is stale, keeping the last value, when a read fails", async () => {
    const read = vi.fn().mockResolvedValueOnce({ value: { pinned: ["a"] }, version: 1 }).mockRejectedValue(new Error("down"));
    handles.set("pins", { read });
    const { result } = renderHook(() => useResource(pins), { wrapper });
    await waitFor(() => expect(result.current.value).toEqual({ pinned: ["a"] }));
    await act(async () => subscriptions[0]!.options.onChange(notice("pins")));
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.value).toEqual({ pinned: ["a"] });
  });

  it("reads a collection's entries on its org topic, and sets and deletes one entry through its handle", async () => {
    const entries = [{ topic: "p", storageKey: "projects/p", value: { name: "P" }, version: 1 }];
    const entryHandle = { set: vi.fn(async () => ({ version: 2 })), update: vi.fn(), delete: vi.fn(async () => ({ version: 2 })) };
    handles.set("projects/*", { list: vi.fn(async () => ({ items: entries })), entry: vi.fn(() => entryHandle) });
    const { result } = renderHook(() => useResource(projects), { wrapper });
    await waitFor(() => expect(result.current.value).toEqual(entries));
    expect(subscriptions[0]!.topics).toEqual([{ scope: "org" }]);
    await act(async () => {
      await result.current.set("p", { name: "Q" });
      await result.current.delete("p");
    });
    expect(entryHandle.set).toHaveBeenCalledWith({ name: "Q" });
    expect(entryHandle.delete).toHaveBeenCalled();
  });
});

// FIX-2625: a notice that names entries re-reads those entries, not the
// collection; anything it can't place safely reads the collection.
describe("useResource through a host's own client", () => {
  it("reads and subscribes through the client it is handed, outside any provider, at the pace it names", async () => {
    const { fakeClient } = await import("./support/fake-client");
    const own: Array<{ topics: readonly WireTopic[]; options: SubscribeOptions }> = [];
    const read = vi.fn(async () => ({ value: { pinned: ["mine"] }, version: 1 }));
    const client = fakeClient({
      subscribe: (topics, options) => {
        own.push({ topics, options });
        return { close() {} };
      },
      resource: () => ({ read, update: vi.fn() })
    });
    const { result } = renderHook(() => useResource(pins, { client, pollIntervalMs: 250 }));
    await waitFor(() => expect(result.current.value).toEqual({ pinned: ["mine"] }));
    expect(own).toHaveLength(1);
    expect(own[0]!.options.pollIntervalMs).toBe(250);
    expect(subscriptions).toEqual([]);
  });
});

describe("useResource · a collection notice that names its entries", () => {
  type Entry = { topic: string; storageKey: string; value: { name: string }; version: number };
  function org(entries: Entry[]) {
    const list = vi.fn(async () => ({ items: entries.map((e) => ({ ...e })) }));
    const reads: string[] = [];
    const entry = vi.fn((key: string) => ({
      read: vi.fn(async () => {
        reads.push(key);
        const found = entries.find((e) => e.storageKey === key);
        return found === undefined ? { value: null, version: 0 } : { value: found.value, version: found.version };
      })
    }));
    handles.set("projects/*", { list, entry });
    return { list, reads };
  }
  const named = (...ids: string[]): WireNotice => ({ topic: { scope: "org", resource: ids[0] }, kind: "resource", ids });
  const three = (): Entry[] =>
    ["a", "b", "c"].map((id) => ({ topic: id, storageKey: `projects/${id}`, value: { name: id.toUpperCase() }, version: 1 }));

  it("fetches just the named entry, places it, and equals the collection read whole", async () => {
    const entries = three();
    const { list, reads } = org(entries);
    const { result } = renderHook(() => useResource(projects), { wrapper });
    await waitFor(() => expect(result.current.value).toHaveLength(3));
    entries[1] = { ...entries[1]!, value: { name: "B2" }, version: 2 };
    await act(async () => subscriptions[0]!.options.onChange(named("projects/b")));
    await waitFor(() => expect(result.current.value?.[1]).toMatchObject({ value: { name: "B2" }, version: 2 }));
    expect(reads).toEqual(["projects/b"]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.value).toEqual(entries);
  });

  it("drops an entry the notice names that is gone", async () => {
    const entries = three();
    const { list } = org(entries);
    const { result } = renderHook(() => useResource(projects), { wrapper });
    await waitFor(() => expect(result.current.value).toHaveLength(3));
    entries.splice(0, 1);
    await act(async () => subscriptions[0]!.options.onChange(named("projects/a")));
    await waitFor(() => expect(result.current.value).toEqual(entries));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("reads the collection whole for an entry it doesn't hold, or a notice with no ids", async () => {
    const entries = three();
    const { list, reads } = org(entries);
    const { result } = renderHook(() => useResource(projects), { wrapper });
    await waitFor(() => expect(result.current.value).toHaveLength(3));
    entries.push({ topic: "d", storageKey: "projects/d", value: { name: "D" }, version: 1 });
    await act(async () => subscriptions[0]!.options.onChange(named("projects/d")));
    await waitFor(() => expect(result.current.value).toEqual(entries));
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => subscriptions[0]!.options.onChange(notice(undefined, "org")));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(reads).toEqual([]);
  });
});

describe("useResource at session scope", () => {
  it("reads the resource from the session's snapshot, as the old form did", () => {
    const soul = { scope: "session" as const, ref: "soul", ClientType: { mood: "" } };
    const session = { sessionId: "s1", snapshot: { resources: { session: { soul: { clientData: { mood: "calm" } } } } } };
    const { result } = renderHook(() => useResource(soul, { session: session as never }), { wrapper });
    expect(result.current.value).toEqual({ mood: "calm" });
    expect(subscriptions).toHaveLength(0);
  });

  it("finds a collection under the name its flow declares it, and a resource with no ref by its key", () => {
    // Codex review 4544281315: the snapshot is keyed by the accessor, not the ref or pattern.
    const notes = { scope: "session" as const, pattern: "notes/*", ClientType: { text: "" } };
    const soul = { scope: "session" as const, ClientType: { mood: "" } };
    const session = {
      sessionId: "s1",
      snapshot: { resources: { session: { notes: { count: 2 }, soul: { clientData: { mood: "calm" } } } } }
    };
    const collection = renderHook(() => useResource(notes, { session: session as never }), { wrapper });
    expect(collection.result.current.value).toEqual({ count: 2 });
    const single = renderHook(() => useResource(soul, { session: session as never, key: "soul" }), { wrapper });
    expect(single.result.current.value).toEqual({ mood: "calm" });
  });

  it("never takes another kind's entry for a fallback name", () => {
    // A collection under `items`, beside an unrelated single resource under `notes`.
    const notes = { scope: "session" as const, pattern: "notes/*", ClientType: { text: "" } };
    const session = { sessionId: "s1", snapshot: { resources: { session: { items: { count: 1 }, notes: { clientData: { other: true } } } } } };
    const { result } = renderHook(() => useResource(notes, { session: session as never }), { wrapper });
    expect(result.current.value).toBeNull();
  });
});

// FIX-2625, Codex on #5232: what a named entry's read may leave on screen.
describe("useResource · a collection's entries after a named entry's read", () => {
  type Entry = { topic: string; storageKey: string; value: { name: string }; version: number };
  const entryOf = (id: string, name = id.toUpperCase(), version = 1): Entry => ({ topic: id, storageKey: `projects/${id}`, value: { name }, version });
  const named = (...ids: string[]): WireNotice => ({ topic: { scope: "org", resource: ids[0] }, kind: "resource", ids });

  it("reads the whole first page when a named entry is gone from a full page, so the next entry moves in", async () => {
    // One more entry than a page holds: the 201st is off screen.
    const stored = Array.from({ length: 201 }, (_, i) => entryOf(`e${String(i).padStart(3, "0")}`));
    const list = vi.fn(async ({ limit }: { limit: number }) => ({ items: stored.slice(0, limit).map((e) => ({ ...e })) }));
    const entry = vi.fn((key: string) => ({
      read: vi.fn(async () => {
        const found = stored.find((e) => e.storageKey === key);
        return found === undefined ? { value: null, version: 0 } : { value: found.value, version: found.version };
      })
    }));
    handles.set("projects/*", { list, entry });
    const { result } = renderHook(() => useResource(projects), { wrapper });
    await waitFor(() => expect(result.current.value).toHaveLength(200));

    // An entry on the first page is deleted.
    stored.splice(5, 1);
    await act(async () => subscriptions[0]!.options.onChange(named("projects/e005")));
    await waitFor(() => expect(result.current.value!.some((e) => e.storageKey === "projects/e005")).toBe(false));
    // A full page short of one: the entry after it is the list's to bring in.
    expect(result.current.value).toHaveLength(200);
    expect(result.current.value!.map((e) => e.storageKey)).toEqual(stored.slice(0, 200).map((e) => e.storageKey));
    expect(result.current.value!.at(-1)!.storageKey).toBe("projects/e200");
  });

  it("keeps a newer read's entries when an older read lands after it, and a named entry's read merges over the newer", async () => {
    let stored = [entryOf("a"), entryOf("b"), entryOf("c")];
    // Every list after the first is held until the test serves it, with what the store held when it was sent.
    const served: Array<{ resolve: (page: { items: Entry[] }) => void; snapshot: Entry[] }> = [];
    let calls = 0;
    const list = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ items: stored.map((e) => ({ ...e })) });
      const snapshot = stored.map((e) => ({ ...e }));
      return new Promise<{ items: Entry[] }>((resolve) => served.push({ resolve, snapshot }));
    });
    const entry = vi.fn((key: string) => ({
      set: vi.fn(async (value: { name: string }) => {
        // The hook names an entry by its bare name; a read names it by its storage key.
        stored = stored.map((e) => (e.topic === key || e.storageKey === key ? { ...e, value, version: e.version + 1 } : e));
        return { version: 2 };
      }),
      read: vi.fn(async () => {
        const found = stored.find((e) => e.storageKey === key)!;
        return { value: found.value, version: found.version };
      })
    }));
    handles.set("projects/*", { list, entry });
    const { result } = renderHook(() => useResource(projects), { wrapper });
    await waitFor(() => expect(result.current.value).toHaveLength(3));

    // Read A: a notice that names nothing reads the collection whole; held.
    await act(async () => {
      subscriptions[0]!.options.onChange(named());
    });
    await waitFor(() => expect(served).toHaveLength(1));
    // A write to b, then read B, which supersedes A; held too.
    await act(async () => {
      void result.current.set("b", { name: "B2" });
    });
    await waitFor(() => expect(served).toHaveLength(2));
    // B is served first, with b's new value.
    await act(async () => served[1]!.resolve({ items: stored.map((e) => ({ ...e })) }));
    await waitFor(() => expect(result.current.value?.[1]?.value).toEqual({ name: "B2" }));
    // Then A, with what the store held before the write.
    await act(async () => served[0]!.resolve({ items: served[0]!.snapshot }));
    // A change names c alone; its read merges over the entries on screen.
    stored = stored.map((e) => (e.storageKey === "projects/c" ? { ...e, value: { name: "C2" }, version: 2 } : e));
    await act(async () => subscriptions[0]!.options.onChange(named("projects/c")));
    await waitFor(() => expect(result.current.value?.[2]?.value).toEqual({ name: "C2" }));
    expect(result.current.value?.[1]?.value).toEqual({ name: "B2" });
  });
});
