/**
 * The change topics a read across an owner's sessions is heard on: one per
 * collection pattern per owner (user, organization and tenant). Every write to
 * any session's copy of a session resource publishes one owner notice, and
 * every subscription whose collection pattern covers the written key hears
 * it, so a view hears a row filed in a session made after it ran, whatever
 * the writer's flow declares.
 *
 * - **On the wire** a change topic is the user topic narrowed to
 *   `/sessions/<pattern>`, the collection's declared pattern. A storage path
 *   never begins with `/` (`normalizeResourcePath`), so no resource notice
 *   under the user topic can be taken for it. The mint grants it from the
 *   verified principal's user and organization ({@link isChangeTopicResource}),
 *   never from anything the client names.
 * - **On the bus** an owner notice is on a topic of its own scope, `owner`,
 *   whose id names the user and the organization; the user topic spans the
 *   user's organizations, so its subscribers must never hear one. The notice
 *   carries the written storage key as its one id, raw: the bus is the
 *   server's own. A writer can't know which patterns a reader declares (a
 *   writer's `notes/**` and a reader's `notes/shared/*` are different
 *   declarations), so the match is made where the notice is delivered
 *   ({@link changeTopicHears}), never by the writer.
 * - **A notice names no session and no key to a client.** The socket sends
 *   it on the subscription's own wire topic with no ids; its `partition`, the
 *   session written, goes out only as a keyed digest (`push/partition-key.ts`).
 *   A view hearing it reads again; it never learns which session or row changed.
 */
import { matchesPattern } from "@flow-state-dev/core/types";
import type { BusTopic, ChangeNotice } from "./types";

/** What every change topic's wire resource begins with. */
const CHANGE_TOPIC_PREFIX = "/sessions/";

/** The wire resource of the change topic for the collection declared at `pattern`. */
export function changeTopicResource(pattern: string): string {
  return `${CHANGE_TOPIC_PREFIX}${pattern}`;
}

/** Whether a wire resource names a change topic, not a storage path under the user scope. */
export function isChangeTopicResource(resource: string | undefined): resource is string {
  return resource !== undefined && resource.startsWith(CHANGE_TOPIC_PREFIX);
}

/** The bus id of an owner's change topics: the user and the organization, unambiguous for any two strings. */
function ownerTopicId(userId: string, orgId: string | undefined): string {
  return JSON.stringify([userId, orgId ?? null]);
}

type Owner = { userId: string; orgId: string | undefined; tenantId: string | undefined };

/** The bus topic every owner notice of `owner` is published on, and every subscription of theirs listens to. */
export function ownerTopic(owner: Owner): BusTopic {
  return { scope: "owner", id: ownerTopicId(owner.userId, owner.orgId), tenantId: owner.tenantId ?? "" };
}

/**
 * A change topic of `owner`'s as a ticket grants it: the owner topic, narrowed
 * to the wire resource the client asked for. The socket subscribes the bare
 * owner topic and matches each notice against the resource's pattern
 * ({@link changeTopicHears}).
 */
export function ownerSubscription(owner: Owner, resource: string): BusTopic {
  return { ...ownerTopic(owner), resource };
}

/**
 * The owner notice a write to `storageKey` in session `sessionId` publishes:
 * the key as its one id, the session as its partition.
 */
export function ownerNotice(owner: Owner, sessionId: string, storageKey: string, requestId?: string): ChangeNotice {
  return {
    topic: ownerTopic(owner),
    kind: "resource",
    ids: [storageKey],
    partition: sessionId,
    ...(requestId !== undefined ? { origin: { requestId } } : {})
  };
}

/**
 * Whether the change topic at wire resource `resource` hears `notice`: a
 * written key its pattern covers. A notice whose keys were folded away (more
 * than a notice carries) is heard by every change topic: an extra read is
 * allowed, a missed one is the failure.
 */
export function changeTopicHears(resource: string, notice: ChangeNotice): boolean {
  const pattern = resource.slice(CHANGE_TOPIC_PREFIX.length);
  return notice.ids === undefined || notice.ids.some((key) => matchesPattern(pattern, key));
}
