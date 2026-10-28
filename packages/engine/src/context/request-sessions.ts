/**
 * The request host's session read (FIX-2160 D2): a running request checks a
 * target session before it writes anything to it.
 *
 * The rule is the dispatch seam's own (`resolveExistingSession` in
 * `./create-request-host`): another user's or tenant's session, and one bound
 * to another org, are not this principal's. Here every one of them, and a
 * session that doesn't exist, answers `undefined`, so the read is no existence
 * oracle. The flow is not checked: the caller asks which flow it runs.
 *
 * What crosses is the flow and the state the session's flow declares
 * readonly (server-written markers, as the HTTP session list's state filter
 * keeps them), never the record.
 */
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import type { FlowInstance, RequestSessions, SessionView } from "@flow-state-dev/core/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { SessionRecord, SessionStore } from "../stores/types";

export type RequestSessionsInputs = {
  sessions: Pick<SessionStore, "get">;
  /** Server-derived identity of the running request. */
  identity: { userId: string; tenantId: string | undefined; orgId: string };
  /** The running request's flow. */
  flow: FlowInstance;
  /** Another flow instance registered in this process, by its exact address. */
  resolveFlow?: (address: string) => FlowInstance | undefined;
};

export function createRequestSessions(inputs: RequestSessionsInputs): RequestSessions {
  const { sessions, identity, flow } = inputs;
  const flowAt = (address: string): FlowInstance | undefined =>
    address === flow.id ? flow : inputs.resolveFlow?.(address);

  return {
    async read(sessionId: string): Promise<SessionView | undefined> {
      if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
      const record: SessionRecord | undefined = await sessions.get(
        resolveSessionStorageKey(sessionId, identity.tenantId)
      );
      if (
        record === undefined ||
        record.userId !== identity.userId ||
        (record.tenantId ?? undefined) !== identity.tenantId ||
        (record.orgId ?? undefined) !== identity.orgId
      ) {
        return undefined;
      }
      // The owner as `record-owner` reads it: the stored instance id, or, on a
      // legacy row, the singleton named by its kind. A flow of another kind
      // under that address is not its owner, and declares nothing for it.
      const owner = flowAt(record.flowId ?? record.flowKind);
      const readonly = owner?.kind === record.flowKind ? getReadonlyStateKeys(owner.session?.stateSchema) : [];
      const state: Record<string, unknown> = {};
      for (const key of readonly) {
        if (Object.prototype.hasOwnProperty.call(record.state, key)) state[key] = structuredClone(record.state[key]);
      }
      return {
        flowKind: record.flowKind,
        ...(record.flowId != null ? { flowId: record.flowId } : {}),
        state: Object.freeze(state),
      };
    },
  };
}
