/**
 * Session upsert for webhook-originated requests.
 *
 * A webhook has no thread to key on, so the session id is whatever the flow's
 * binding/route derived (e.g. `customer-cus_123`). The first delivery for that
 * id creates the session; subsequent deliveries reuse it. Mirrors
 * `ensureSessionForChat` in `@flow-state-dev/chat-sdk`.
 *
 * Concurrency: the write uses `expectedVersion: "any"` (unconditional), so two
 * near-simultaneous first deliveries for the same id both succeed and the
 * second wins on metadata — acceptable because the metadata is derived from
 * the same delivery target. Per-request CAS-protected journal updates keep
 * individual request records correct regardless.
 */
import type { ResolvedPrincipal } from "../types";
import type { StoreRegistry } from "../../stores/types";

export interface EnsureWebhookSessionArgs {
  stores: StoreRegistry;
  sessionId: string;
  flowKind: string;
  principal: ResolvedPrincipal;
  provider: string;
  eventType: string | null;
}

/** Create the session row for a webhook delivery if it doesn't already exist. */
import { ensureSessionRecord } from "../../context/ensure-session-record";

export async function ensureSessionForWebhook(args: EnsureWebhookSessionArgs): Promise<void> {
  const { stores, sessionId, flowKind, principal, provider, eventType } = args;
  // One creation path (FIX-1068): it mints the lineage id and writes
  // create-if-absent, neither of which this resolver should be deciding.
  const now = Date.now();
  await ensureSessionRecord(stores, sessionId, () => ({
      id: sessionId,
      flowKind,
      userId: principal.userId,
      ...(principal.orgId !== undefined ? { orgId: principal.orgId } : {}),
      state: {},
      version: 1,
      createdAt: now,
      updatedAt: now,
      journal: [],
      metadata: {
        source: "webhook",
        provider,
        ...(eventType !== null ? { eventType } : {})
      }
  }));
}
