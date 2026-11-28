/**
 * The change topics a read across an owner's sessions is heard on: one per
 * collection pattern per owner (user, organization and tenant). Every write to
 * any session's resources publishes one owner notice, and
 * every subscription whose collection pattern covers the written key hears
 * it, so a view hears a row filed in a session made after it ran, whatever
 * the writer's flow declares.
 *
 * - **On the wire** a change topic is the user topic narrowed to
 *   `/sessions/<view flow>/<pattern>`: the flow instance whose view read it
 *   (URI-encoded), then the collection's declared pattern. A storage path
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
 * - **Per flow instance, as the read admits it.** An owner notice is narrowed
 *   to the flow instance of the session written. The mint resolves the caller
 *   at the view's flow, as the view route did, and grants the change topic
 *   only for the instances the read's own admission admits for that
 *   principal (`namedRecordAdmission`), so a session the read leaves out, as
 *   though empty, never wakes the screen either.
 * - **A notice names no session, no key and no request to a client.** The
 *   socket sends it on the subscription's own wire topic with no ids and no
 *   origin (a request id could be fetched to tell a session that exists from
 *   one that doesn't); its `partition`, the session written, goes out only as
 *   a keyed digest (`push/partition-key.ts`). A view hearing it reads again;
 *   it never learns which session or entry changed.
 */
import { matchesPattern } from "@flow-state-dev/core/types";
import type { BusTopic, ChangeNotice } from "./types";

/** What every change topic's wire resource begins with. */
const CHANGE_TOPIC_PREFIX = "/sessions/";

/** The wire resource of the change topic for a view on flow instance `viewFlowId` reading the collection declared at `pattern`. */
export function changeTopicResource(viewFlowId: string, pattern: string): string {
  return `${CHANGE_TOPIC_PREFIX}${encodeURIComponent(viewFlowId)}/${pattern}`;
}

/** The view's flow instance and the collection pattern a change topic's wire resource names, or `undefined` for none. */
export function readChangeTopicResource(resource: string): { viewFlowId: string; pattern: string } | undefined {
  if (!isChangeTopicResource(resource)) return undefined;
  const rest = resource.slice(CHANGE_TOPIC_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;
  try {
    return { viewFlowId: decodeURIComponent(rest.slice(0, slash)), pattern: rest.slice(slash + 1) };
  } catch {
    return undefined;
  }
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

/** The bus topic `owner`'s notices of writes in sessions of flow instance `flowId` are published on. */
export function ownerTopic(owner: Owner, flowId: string): BusTopic {
  return { scope: "owner", id: ownerTopicId(owner.userId, owner.orgId), tenantId: owner.tenantId ?? "", resource: flowId };
}

/**
 * A change topic of `owner`'s as a ticket grants it, for one flow instance the
 * mint admitted: the owner topic of that instance, with the wire resource the
 * client asked for. The socket subscribes {@link ownerTopic} for the instance
 * and matches each notice against the resource's pattern ({@link changeTopicHears}).
 */
export function ownerSubscription(owner: Owner, flowId: string, resource: string): BusTopic {
  return { ...ownerTopic(owner, flowId), resource: JSON.stringify([flowId, resource]) };
}

/** What a granted {@link ownerSubscription} subscribes on the bus, and the wire resource it answers on. */
export function openOwnerSubscription(topic: BusTopic): { bus: BusTopic; resource: string } | undefined {
  if (topic.scope !== "owner" || topic.resource === undefined) return undefined;
  try {
    const [flowId, resource] = JSON.parse(topic.resource) as [unknown, unknown];
    if (typeof flowId !== "string" || !isChangeTopicResource(typeof resource === "string" ? resource : undefined)) return undefined;
    return { bus: { scope: "owner", id: topic.id, tenantId: topic.tenantId, resource: flowId }, resource: resource as string };
  } catch {
    return undefined;
  }
}

/**
 * The owner notice a write to `storageKey` in session `sessionId`, of flow
 * instance `flowId`, publishes: the key as its one id, the session as its
 * partition, and no origin.
 */
export function ownerNotice(owner: Owner, flowId: string, sessionId: string, storageKey: string): ChangeNotice {
  return { topic: ownerTopic(owner, flowId), kind: "resource", ids: [storageKey], partition: sessionId };
}

/**
 * The owner notice a session's delete publishes: the whole session changed,
 * so it names no key, and every change topic of its flow instance hears it.
 * The session is its partition.
 */
export function ownerSessionNotice(owner: Owner, flowId: string, sessionId: string): ChangeNotice {
  return { topic: ownerTopic(owner, flowId), kind: "resource", partition: sessionId };
}

/**
 * Whether the change topic at wire resource `resource` hears `notice`: a
 * written key its pattern covers. A notice whose keys were folded away (more
 * than a notice carries) is heard by every change topic: an extra read is
 * allowed, a missed one is the failure.
 */
export function changeTopicHears(resource: string, notice: ChangeNotice): boolean {
  const pattern = readChangeTopicResource(resource)?.pattern;
  if (pattern === undefined) return false;
  return notice.ids === undefined || notice.ids.some((key) => matchesPattern(pattern, key));
}
