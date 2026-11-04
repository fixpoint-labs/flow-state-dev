/**
 * The rail's coordinator rows carry their turn state like every other row.
 *
 * A coordinator's row is built from the user's conversation with it, not from
 * the listing, so its state has to be read in: the coordinator flow's own
 * listing, asked for status, matched by id. Without that, a coordinator
 * waiting on its person would be the one row in the rail with no mark.
 */
import type { SessionSummary } from "@flow-state-dev/client";
import { describe, expect, it, vi } from "vitest";

import { railSessions, type RailClient } from "@/lib/rail-sessions";
import { SHELL_COORDINATORS } from "@/lib/workforce-shell";

const COORDINATOR = SHELL_COORDINATORS[0]!;

function fakes() {
  const list = vi.fn(async (options?: { flowKind?: string; include?: unknown }) =>
    options?.flowKind === "coordinator"
      ? ([
          { id: "conv_1", flowKind: "coordinator", requestStatus: "suspended", requestWaitsForUser: true },
          { id: "someone_else", flowKind: "coordinator", requestStatus: "failed" },
        ] as unknown as SessionSummary[])
      : [],
  );
  const subscribe = vi.fn(() => ({ close: () => {} }));
  const client = { userId: "devuser", flows: async () => [], sessions: { list }, subscribe } as unknown as RailClient;
  const workforce = {
    ensureWorkerSession: vi.fn(async () => ({ id: "conv_1", flowKind: "coordinator" }) as unknown as SessionSummary),
  };
  return { client, workforce, list, subscribe };
}

describe("the rail's coordinator rows", () => {
  it("carry the state of the user's conversation with each coordinator, when the navigator asks", async () => {
    const { client, workforce } = fakes();
    const rows = await railSessions(client, workforce as never).sessions.list({
      flowKind: "coordinator",
      include: ["status"],
    });
    expect(rows.map((row) => [row.title, row.requestStatus, row.requestWaitsForUser])).toEqual([
      [COORDINATOR, "suspended", true],
    ]);
  });

  it("read nothing more when no state is asked for", async () => {
    const { client, workforce, list } = fakes();
    const rows = await railSessions(client, workforce as never).sessions.list({ flowKind: "coordinator" });
    expect(rows[0]!.requestStatus).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });

  it("keep the page's subscribe, so the navigator's leaves stay live", () => {
    const { client, workforce, subscribe } = fakes();
    railSessions(client, workforce as never).subscribe([], { onChange: () => {} });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
