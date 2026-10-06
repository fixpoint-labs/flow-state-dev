/**
 * Control `worker-session`: the Session reads the worker's own conversation
 * instead of the run the row names.
 *
 * Built into the control page in place of `src/lib/run.ts`. The Session's
 * item read goes to the newest other session this person holds on the same
 * seat flow (the "latest session of this seat" near-miss), and no request
 * stream is followed, since that conversation is not the run. The goal must
 * fail at "items equal the run session's".
 *
 * A seat whose flow holds no other session (a per-task coder whose only
 * session is its run) gets the next near-miss, the newest other session this
 * person holds on any flow. The read never falls back to the run session
 * itself, which would leave the Session right and the control toothless.
 */
import type { LabClients } from "../../../../packages/shift-manager/src/lib/connection.ts";
import { readSessionItems as readAsWritten, type RequestFollower, type SessionItems } from "../../../../packages/shift-manager/src/lib/run.ts";

export * from "../../../../packages/shift-manager/src/lib/run.ts";

/** The newest other listed session on the same flow as `sessionId`, else on any flow. Never `sessionId`. */
async function workerSession(clients: LabClients, sessionId: string): Promise<string> {
  const flowId = (await clients.sessions.getSession(sessionId)).flowId;
  const listed = await clients.sessions.listSessions({ userId: clients.userId, include: "dispatch-runs" });
  const others = listed.filter((s) => s.id !== sessionId).sort((a, b) => b.updatedAt - a.updatedAt);
  const other = others.find((s) => s.flowId === flowId) ?? others[0];
  if (other === undefined) throw new Error(`control worker-session: this person holds no session but the run ${sessionId}`);
  return other.id;
}

export async function readSessionItems(clients: LabClients, sessionId: string): Promise<SessionItems> {
  return readAsWritten(clients, await workerSession(clients, sessionId));
}

export function followRequest(_clients: LabClients, _run: unknown, _to: RequestFollower): { close(): void } {
  return { close: () => undefined };
}
