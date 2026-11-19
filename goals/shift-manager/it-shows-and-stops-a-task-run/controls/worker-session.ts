/**
 * Control `worker-session`: the Session reads the worker's own conversation
 * instead of the run the row names.
 *
 * Built into the control page in place of `src/lib/session-feeds.tsx`. A
 * feed asked for a session follows the newest other session this person
 * holds on the same flow (the "latest session of this seat" near-miss), or,
 * when that flow holds no other, the newest other session on any flow. The
 * goal must fail at "items equal the run session's".
 *
 * The feed never falls back to the session asked for, which would leave the
 * Session right and the control toothless.
 */
import { useEffect, useState } from "react";
import type { Client } from "@flow-state-dev/client";
import { useLab } from "../../../../packages/shift-manager/src/lib/lab-data.tsx";
import { useSharedSessionFeed as useRealFeed } from "../../../../packages/shift-manager/src/lib/session-feeds.tsx";

export * from "../../../../packages/shift-manager/src/lib/session-feeds.tsx";

/** The newest other listed session on the same flow as `sessionId`, else on any flow. Never `sessionId`. */
async function workerSession(client: Client, sessionId: string): Promise<string> {
  const flowId = (await client.sessions.get(sessionId)).flowId;
  const listed = await client.sessions.list({ userId: client.userId, include: "dispatch-runs" });
  const others = listed.filter((s) => s.id !== sessionId).sort((a, b) => b.updatedAt - a.updatedAt);
  const other = others.find((s) => s.flowId === flowId) ?? others[0];
  if (other === undefined) throw new Error(`control worker-session: this person holds no session but ${sessionId}`);
  return other.id;
}

export function useSharedSessionFeed(sessionId: string | null | undefined) {
  const { client } = useLab();
  const [other, setOther] = useState<string | null>(null);
  useEffect(() => {
    setOther(null);
    if (sessionId == null) return;
    let live = true;
    void workerSession(client, sessionId).then((id) => live && setOther(id));
    return () => {
      live = false;
    };
  }, [client, sessionId]);
  return useRealFeed(other);
}
