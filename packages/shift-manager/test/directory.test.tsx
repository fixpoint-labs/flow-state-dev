// @vitest-environment happy-dom
/**
 * The worker directory is one read of each per page (FIX-2775 D1): however
 * many screens draw a worker, the inventory is listed once and the roster
 * watched once, and one change notice on the organization's topic is one read,
 * not one per screen. The rows are the inventory joined with the roster: the
 * user's own workers after the inventory's, a standard worker's harness off its
 * roster entry.
 *
 * The client's direct read, its subscription and the roster watch are the
 * test's; the directory's hooks and join are the app's.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNotice, WireTopic } from "@flow-state-dev/client";

type Opened = { topics: readonly WireTopic[]; onChange: (notice: WireNotice | null) => void; closed: boolean };
const opened: Opened[] = [];
const hear = (notice: WireNotice) => opened.filter((o) => !o.closed).forEach((o) => o.onChange(notice));

/** each collection's entries, by pattern. */
const stored: Record<string, Array<{ storageKey: string; value: unknown }>> = {};
/** Every whole read made, by `<scope>:<pattern>`: the values (`listAll`), or the manifest a later read diffs (FIX-2845). */
const lists: string[] = [];
/** How the session list answers; a test swaps it. */
let listSessions: (...args: unknown[]) => Promise<unknown> = async () => [];
const client = {
  userId: "u_1",
  resource: ({ scope, pattern }: { scope: string; pattern: string }) => ({
    scope,
    key: pattern,
    list: async (options: { manifest?: boolean } = {}) => {
      if (options.manifest !== true) return { items: [] };
      lists.push(`${scope}:${pattern}`);
      return { items: (stored[pattern] ?? []).map((each) => ({ storageKey: each.storageKey, version: 1 })) };
    },
    listAll: async () => {
      lists.push(`${scope}:${pattern}`);
      return (stored[pattern] ?? []).map((each) => ({ topic: each.storageKey, ...each, version: 1 }));
    },
    entry: (storageKey: string) => ({ read: async () => ({ value: (stored[pattern] ?? []).find((each) => each.storageKey === storageKey)?.value ?? null, version: 1 }) }),
  }),
  subscribe: (topics: readonly WireTopic[], options: { onChange: (notice: WireNotice | null) => void }) => {
    const entry: Opened = { topics, onChange: options.onChange, closed: false };
    opened.push(entry);
    return { close: () => void (entry.closed = true) };
  },
  sessions: { list: (...args: unknown[]) => listSessions(...args) },
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

let rosterWatches = 0;
const ROSTER = [
  { id: "eng.coder", flow: "coder", standard: true, description: null, name: null, teamName: null, settings: { harness: "codex" } },
  { id: "amber", flow: "coder", standard: false, description: null, name: "Amber", teamName: null },
];
/** When set, the roster watch holds its first answer until the test calls it. */
let holdRoster = false;
let releaseRoster: (() => void) | undefined;
const workforce = {
  watchRoster: (onRoster: (entries: unknown[]) => void) => {
    rosterWatches += 1;
    if (holdRoster) releaseRoster = () => onRoster(ROSTER);
    else void Promise.resolve().then(() => onRoster(ROSTER));
    return () => {};
  },
};
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));

import { DirectoryProvider, useDirectoryLanded, useSessions, useWorkers } from "../src/lib/directory";

const INVENTORY = "inventory/workers/*";
const drawn: Array<string[]> = [];
/** A screen drawing the directory's workers, as Roster, TEAMS and Jump to each do. */
function Screen() {
  drawn.push(useWorkers().workers.map((worker) => `${worker.id}:${worker.kind}:${worker.harness ?? "-"}`));
  return null;
}

beforeEach(() => {
  opened.splice(0);
  lists.splice(0);
  drawn.splice(0);
  rosterWatches = 0;
  holdRoster = false;
  releaseRoster = undefined;
  listSessions = async () => [];
  stored[INVENTORY] = [{ storageKey: "inventory/workers/eng.coder", value: { id: "eng.coder", kind: "coder", door: "run" } }];
});
afterEach(cleanup);

describe("the worker directory", () => {
  it("is one inventory read and one roster watch for every screen on the page, and one read per org notice", async () => {
    render(
      <DirectoryProvider>
        <Screen />
        <Screen />
        <Screen />
      </DirectoryProvider>,
    );
    await waitFor(() => expect(drawn.at(-1)).toEqual(["eng.coder:coder:codex", "amber:coder:-"]));
    expect(lists.filter((list) => list === `org:${INVENTORY}`)).toHaveLength(1);
    expect(rosterWatches).toBe(1);

    // A hire registers a worker: one notice, one read, every screen redrawn from it.
    stored[INVENTORY] = [...stored[INVENTORY]!, { storageKey: "inventory/workers/eng.reviewer", value: { id: "eng.reviewer", kind: "agent" } }];
    await act(async () => hear({ topic: { scope: "org", resource: "inventory/workers" }, kind: "resource" }));
    await waitFor(() => expect(drawn.at(-1)).toEqual(["eng.coder:coder:codex", "eng.reviewer:agent:-", "amber:coder:-"]));
    expect(lists.filter((list) => list === `org:${INVENTORY}`)).toHaveLength(2);
  });
});

describe("the directory's first reads", () => {
  type Seen = { landed: boolean; sessions: ReturnType<typeof useSessions> };
  const seen: Seen[] = [];
  function Probe() {
    seen.push({ landed: useDirectoryLanded(), sessions: useSessions() });
    return null;
  }
  beforeEach(() => void seen.splice(0));

  it("a session list that fails its first read lands as that failure, never as no sessions, and a refresh that lands clears it", async () => {
    listSessions = async () => {
      throw new Error("the session store is down");
    };
    render(
      <DirectoryProvider>
        <Probe />
      </DirectoryProvider>,
    );
    await waitFor(() => expect(seen.at(-1)!.sessions.failure?.message).toContain("the session store is down"));
    // Not one drawn state says the user has no sessions.
    expect(seen.some((s) => s.sessions.list !== undefined)).toBe(false);
    expect(seen.at(-1)!.landed).toBe(true);

    listSessions = async () => [];
    act(() => seen.at(-1)!.sessions.refresh());
    await waitFor(() => expect(seen.at(-1)!.sessions.list).toEqual([]));
    expect(seen.at(-1)!.sessions.failure).toBeUndefined();
  });

  it("hasn't landed until the roster has: no frame draws the inventory's workers before the user's own join them", async () => {
    holdRoster = true;
    render(
      <DirectoryProvider>
        <Probe />
      </DirectoryProvider>,
    );
    await waitFor(() => expect(seen.at(-1)!.sessions.list).toEqual([]));
    await waitFor(() => expect(lists).toContain(`org:${INVENTORY}`));
    expect(seen.some((s) => s.landed)).toBe(false);
    act(() => releaseRoster!());
    await waitFor(() => expect(seen.at(-1)!.landed).toBe(true));
  });
});
