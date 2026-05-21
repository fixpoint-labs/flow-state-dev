/**
 * Session upsert for chat-originated requests.
 *
 * Sessions in FSD are identified by an opaque id; the Chat SDK already
 * canonicalizes a thread to a stable cross-platform string (e.g.
 * `"slack:C123:1234567890.123456"`), so we reuse it verbatim. The first
 * inbound event for a thread creates the session; subsequent events on
 * the same thread reuse it.
 *
 * Concurrency: the write uses `expectedVersion: "any"` (unconditional),
 * so two near-simultaneous first events for the same thread will both
 * succeed and the second write wins on the metadata. That's acceptable
 * here because the metadata fields written (platform / threadId / isDM)
 * are derived from the same `thread.id`, so the second write produces
 * identical metadata except possibly `userId` if the two messages came
 * from different authors. In that case the session ends up bound to the
 * second author; the runtime's per-request CAS-protected journal updates
 * keep individual request records correct regardless of which author the
 * session row settled on. If a stricter "first writer wins" guarantee is
 * needed later, the store would need to expose a `setIfAbsent` variant.
 */
import type { ResolvedPrincipal } from "@flow-state-dev/server";
import type { StoreRegistry } from "@flow-state-dev/server";
import type { ChatInboundEvent } from "./types";

export interface EnsureSessionArgs {
  stores: StoreRegistry;
  sessionId: string;
  flowKind: string;
  principal: ResolvedPrincipal;
  event: ChatInboundEvent;
}

export async function ensureSessionForChat(args: EnsureSessionArgs): Promise<void> {
  const { stores, sessionId, flowKind, principal, event } = args;
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
      version: 1,
      createdAt: now,
      updatedAt: now,
      journal: [],
      metadata: {
        source: "chat",
        platform: event.platform,
        threadId: event.thread?.id ?? sessionId,
        isDM: event.thread?.isDM ?? false,
      },
    },
    "any"
  );
}
