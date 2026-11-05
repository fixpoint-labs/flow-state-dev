/**
 * The rail's session reads: the coordinator flow's sessions are the user's
 * conversations with the coordinators the tree declares, one each, found or
 * started by the coordinator's id; every other flow's are listed as the store
 * has them.
 *
 * A coordinator is a worker, so a user's conversation with `support.help` is
 * a session on the `coordinator` flow that names it, found the way any
 * worker's is (`ensureWorkerSession({ worker })`, which matches on the
 * criteria's keys and so never returns a delegate's session). Each row reads
 * as the coordinator's id, the name the user knows it by, and carries its
 * turn state, when the navigator asks for it, from a listing of that
 * coordinator's own sessions (never the flow whole), so its rows are marked
 * like every other.
 *
 * `subscribe` passes through, so the navigator's open leaves stay live.
 */
import type { Client, SessionSummary } from "@flow-state-dev/client";
import type { WorkforceClient } from "@flow-state-dev/workforce/browser";

import { isCoordinatorFlow, SHELL_COORDINATORS } from "./workforce-shell";

/** What the rail's navigator reads: the client's user, its flow list, its session listing, and `subscribe` to stay live. */
export type RailClient = Pick<Client, "userId" | "flows" | "subscribe"> & {
  readonly sessions: Pick<Client["sessions"], "list">;
};

/**
 * The client the rail's navigator reads through: the page's own, with the
 * coordinator flow's listing replaced.
 *
 * @param client The page's client; a stable reference, so the navigator's reads stay fenced on it.
 * @param workforce The user's workforce client, which finds or starts their conversation with a coordinator.
 * @returns A client whose coordinator-flow listing is one conversation per declared coordinator.
 */
export function railSessions(client: RailClient, workforce: Pick<WorkforceClient, "ensureWorkerSession">): RailClient {
  const list: RailClient["sessions"]["list"] = async (options) => {
    const flow = options?.flowKind;
    if (flow === undefined || !isCoordinatorFlow(flow)) return await client.sessions.list(options);
    const include = options?.include === undefined ? [] : [options.include].flat();
    const withStatus = include.includes("status");
    // Per declared coordinator (a fixed, small set): find or start the user's
    // conversation and, when the navigator asks for state, list that
    // coordinator's own sessions with status. The flow is never listed whole.
    return await Promise.all(
      SHELL_COORDINATORS.map(async (worker): Promise<SessionSummary> => {
        const [session, listed] = await Promise.all([
          workforce.ensureWorkerSession({ worker }),
          withStatus
            ? client.sessions.list({ flowKind: flow, state: { workerId: worker }, include: ["status"] })
            : undefined,
        ]);
        const row: SessionSummary = { ...session, title: worker };
        const state = listed?.find((candidate) => candidate.id === session.id);
        if (state?.requestStatus == null) return row;
        return {
          ...row,
          requestStatus: state.requestStatus,
          ...(state.requestWaitsForUser === undefined ? {} : { requestWaitsForUser: state.requestWaitsForUser }),
        };
      }),
    );
  };
  return {
    userId: client.userId,
    flows: () => client.flows(),
    sessions: { list },
    subscribe: (topics, options) => client.subscribe(topics, options),
  };
}
