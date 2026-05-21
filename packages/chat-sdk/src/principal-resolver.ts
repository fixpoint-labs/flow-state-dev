/**
 * Default principal resolver for chat events.
 *
 * Maps a Chat SDK author to a stable `${platform}:${author.userId}` userId.
 * Adapter authors can override by supplying `resolvePrincipal` on
 * `ChatAdapterOptions`. Throws `PrincipalResolutionError(401)` only when
 * no usable identity exists — actions and modal submits carry their own
 * `actionValue.user` payload that we accept as a fallback.
 */
import type { ResolvedPrincipal } from "@flow-state-dev/server";
import { PrincipalResolutionError } from "@flow-state-dev/server";
import type { ChatInboundEvent } from "./types";

export function resolvePrincipalFromEvent(
  event: ChatInboundEvent
): ResolvedPrincipal {
  const platform = event.platform;
  const author = event.message?.author;
  if (author !== undefined && typeof author?.userId === "string") {
    return { userId: `${platform}:${author.userId}` };
  }
  // Action / modal payloads carry their own user reference.
  const actionUser = extractActionUser(event.actionValue);
  if (actionUser !== undefined) {
    return { userId: `${platform}:${actionUser}` };
  }
  throw new PrincipalResolutionError(
    "Cannot resolve principal from chat event: no author or action user.",
    { status: 401 }
  );
}

function extractActionUser(actionValue: unknown): string | undefined {
  if (actionValue === null || typeof actionValue !== "object") return undefined;
  const user = (actionValue as { user?: unknown }).user;
  if (user === null || typeof user !== "object") return undefined;
  const id = (user as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}
