/**
 * Session upsert for chat-originated requests.
 *
 * Sessions in FSD are identified by an opaque id; the Chat SDK already
 * canonicalizes a thread to a stable cross-platform string (e.g.
 * `"slack:C123:1234567890.123456"`), so we reuse it verbatim. The first
 * inbound event for a thread creates the session; subsequent events on
 * the same thread reuse it. Concurrent first-message races (two replies
 * land at once) are resolved by treating a 409 on `set` as "already
 * created" and proceeding.
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
