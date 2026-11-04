/**
 * The rail lists the coordinators the roster names: every worker on a
 * coordinator flow, read at each listing, with no list kept in the app. A
 * second coordinator `WORKER.md` (or one the user hired on the coordinator
 * flow) is listed with nothing to edit.
 *
 * Red state produced: against a hand-kept `["support.help"]`, the
 * two-coordinator case lists one.
 */
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@flow-state-dev/client";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";

import { railSessions, type RailClient } from "../lib/rail-sessions";

const entry = (id: string, flow: string): RosterEntry => ({
  id,
  flow,
  standard: true,
  description: null,
  name: null,
  teamName: null,
  forkedFrom: null,
  settings: {},
});

function rail(roster: () => RosterEntry[]) {
  const client: RailClient = {
    userId: "devuser",
    flows: async () => [],
    sessions: { list: async () => [{ id: "store-row" } as SessionSummary] },
  };
  const workforce = {
    roster: async () => roster(),
    ensureWorkerSession: async ({ worker }: { worker: string }) => ({ id: `conversation:${worker}`, flowKind: "coordinator" }) as SessionSummary,
  };
  return railSessions(client, workforce);
}

const query = { flowKind: "coordinator", userId: "devuser" } as const;

describe("the rail's coordinators", () => {
  it("lists every worker on a coordinator flow the roster names, and no other", async () => {
    const listed = await rail(() => [
      entry("support.help", "coordinator"),
      entry("support.general", "agent"),
      entry("ops.desk", "coordinator"),
    ]).sessions.list(query);
    expect(listed.map((session) => [session.title, session.id])).toEqual([
      ["support.help", "conversation:support.help"],
      ["ops.desk", "conversation:ops.desk"],
    ]);
  });

  it("reads the roster at each listing, so a coordinator added since is listed", async () => {
    let roster = [entry("support.help", "coordinator")];
    const source = rail(() => roster);
    expect((await source.sessions.list(query)).map((session) => session.title)).toEqual(["support.help"]);
    roster = [...roster, entry("ops.desk", "coordinator")];
    expect((await source.sessions.list(query)).map((session) => session.title)).toEqual(["support.help", "ops.desk"]);
  });

  it("lists every other flow as the store has it, reading no roster", async () => {
    const source = rail(() => {
      throw new Error("read the roster for a flow that isn't a coordinator's");
    });
    expect(await source.sessions.list({ flowKind: "chat-agent", userId: "devuser" })).toEqual([{ id: "store-row" }]);
  });
});
