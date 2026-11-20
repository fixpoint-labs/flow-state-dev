// @vitest-environment happy-dom
/**
 * A project's workstreams read on a change, not on a clock (FIX-2775): read
 * whole by the project's one prefix through react's `useResource` when they
 * are drawn, and again only on a notice under that prefix in the project's
 * scope (the org's for a shared project, the user's for a private one). A
 * notice that names entries reads just those; one that names none diffs the
 * prefix's manifest and reads only what changed (FIX-2845). Nothing reads them
 * on a Lab read. A failed later read keeps
 * the last rows; only a failed first read shows.
 *
 * The client's direct read and its subscription are the test's.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNotice, WireTopic } from "@flow-state-dev/client";

type Opened = { topics: readonly WireTopic[]; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const subscribe = (topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void }) => {
  const entry: Opened = { topics, onChange: options.onChange, closed: false };
  opened.push(entry);
  return { close: () => void (entry.closed = true) };
};
const hear = (notice: WireNotice) => opened.filter((o) => !o.closed).forEach((o) => o.onChange(notice));

let entries: Array<{ storageKey: string; clientData: unknown }> = [];
let failing = false;
let projectReads = 0;
let manifestReads = 0;
const prefixes: string[] = [];
const entryReads: string[] = [];
const stored = () => entries.map((entry) => ({ topic: entry.storageKey, storageKey: entry.storageKey, value: entry.clientData, version: 1 }));
const client = {
  userId: "u_1",
  // The direct read by scope (FIX-2624): a project's entries by its one prefix.
  resource: ({ scope, pattern }: { scope: string; pattern: string }) => ({
    scope,
    key: pattern,
    // A later read with entries in hand diffs the manifest instead of listing values (FIX-2845).
    list: async (options: { manifest?: boolean; topicPrefix?: string } = {}) => {
      if (options.manifest !== true) return { items: stored() };
      manifestReads += 1;
      prefixes.push(`${scope}:${options.topicPrefix}`);
      if (failing) throw new Error("unavailable");
      return {
        items: stored()
          .filter((entry) => options.topicPrefix === undefined || entry.storageKey.startsWith(options.topicPrefix))
          .map((entry) => ({ storageKey: entry.storageKey, version: entry.version })),
      };
    },
    listAll: async (options: { topicPrefix?: string } = {}) => {
      projectReads += 1;
      prefixes.push(`${scope}:${options.topicPrefix}`);
      if (failing) throw new Error("unavailable");
      return stored().filter((entry) => options.topicPrefix === undefined || entry.storageKey.startsWith(options.topicPrefix));
    },
    entry: (storageKey: string) => ({
      read: async () => {
        entryReads.push(storageKey);
        if (failing) throw new Error("unavailable");
        const found = stored().find((entry) => entry.storageKey === storageKey);
        return { value: found?.value ?? null, version: 1 };
      },
    }),
  }),
  subscribe,
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

import { STALE_AFTER_MS } from "@flow-state-dev/workforce/browser";
import { useProjectWorkstreams, type ProjectAddress } from "../src/lib/projects";

type Shown = ReturnType<typeof useProjectWorkstreams>;
const shown: Shown[] = [];
function Probe({ address }: { address: ProjectAddress }) {
  shown.push(useProjectWorkstreams(address));
  return null;
}
const settle = () => new Promise((r) => setTimeout(r, 50));
const resource = (scope: "user" | "org", path: string, named?: string[]): WireNotice => ({
  topic: { scope, resource: path },
  kind: "resource",
  ...(named === undefined ? {} : { ids: named }),
});
const entry = (owner: string, id: string, title: string) => {
  const at = new Date().toISOString();
  return {
    storageKey: `workstreams/apollo/~${owner}/${id}`,
    clientData: { title, lead: "researcher", sessionId: null, status: "on-track", due: null, objectives: [], openedAt: at, updatedAt: at, writtenBy: { userId: owner } },
  };
};
const titles = () => shown.at(-1)?.value?.entries.map((e) => e.title);

beforeEach(() => {
  opened.splice(0);
  shown.splice(0);
  entries = [entry("u_1", "research", "Research")];
  failing = false;
  projectReads = 0;
  manifestReads = 0;
  prefixes.splice(0);
  entryReads.splice(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a project's workstreams", () => {
  it("read whole by the project's prefix, then only on a notice under it: a named entry is one entry read", async () => {
    render(<Probe address={{ visibility: "shared", id: "apollo" }} />);
    await waitFor(() => expect(titles()).toEqual(["Research"]));
    expect(prefixes).toEqual(["org:workstreams/apollo/"]);
    expect(opened.find((o) => !o.closed)?.topics).toEqual([{ scope: "org" }]);

    // Another project, another collection, the projects themselves: nothing is read.
    hear(resource("org", "workstreams/zeus"));
    hear(resource("org", "workstreams/zeus/~u_1/research", ["workstreams/zeus/~u_1/research"]));
    hear(resource("org", "inventory/workers/eng"));
    hear(resource("org", "projects/apollo"));
    await settle();
    expect(projectReads).toBe(1);
    expect(entryReads).toEqual([]);

    // A workstream someone else's turn opened: that one entry is read and drawn.
    entries = [...entries, entry("u_2", "search", "Search")];
    hear(resource("org", "workstreams/apollo", ["workstreams/apollo/~u_2/search"]));
    await waitFor(() => expect(titles()).toEqual(["Research", "Search"]));
    expect(entryReads).toEqual(["workstreams/apollo/~u_2/search"]);
    expect(projectReads).toBe(1);

    // A notice under the project that names none diffs its manifest by the prefix: nothing changed, so no value is read again.
    hear(resource("org", "workstreams/apollo"));
    await waitFor(() => expect(manifestReads).toBe(1));
    await settle();
    expect(prefixes.at(-1)).toBe("org:workstreams/apollo/");
    expect(projectReads).toBe(1);
    expect(entryReads).toEqual(["workstreams/apollo/~u_2/search"]);
    expect(titles()).toEqual(["Research", "Search"]);
  });

  it("of a private project are read and heard under the user's scope", async () => {
    render(<Probe address={{ visibility: "private", id: "apollo" }} />);
    await waitFor(() => expect(titles()).toEqual(["Research"]));
    expect(prefixes).toEqual(["user:workstreams/apollo/"]);
    expect(opened.find((o) => !o.closed)?.topics).toEqual([{ scope: "user" }]);
  });

  it("keep the last rows when a later read fails; only a failed first read shows", async () => {
    failing = true;
    render(<Probe address={{ visibility: "shared", id: "apollo" }} />);
    await waitFor(() => expect(shown.at(-1)?.failure).toBeDefined());
    expect(shown.at(-1)?.value).toBeUndefined();

    failing = false;
    shown.at(-1)!.refresh();
    await waitFor(() => expect(titles()).toEqual(["Research"]));

    failing = true;
    const before = manifestReads;
    hear(resource("org", "workstreams/apollo"));
    await waitFor(() => expect(manifestReads).toBe(before + 1));
    await settle();
    expect(titles()).toEqual(["Research"]);
  });
});

describe("a workstream going quiet", () => {
  it("shows as gone quiet once its threshold passes, by the page's own clock, with no read", async () => {
    // A quiet workstream is one nobody writes: no notice ever says it went quiet.
    const loadedAt = Date.UTC(2026, 10, 12, 9);
    vi.useFakeTimers({ now: loadedAt, shouldAdvanceTime: true });
    const updatedAt = new Date(loadedAt - STALE_AFTER_MS + 5_000).toISOString();
    entries = [
      {
        storageKey: "workstreams/apollo/~u_1/research",
        clientData: { title: "Research", lead: "researcher", sessionId: null, status: "on-track", due: null, objectives: [], openedAt: updatedAt, updatedAt, writtenBy: { userId: "u_1" } },
      },
    ];
    render(<Probe address={{ visibility: "shared", id: "apollo" }} />);
    const value = () => shown.at(-1)?.value;
    await waitFor(() => expect(value()?.entries.map((e) => e.id)).toEqual(["research"]));
    expect(value()!.entries[0]!.stale).toBe(false);
    expect(value()!.progress.stale).toEqual([]);

    await vi.advanceTimersByTimeAsync(6_000);
    await waitFor(() => expect(value()!.entries[0]!.stale).toBe(true));
    expect(value()!.progress.stale.map((e) => e.id)).toEqual(["research"]);
    expect(projectReads).toBe(1);
  });

  it("still goes quiet when its threshold is further off than setTimeout's longest delay", async () => {
    // An entry written 20 days ahead of this page's clock goes quiet 27 days from now:
    // past setTimeout's cap (about 24.8 days), so the first timer fires early and must set itself again.
    const DAY = 24 * 60 * 60 * 1000;
    const loadedAt = Date.UTC(2026, 10, 12, 9);
    vi.useFakeTimers({ now: loadedAt, shouldAdvanceTime: true });
    const updatedAt = new Date(loadedAt + 20 * DAY).toISOString();
    entries = [
      {
        storageKey: "workstreams/apollo/~u_1/research",
        clientData: { title: "Research", lead: "researcher", sessionId: null, status: "on-track", due: null, objectives: [], openedAt: updatedAt, updatedAt, writtenBy: { userId: "u_1" } },
      },
    ];
    render(<Probe address={{ visibility: "shared", id: "apollo" }} />);
    const value = () => shown.at(-1)?.value;
    await waitFor(() => expect(value()?.entries.map((e) => e.id)).toEqual(["research"]));
    await vi.advanceTimersByTimeAsync(26 * DAY);
    expect(value()!.entries[0]!.stale).toBe(false);
    await vi.advanceTimersByTimeAsync(1 * DAY + 60_000);
    await waitFor(() => expect(value()!.entries[0]!.stale).toBe(true));
    expect(projectReads).toBe(1);
  });
});
