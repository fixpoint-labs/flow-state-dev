/**
 * Session upsert for webhook-originated requests.
 *
 * A webhook has no thread to key on, so the session id is whatever the flow's
 * binding/route derived (e.g. `customer-cus_123`). The first delivery for that
 * id creates the session; subsequent deliveries reuse it.
 *
 * Concurrency: the write is create-if-absent through the one birth function,
 * so of two near-simultaneous first deliveries for the same id one creates the
 * session and the other adopts it. Per-request CAS-protected journal updates
 * keep individual request records correct regardless.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ResolvedPrincipal } from "../types";
import type { StoreRegistry } from "../../stores/types";
import { ensureSessionRecord } from "../../context/session-birth";

export interface EnsureWebhookSessionArgs {
  stores: StoreRegistry;
  sessionId: string;
  /** The resolved instance — never the URL address. */
  flow: FlowInstance;
  principal: ResolvedPrincipal;
  provider: string;
  eventType: string | null;
}

/**
 * Create the session row for a webhook delivery if it doesn't already exist.
 *
 * @throws SessionCreateRefusedError when the flow refuses the create: a
 *   webhook carries no initial state, so a flow whose sessions need some (a
 *   required field, or a create check that wants one) gets no session here.
 */
export async function ensureSessionForWebhook(args: EnsureWebhookSessionArgs): Promise<void> {
  const { stores, sessionId, flow, principal, provider, eventType } = args;
  // The one birth function: it checks the create, mints the lineage id and
  // writes create-if-absent, none of which this resolver should be deciding.
  const now = Date.now();
  await ensureSessionRecord(
    stores,
    sessionId,
    {
      flow,
      sessionId,
      principal: { userId: principal.userId, orgId: principal.orgId },
      fromCaller: false,
      via: "webhook"
    },
    () => ({
      id: sessionId,
      flowKind: flow.kind,
      flowId: flow.id,
      userId: principal.userId,
      ...(principal.orgId !== undefined ? { orgId: principal.orgId } : {}),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
      metadata: {
        source: "webhook",
        provider,
        ...(eventType !== null ? { eventType } : {})
      }
    })
  );
}
