/**
 * The board above a worker session: the conversation board its tasks are on.
 *
 * A task session and a delegate's ongoing session were opened for one
 * conversation, and name it in their readonly `filingSessionId`. A session a
 * routed task targets by id (a workstream's, FIX-2083) wasn't: the `work`
 * entry names the routing conversation in its server-owned `routedFrom` when
 * it starts such a task. Server-set state only, either way (BP-031), and a
 * caller still reaches only rows whose run link names this session.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { FILING_SESSION_STATE_KEY, ROUTED_FROM_STATE_KEY } from "../workers/keys";

/**
 * The partition of the conversation board this session's tasks are on: the
 * conversation it was opened for, else the conversation whose routed task it
 * last started. `undefined` in a session that works no conversation's task.
 */
export function boardAboveOf(ctx: Pick<BlockContext, "session">): string | undefined {
  const state = (ctx.session.state ?? {}) as Record<string, unknown>;
  const filing = state[FILING_SESSION_STATE_KEY];
  if (typeof filing === "string") return filing;
  const routedFrom = state[ROUTED_FROM_STATE_KEY];
  return typeof routedFrom === "string" ? routedFrom : undefined;
}
