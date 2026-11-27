/**
 * The rail follows the live coordinator roster and carries each conversation's
 * turn state when requested, without listing the coordinator flow wholesale.
 */
import type { SessionSummary } from "@flow-state-dev/client";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { describe, expect, it, vi } from "vitest";

import { railSessions, type RailClient } from "../lib/rail-sessions";

const entry = (id: string, flow: string): RosterEntry => ({
  id,
  flow,
  standard: true,
  description: null,
  name: null,
  teamName: null,
  forkedFrom: null,
  edited: false,
  settings: {},
});

function rail(roster: () => RosterEntry[]) {
  const list = vi.fn(async (options?: { flowKind?: string; state?: { workerId?: string } }) => {
    if (options?.flowKind !== "coordinator") return [{ id: "store-row" }] as unknown as SessionSummary[];
    const worker = options.state?.workerId ?? "support.help";
    return [
      {
        id: `conversation:${worker}`,
        flowKind: "coordinator",
        requestStatus: "suspended",
        requestWaitsForUser: true,
      },
      { id: "someone_else", flowKind: "coordinator", requestStatus: "failed" },
    ] as unknown as SessionSummary[];
  });
  const subscribe = vi.fn(() => ({ close: () => {} }));
  const client = {
    userId: "devuser",
    flows: async () => [],
    sessions: { list },
    subscribe,
  } as unknown as RailClient;
  const workforce = {
    roster: async () => roster(),
    ensureWorkerSession: vi.fn(
      async ({ worker }: { worker: string }) =>
        ({ id: `conversation:${worker}`, flowKind: "coordinator" }) as unknown as SessionSummary,
    ),
  };
  return { rail: railSessions(client, workforce as never), list, subscribe, workforce };
}

const query = { flowKind: "coordinator", userId: "devuser" } as const;

describe("the rail's coordinator rows", () => {
  it("lists every roster worker on a coordinator flow, and refreshes the roster on each read", async () => {
    let roster = [entry("support.help", "coordinator"), entry("support.general", "agent")];
    const source = rail(() => roster);
    expect((await source.rail.sessions.list(query)).map((row) => row.title)).toEqual(["support.help"]);

    roster = [...roster, entry("ops.desk", "coordinator")];
    expect((await source.rail.sessions.list(query)).map((row) => row.title)).toEqual(["support.help", "ops.desk"]);
  });

  it("lists other flows as the store has them without reading the roster", async () => {
    const source = rail(() => {
      throw new Error("read the roster for a flow that isn't a coordinator's");
    });
    expect(await source.rail.sessions.list({ flowKind: "chat-agent", userId: "devuser" })).toEqual([{ id: "store-row" }]);
  });

  it("carries the matched conversation's status only when requested", async () => {
    const source = rail(() => [entry("support.help", "coordinator")]);
    const rows = await source.rail.sessions.list({ ...query, include: ["status"] });
    expect(rows.map((row) => [row.title, row.requestStatus, row.requestWaitsForUser])).toEqual([
      ["support.help", "suspended", true],
    ]);
    expect(source.list.mock.calls.map(([options]) => options?.state)).toEqual([{ workerId: "support.help" }]);

    source.list.mockClear();
    const plainRows = await source.rail.sessions.list(query);
    expect(plainRows[0]!.requestStatus).toBeUndefined();
    expect(source.list).not.toHaveBeenCalled();
  });

  it("passes subscriptions through so the navigator's open leaves stay live", () => {
    const source = rail(() => []);
    source.rail.subscribe([], { onChange: () => {} });
    expect(source.subscribe).toHaveBeenCalledTimes(1);
  });
});
