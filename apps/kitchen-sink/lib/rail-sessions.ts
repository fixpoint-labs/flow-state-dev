/**
 * The rail's session reads: the coordinator kind's sessions are the person's
 * conversations with the coordinators the tree declares, one each, found or
 * started by the coordinator's id; every other kind's are listed as the store
 * has them.
 *
 * A coordinator is a worker, so a person's conversation with `support.help` is
 * a session on the `coordinator` flow that names it, found the way any
 * worker's is (`ensureWorkerSession({ worker })`, which matches on the
 * criteria's keys and so never returns a delegate's session). Each row reads
 * as the coordinator's id, the name the person knows it by.
 */
import type { SessionClient, SessionSummary } from "@flow-state-dev/client";
import type { WorkforceClient } from "@flow-state-dev/workforce/browser";

import { isCoordinatorKind, SHELL_COORDINATORS } from "./workforce-shell";

/**
 * The session source the rail's navigator reads through.
 *
 * @param client The page's session client; a stable reference, so the navigator's reads stay fenced on it.
 * @param workforce The person's workforce client, which finds or starts their conversation with a coordinator.
 * @returns A source whose coordinator-kind listing is one conversation per declared coordinator.
 */
export function railSessions(
  client: Pick<SessionClient, "listSessions">,
  workforce: Pick<WorkforceClient, "ensureWorkerSession">,
): Pick<SessionClient, "listSessions"> {
  return {
    listSessions: async (options) => {
      const kind = options?.flowKind;
      if (kind === undefined || !isCoordinatorKind(kind)) return await client.listSessions(options);
      return await Promise.all(
        SHELL_COORDINATORS.map(
          async (worker): Promise<SessionSummary> => ({
            ...(await workforce.ensureWorkerSession({ worker })),
            title: worker,
          }),
        ),
      );
    },
  };
}
