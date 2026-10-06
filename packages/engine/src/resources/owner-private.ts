/**
 * Owner-keyed collections: the one module that decides who reads and who
 * writes a row keyed to an owner, and which collections may sit beside one.
 *
 * A collection declaring `ownerPrivate: { param }` keys each row with
 * `ownerSegment(userId)` (`~` plus the escaped user id) at that parameter.
 * Two fences keep those rows with their owner.
 *
 * **The key fence** ({@link ownerKeyAdmits}) is always on. A key's first
 * segment beginning `~` is its owner, read off the key alone, so every process
 * over the store agrees on it whatever it registered. A key with one is served
 * only through an owner-keyed collection whose owner parameter sits at that
 * segment (an owner-private one: only to the user it encodes). Every other collection
 * lists and counts without it, reads it as absent and is refused on write.
 * Every read path asks it: the resource handle, the request-start seed cache
 * ({@link ownerKeyMaySeed}), projected collections, the browser resource
 * routes, `/state` and the debug endpoints.
 *
 * **The startup fence** ({@link admitOwnerPrivateCollections}) arms once a
 * registry holds a flow declaring an owner-keyed collection. From then on
 * it refuses any flow declaring another collection in the same scope whose
 * pattern can reach those keys, checking the flows already held and every
 * later one, and it never disarms. A registry that never holds one refuses
 * nothing on this account.
 *
 * Every registry, armed or not, also refuses a single resource whose storage
 * key has a segment beginning `~` ({@link refuseOwnerMarkedSingleResources}).
 * A single resource's key is the same for every caller, so it can never be
 * the owner's own, and the key fence above only guards collections.
 *
 * **Owner-writes collections** (`ownerWrites: { param }`) share the key shape
 * and both fences, with one difference: every read path admits their rows to
 * anyone the scope serves, and only a write needs the owner
 * ({@link ownerWriteRefusal}). Since a reader holds a ref it could write
 * through, the write check also runs where every write of a run meets the
 * store ({@link ownerWritesRefusalForKey}), and the seed cache admits other
 * users' rows of such a collection ({@link ownerKeyMaySeed}).
 */
import { matchesPattern, ownerSegment } from "@flow-state-dev/core/types";
import { isCollectionConfig } from "./is-collection-config";
import { resourceStorageKeys } from "./storage-keys";

/**
 * The refusal a fenced key gets on a write or a by-name `get`. It does not say
 * whether the row exists.
 */
export const OWNER_ROW_REFUSAL = "A row of an owner-private collection is readable only by the user it belongs to.";

/**
 * The refusal another user's write to an owner-writes row gets. The row is
 * readable, so naming the rule reveals nothing a read wouldn't.
 */
export const OWNER_WRITE_REFUSAL = "A row of an owner-writes collection is written only by the user it belongs to.";

/** Which owner rule a collection declares. */
type OwnerMode = "private" | "writes";

/** An owner-keyed declaration (either mode) as registration compares it. */
export interface OwnerPrivateDeclaration {
  pattern: string;
  param: string;
  scope: unknown;
  mode: OwnerMode;
}

/** A collection entry as the fences read it: a pattern, a scope, maybe a declaration. */
type CollectionEntry = { pattern: string; scope?: unknown; ownerPrivate?: unknown; ownerWrites?: unknown };

/** The key's first segment beginning `~`, which names its owner, or `undefined`. */
function ownerSegmentOf(storageKey: string): { index: number; segment: string } | undefined {
  if (!storageKey.includes("~")) return undefined;
  const segments = storageKey.split("/");
  const index = segments.findIndex((segment) => segment.startsWith("~"));
  return index === -1 ? undefined : { index, segment: segments[index]! };
}

/**
 * The declared owner rule, or `undefined` when the collection declares none.
 * A declaration with no usable parameter still marks the collection; it
 * matches no segment, so it serves nothing.
 */
function ownerRuleOf(collection: object): { mode: OwnerMode; param: string } | undefined {
  const declared = collection as { ownerPrivate?: unknown; ownerWrites?: unknown };
  const mode: OwnerMode | undefined =
    declared.ownerPrivate !== undefined && declared.ownerPrivate !== null
      ? "private"
      : declared.ownerWrites !== undefined && declared.ownerWrites !== null
        ? "writes"
        : undefined;
  if (mode === undefined) return undefined;
  const param = (declared[mode === "private" ? "ownerPrivate" : "ownerWrites"] as { param?: unknown }).param;
  return { mode, param: typeof param === "string" ? param : "" };
}

/** Whether the key's owner segment sits at the collection's owner parameter. */
function ownerAtParam(collection: object, owner: { index: number }, param: string): boolean {
  const pattern = (collection as { pattern?: unknown }).pattern;
  if (typeof pattern !== "string") return false;
  return owner.index === pattern.split("/").indexOf(`[${param}]`);
}

/**
 * Whether `userId` may read the row at `storageKey` through `collection`. The
 * one read predicate; a write asks {@link ownerWriteRefusal}.
 *
 * A collection with no owner rule is admitted every key with no segment
 * beginning `~`, and none with one. An owner-keyed collection is admitted a
 * key only when its first `~` segment sits at the owner parameter; a later
 * `~` segment is data. An owner-private one also needs that segment to be
 * `ownerSegment(userId)`, so with no user it is admitted nothing. An
 * owner-writes one serves the row to anyone the scope serves.
 */
export function ownerKeyAdmits(collection: object, storageKey: string, userId: string | undefined): boolean {
  const owner = ownerSegmentOf(storageKey);
  const rule = ownerRuleOf(collection);
  if (rule === undefined) return owner === undefined;
  if (owner === undefined || !ownerAtParam(collection, owner, rule.param)) return false;
  if (rule.mode === "writes") return true;
  if (userId === undefined || userId.length === 0) return false;
  return owner.segment === ownerSegment(userId);
}

/**
 * Why `userId` may not write the row at `storageKey` through `collection`, or
 * `undefined` when it may. A key the read predicate refuses gets
 * {@link OWNER_ROW_REFUSAL}, which does not say whether the row exists. A
 * readable owner-writes row whose owner segment is not `ownerSegment(userId)`
 * gets {@link OWNER_WRITE_REFUSAL}.
 */
export function ownerWriteRefusal(
  collection: object,
  storageKey: string,
  userId: string | undefined
): string | undefined {
  if (!ownerKeyAdmits(collection, storageKey, userId)) return OWNER_ROW_REFUSAL;
  if (ownerRuleOf(collection)?.mode !== "writes") return undefined;
  if (userId === undefined || userId.length === 0) return OWNER_WRITE_REFUSAL;
  return ownerSegmentOf(storageKey)!.segment === ownerSegment(userId) ? undefined : OWNER_WRITE_REFUSAL;
}

/** The owner-writes collection among `collections` that reads `storageKey`, if any. */
function ownerWritesCollectionFor(collections: Iterable<unknown>, storageKey: string): object | undefined {
  for (const collection of collections) {
    if (!isCollectionConfig(collection)) continue;
    if (ownerRuleOf(collection)?.mode !== "writes") continue;
    if (!matchesPattern(collection.pattern, storageKey)) continue;
    if (ownerKeyAdmits(collection, storageKey, undefined)) return collection;
  }
  return undefined;
}

/**
 * The refusal for a run's write at `storageKey`, judged against the
 * collections the run declared, or `undefined`. Only owner-writes rows are
 * judged here: a ref to one can be held by any reader, so the store write is
 * the one place every write meets. Other owner keys never reach a ref the
 * handle fence did not admit.
 */
export function ownerWritesRefusalForKey(
  collections: Iterable<unknown>,
  storageKey: string,
  userId: string | undefined
): string | undefined {
  if (ownerSegmentOf(storageKey) === undefined) return undefined;
  const collection = ownerWritesCollectionFor(collections, storageKey);
  return collection === undefined ? undefined : ownerWriteRefusal(collection, storageKey, userId);
}

/**
 * Whether a row read from the store may enter a run's cache for `userId`:
 * every key except one whose owner segment names another user, unless one of
 * the run's owner-writes `collections` reads it.
 *
 * Collections load by prefix, so a wide collection's scan sweeps up every
 * owner's rows. The handles fence them again through {@link ownerKeyAdmits},
 * but the cache has other readers (a `contentTemplateRef` resolves against it
 * by storage key), so another user's owner-private row never enters it. The
 * caller's own rows do, and so does any owner-writes row: those collections
 * serve them from the same cache.
 */
export function ownerKeyMaySeed(
  storageKey: string,
  userId: string | undefined,
  collections: Iterable<unknown> = []
): boolean {
  const owner = ownerSegmentOf(storageKey);
  if (owner === undefined) return true;
  if (userId !== undefined && userId.length > 0 && owner.segment === ownerSegment(userId)) return true;
  return ownerWritesCollectionFor(collections, storageKey) !== undefined;
}

/** A segment the key matcher reads as one segment of anything: `*` or any bracketed segment. */
function segmentIsOpen(segment: string): boolean {
  return segment === "*" || /^\[.+\]$/.test(segment);
}

/**
 * Whether two patterns can resolve onto one key, segment by segment: a
 * literal meets an equal literal, a parameter or `*` meets any segment, and a
 * `**` meets whatever is left, as long as something is.
 */
function patternsReach(left: string, right: string): boolean {
  const a = left.split("/");
  const b = right.split("/");
  for (let i = 0; ; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined && y === undefined) return true;
    if (x === undefined || y === undefined) return false;
    if (x === "**" || y === "**") return true;
    if (x !== y && !segmentIsOpen(x) && !segmentIsOpen(y)) return false;
  }
}

/** The collection entries of a flow's resources. */
function collectionEntries(resources: Record<string, unknown> | undefined): CollectionEntry[] {
  return resources === undefined ? [] : Object.values(resources).filter(isCollectionConfig);
}

function declarationOf(entry: CollectionEntry): OwnerPrivateDeclaration | undefined {
  const rule = ownerRuleOf(entry);
  return rule === undefined ? undefined : { pattern: entry.pattern, param: rule.param, scope: entry.scope, mode: rule.mode };
}

function sameDeclaration(left: OwnerPrivateDeclaration, right: OwnerPrivateDeclaration): boolean {
  return (
    left.pattern === right.pattern &&
    left.param === right.param &&
    left.scope === right.scope &&
    left.mode === right.mode
  );
}

/** Throw when `entry` reaches one of `declarations` in its scope and is not that declaration. */
function refuseReach(entry: CollectionEntry, declarations: readonly OwnerPrivateDeclaration[], heldBy?: string): void {
  const own = declarationOf(entry);
  for (const declaration of declarations) {
    if (entry.scope !== declaration.scope) continue;
    if (own !== undefined && sameDeclaration(own, declaration)) continue;
    if (!patternsReach(entry.pattern, declaration.pattern)) continue;
    throw new Error(
      `Collection pattern "${entry.pattern}" can reach the rows of owner-${declaration.mode} collection "${declaration.pattern}". ` +
        (declaration.mode === "private"
          ? `Only that collection reads or writes them, each for the user it belongs to.`
          : `Only that collection reads or writes them.`) +
        (heldBy === undefined ? "" : ` Flow "${heldBy}" declares it and is already registered.`)
    );
  }
}

/**
 * Refuse a flow declaring a single resource whose storage key has a segment
 * beginning `~`, in every registry, whether or not it holds an owner-private
 * collection.
 *
 * Such a segment names the user an owner-private collection's row belongs to.
 * A single resource's key is the same for every user, so it cannot hold one
 * legitimately, and one that did would read and write that row for anyone.
 * The key is the one the runtime writes ({@link resourceStorageKeys}): the
 * `ref`, else the first accessor the definition is declared under. Throws
 * before the caller mutates anything.
 */
export function refuseOwnerMarkedSingleResources(incoming: { resources?: Record<string, unknown> }): void {
  const storageKeys = resourceStorageKeys(incoming.resources);
  for (const [accessor, entry] of Object.entries(incoming.resources ?? {})) {
    if (isCollectionConfig(entry)) continue;
    const key = storageKeys[accessor] ?? accessor;
    if (ownerSegmentOf(key) === undefined) continue;
    throw new Error(
      `Resource "${accessor}" has storage key "${key}", with a segment beginning "~". ` +
        `That segment is reserved for the user an owner-private collection's row belongs to, ` +
        `and a single resource's key is the same for every user.`
    );
  }
}

/**
 * The startup fence, for one registration.
 *
 * `known` is every owner-keyed declaration the registry has admitted, kept
 * for good. When it is empty and the incoming flow declares none, nothing is
 * checked. Otherwise every collection of the incoming flow is checked against
 * every declaration, and every held flow is checked against each declaration
 * the incoming flow adds, and a refusal there names the held flow. The same
 * declaration (pattern, parameter and scope) on several flows is one
 * collection and is admitted. Throws before the caller mutates anything.
 *
 * @returns the declarations the registry holds once this flow is admitted.
 */
export function admitOwnerPrivateCollections(
  incoming: { resources?: Record<string, unknown> },
  held: Iterable<{ id: string; resources?: Record<string, unknown> }>,
  known: readonly OwnerPrivateDeclaration[]
): readonly OwnerPrivateDeclaration[] {
  const entries = collectionEntries(incoming.resources);
  const added: OwnerPrivateDeclaration[] = [];
  for (const entry of entries) {
    const declaration = declarationOf(entry);
    if (declaration === undefined) continue;
    if ([...known, ...added].some((prior) => sameDeclaration(prior, declaration))) continue;
    added.push(declaration);
  }
  if (known.length === 0 && added.length === 0) return known;
  const all = [...known, ...added];
  for (const entry of entries) refuseReach(entry, all);
  if (added.length > 0) {
    for (const flow of held) {
      for (const entry of collectionEntries(flow.resources)) refuseReach(entry, added, flow.id);
    }
  }
  return added.length === 0 ? known : all;
}
