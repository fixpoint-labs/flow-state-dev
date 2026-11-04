/**
 * The rail's session reads: the coordinator flow's sessions are the user's
 * conversations with the coordinators on their roster (each worker whose flow
 * is a coordinator flow), one each, found or started by the coordinator's id;
 * every other flow's are listed as the store has them. The roster is read at
 * each listing, so a coordinator added to the tree is listed with nothing to
 * edit here.
 *
 * A coordinator is a worker, so a user's conversation with `support.help` is
 * a session on the `coordinator` flow that names it, found the way any
 * worker's is (`ensureWorkerSession({ worker })`, which matches on the
 * criteria's keys and so never returns a delegate's session). Each row reads
 * as the coordinator's id, the name the user knows it by.
 */
import type { Client, SessionSummary } from "@flow-state-dev/client";
import type { WorkforceClient } from "@flow-state-dev/workforce/browser";

import { isCoordinatorFlow } from "./workforce-shell";

/** What the rail's navigator reads: the client's user, its flow list, and its session listing. */
export type RailClient = Pick<Client, "userId" | "flows"> & { readonly sessions: Pick<Client["sessions"], "list"> };

/**
 * The client the rail's navigator reads through: the page's own, with the
 * coordinator flow's listing replaced.
 *
 * @param client The page's client; a stable reference, so the navigator's reads stay fenced on it.
 * @param workforce The user's workforce client: it names the coordinators (the roster) and finds or starts the conversation with each.
 * @returns A client whose coordinator-flow listing is one conversation per coordinator on the roster.
 */
export function railSessions(
  client: RailClient,
  workforce: Pick<WorkforceClient, "roster" | "ensureWorkerSession">,
): RailClient {
  const list: RailClient["sessions"]["list"] = async (options) => {
    const flow = options?.flowKind;
    if (flow === undefined || !isCoordinatorFlow(flow)) return await client.sessions.list(options);
    const coordinators = (await workforce.roster()).filter((worker) => isCoordinatorFlow(worker.flow));
    return await Promise.all(
      coordinators.map(
        async ({ id: worker }): Promise<SessionSummary> => ({
          ...(await workforce.ensureWorkerSession({ worker })),
          title: worker,
        }),
      ),
    );
  };
  return { userId: client.userId, flows: () => client.flows(), sessions: { list } };
}
