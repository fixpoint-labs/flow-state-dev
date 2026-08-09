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
import { mintStorageGeneration } from "../../stores/scope-keys";

export interface EnsureWebhookSessionArgs {
  stores: StoreRegistry;
  sessionId: string;
  flowKind: string;
  principal: ResolvedPrincipal;
  provider: string;
  eventType: string | null;
}

/** Create the session row for a webhook delivery if it doesn't already exist. */
export async function ensureSessionForWebhook(args: EnsureWebhookSessionArgs): Promise<void> {
  const { stores, sessionId, flowKind, principal, provider, eventType } = args;
  const existing = await stores.session.get(sessionId);
  if (existing !== undefined) return;

  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind,
      userId: principal.userId,
      ...(principal.orgId !== undefined ? { orgId: principal.orgId } : {}),
      state: {},
      storageGeneration: mintStorageGeneration(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      journal: [],
      metadata: {
        source: "webhook",
        provider,
        ...(eventType !== null ? { eventType } : {})
      }
    },
    "any"
  );
}
