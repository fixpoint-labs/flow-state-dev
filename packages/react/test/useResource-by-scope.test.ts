// @vitest-environment happy-dom
/**
 * `useResource(def, { session })` (FIX-2624, D2): one hook for one resource or
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
});
