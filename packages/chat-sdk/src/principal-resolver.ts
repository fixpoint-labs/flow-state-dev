/**
 * Default principal resolver for chat events.
 *
 * Three lookup paths, in priority order:
 *   1. `message.author.userId` — present for mention / DM / subscribed /
 *      pattern-match events.
 *   2. `event.principalUser.userId` — populated by per-callback handlers
 *      for events that don't carry a `Message` (slash commands, assistant
 *      thread started, member joined, button actions).
 *   3. `event.actionValue.user.{userId|id}` — legacy fallback for older
 *      action-shaped payloads where the user travels inside the value.
 *
 * Throws `PrincipalResolutionError(401)` when none of these is available.
 * Adapter authors with stricter requirements should pass a custom
 * `resolvePrincipal` to `createChatTransportAdapter`.
 */
import type { ResolvedPrincipal } from "@flow-state-dev/engine";
import { PrincipalResolutionError } from "@flow-state-dev/engine";
import type { ChatInboundEvent } from "./types";

export function resolvePrincipalFromEvent(
  event: ChatInboundEvent
): ResolvedPrincipal {
  const platform = event.platform;
  const author = event.message?.author;
  if (author !== undefined && typeof author?.userId === "string") {
    return { userId: `${platform}:${author.userId}` };
  }
  if (typeof event.principalUser?.userId === "string") {
    return { userId: `${platform}:${event.principalUser.userId}` };
  }
  const actionUser = extractActionUser(event.actionValue);
  if (actionUser !== undefined) {
    return { userId: `${platform}:${actionUser}` };
  }
  throw new PrincipalResolutionError(
    "Cannot resolve principal from chat event: no author, principalUser, or action user.",
    { status: 401 }
  );
}

function extractActionUser(actionValue: unknown): string | undefined {
  if (actionValue === null || typeof actionValue !== "object") return undefined;
  const user = (actionValue as { user?: unknown }).user;
  if (user === null || typeof user !== "object") return undefined;
  const candidate =
    (user as { userId?: unknown }).userId ?? (user as { id?: unknown }).id;
  return typeof candidate === "string" ? candidate : undefined;
}
