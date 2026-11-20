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
/** Every whole read made, by `<scope>:<pattern>`. */
const lists: string[] = [];
const client = {
  userId: "u_1",
  resource: ({ scope, pattern }: { scope: string; pattern: string }) => ({
    scope,
    key: pattern,
    list: async () => ({ items: [] }),
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
  sessions: { list: async () => [] },
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

let rosterWatches = 0;
const workforce = {
  watchRoster: (onRoster: (entries: unknown[]) => void) => {
    rosterWatches += 1;
    void Promise.resolve().then(() =>
      onRoster([
        { id: "eng.coder", flow: "coder", standard: true, description: null, name: null, teamName: null, settings: { harness: "codex" } },
        { id: "amber", flow: "coder", standard: false, description: null, name: "Amber", teamName: null },
      ]),
    );
    return () => {};
  },
};
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));

import { DirectoryProvider, useWorkers } from "../src/lib/directory";

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
