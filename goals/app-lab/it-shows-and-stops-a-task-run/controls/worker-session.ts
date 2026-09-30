/**
 * Control `worker-session`: the Session reads the worker's own conversation
 * instead of the run the row names.
 *
 * Built into the control page in place of `src/lib/run.ts`. The Session's
 * item read goes to the newest other session this person holds on the same
 * seat flow (the "latest session of this seat" near-miss), and no request
 * stream is followed, since that conversation is not the run. The goal must
 * fail at "items equal the run session's".
 */
import type { LabClients } from "../../../../labs/app-lab/src/lib/connection.ts";
import { readSessionItems as readAsWritten, type RequestFollower, type SessionItems } from "../../../../labs/app-lab/src/lib/run.ts";

export * from "../../../../labs/app-lab/src/lib/run.ts";

/** The newest other listed session on the same flow as `sessionId`. */
async function workerSession(clients: LabClients, sessionId: string): Promise<string> {
  const flowId = (await clients.sessions.getSession(sessionId)).flowId;
  const listed = await clients.sessions.listSessions({ userId: clients.userId, include: "dispatch-runs" });
  const other = listed
    .filter((s) => s.flowId === flowId && s.id !== sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return other?.id ?? sessionId;
}

export async function readSessionItems(clients: LabClients, sessionId: string): Promise<SessionItems> {
  return readAsWritten(clients, await workerSession(clients, sessionId));
}

export function followRequest(_clients: LabClients, _run: unknown, _to: RequestFollower): { close(): void } {
  return { close: () => undefined };
}
