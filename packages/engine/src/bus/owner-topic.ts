/**
 * The change topic a read across an owner's sessions is heard on: one per
 * collection per owner (user, organization and tenant). Every write to any
 * session's copy of the collection publishes there, so a view hears a row
 * filed in a session made after it ran.
 *
 * - **On the wire** it is the user topic narrowed to `/sessions/<root>`,
 *   `<root>` the collection's static prefix. A storage path never begins
 *   with `/` (`normalizeResourcePath`), so no resource notice under the user
 *   topic can be taken for it. The mint grants it from the verified
 *   principal's user and organization ({@link isChangeTopicResource}), never
 *   from anything the client names.
 * - **On the bus** it is a topic of its own scope, `owner`, whose id names
 *   the user and the organization. The user topic spans the user's
 *   organizations, so a subscriber to it, narrowed or not, must never hear
 *   this one; a scope of its own keeps the two apart for any user id.
 * - **A notice names no session.** It carries the session written as its
 *   `partition`, raw on the bus, which the push edge sends only as a keyed
 *   digest (`push/partition-key.ts`), and no ids. A view hearing it reads
 *   again; it never learns which session changed.
 */
import type { BusTopic } from "./types";

/** What every change topic's wire resource begins with. */
const CHANGE_TOPIC_PREFIX = "/sessions/";

/** The wire resource of the change topic for the collection whose static prefix is `root`. */
export function changeTopicResource(root: string): string {
  return `${CHANGE_TOPIC_PREFIX}${root}`;
}

/** Whether a wire resource names a change topic, not a storage path under the user scope. */
export function isChangeTopicResource(resource: string | undefined): resource is string {
  return resource !== undefined && resource.startsWith(CHANGE_TOPIC_PREFIX);
}

/** The bus id of an owner's change topics: the user and the organization, unambiguous for any two strings. */
function ownerTopicId(userId: string, orgId: string | undefined): string {
  return JSON.stringify([userId, orgId ?? null]);
}

/** The bus topic of `owner`'s change topic for the collection whose static prefix is `root`. */
export function ownerTopic(owner: { userId: string; orgId: string | undefined; tenantId: string | undefined }, root: string): BusTopic {
  return ownerTopicFor(owner, changeTopicResource(root));
}

/** The bus topic of `owner`'s change topic whose wire resource is `resource`. */
export function ownerTopicFor(
  owner: { userId: string; orgId: string | undefined; tenantId: string | undefined },
  resource: string
): BusTopic {
  return { scope: "owner", id: ownerTopicId(owner.userId, owner.orgId), tenantId: owner.tenantId ?? "", resource };
}
