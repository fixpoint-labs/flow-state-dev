/**
 * Owner-private collections: the one module that decides who reads a row
 * keyed to an owner, and which collections may sit beside one.
 *
 * A collection declaring `ownerPrivate: { param }` keys each row with
 * `ownerSegment(userId)` (`~` plus the escaped user id) at that parameter.
 * Two fences keep those rows with their owner.
 *
 * **The key fence** ({@link ownerKeyAdmits}) is always on. A key's first
 * segment beginning `~` is its owner, read off the key alone, so every process
 * over the store agrees on it whatever it registered. A key with one is served
 * only through an owner-private collection whose owner parameter sits at that
 * segment, and only to the user the segment encodes. Every other collection
 * lists and counts without it, reads it as absent and is refused on write.
 * Every read path asks it: the resource handle, the request-start seed cache
 * ({@link ownerKeyMaySeed}), projected collections, the browser resource
 * routes, `/state` and the debug endpoints.
 *
 * **The startup fence** ({@link admitOwnerPrivateCollections}) arms once a
 * registry holds a flow declaring an owner-private collection. From then on
 * it refuses any flow declaring another collection in the same scope whose
 * pattern can reach those keys, checking the flows already held and every
 * later one, and it never disarms. A registry that never holds one refuses
 * nothing on this account.
 */
import { ownerSegment } from "@flow-state-dev/core/types";
import { isCollectionConfig } from "./is-collection-config";

/**
 * The refusal a fenced key gets on a write or a by-name `get`. It does not say
 * whether the row exists.
 */
export const OWNER_ROW_REFUSAL = "A row of an owner-private collection is readable only by the user it belongs to.";

/** An owner-private declaration as registration compares it. */
export interface OwnerPrivateDeclaration {
  pattern: string;
  param: string;
  scope: unknown;
}

/** A collection entry as the fences read it: a pattern, a scope, maybe a declaration. */
type CollectionEntry = { pattern: string; scope?: unknown; ownerPrivate?: unknown };

/** The key's first segment beginning `~`, which names its owner, or `undefined`. */
function ownerSegmentOf(storageKey: string): { index: number; segment: string } | undefined {
  if (!storageKey.includes("~")) return undefined;
  const segments = storageKey.split("/");
  const index = segments.findIndex((segment) => segment.startsWith("~"));
  return index === -1 ? undefined : { index, segment: segments[index]! };
}

/** The declared owner parameter, or `undefined` when the collection is not owner-private. */
function ownerParamOf(collection: object): string | undefined {
  const declaration = (collection as { ownerPrivate?: unknown }).ownerPrivate;
  if (declaration === undefined || declaration === null) return undefined;
  const param = (declaration as { param?: unknown }).param;
  // A declaration with no usable parameter still marks the collection
  // owner-private; it matches no segment, so it serves nothing.
  return typeof param === "string" ? param : "";
}

/**
 * Whether `userId` may read or write the row at `storageKey` through
 * `collection`. The one key predicate.
 *
 * A collection that is not owner-private is admitted every key with no
 * segment beginning `~`, and none with one. An owner-private collection is
 * admitted a key only when its first `~` segment sits at the owner parameter
 * and is `ownerSegment(userId)`; a later `~` segment is data. With no user,
 * it is admitted nothing.
 */
export function ownerKeyAdmits(collection: object, storageKey: string, userId: string | undefined): boolean {
  const owner = ownerSegmentOf(storageKey);
  const param = ownerParamOf(collection);
  if (param === undefined) return owner === undefined;
  if (owner === undefined || userId === undefined || userId.length === 0) return false;
  const pattern = (collection as { pattern?: unknown }).pattern;
  if (typeof pattern !== "string") return false;
  return owner.index === pattern.split("/").indexOf(`[${param}]`) && owner.segment === ownerSegment(userId);
}

/**
 * Whether a row read from the store may enter a run's cache for `userId`:
 * every key except one whose owner segment names another user.
 *
 * Collections load by prefix, so a wide collection's scan sweeps up every
 * owner's rows. The handles fence them again through {@link ownerKeyAdmits},
 * but the cache has other readers (a `contentTemplateRef` resolves against it
 * by storage key), so another user's row never enters it. The caller's own
 * rows do: an owner-private collection serves them from the same cache.
 */
export function ownerKeyMaySeed(storageKey: string, userId: string | undefined): boolean {
  const owner = ownerSegmentOf(storageKey);
  if (owner === undefined) return true;
  if (userId === undefined || userId.length === 0) return false;
  return owner.segment === ownerSegment(userId);
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
  const param = ownerParamOf(entry);
  return param === undefined ? undefined : { pattern: entry.pattern, param, scope: entry.scope };
}

function sameDeclaration(left: OwnerPrivateDeclaration, right: OwnerPrivateDeclaration): boolean {
  return left.pattern === right.pattern && left.param === right.param && left.scope === right.scope;
}

/** Throw when `entry` reaches one of `declarations` in its scope and is not that declaration. */
function refuseReach(entry: CollectionEntry, declarations: readonly OwnerPrivateDeclaration[], heldBy?: string): void {
  const own = declarationOf(entry);
  for (const declaration of declarations) {
    if (entry.scope !== declaration.scope) continue;
    if (own !== undefined && sameDeclaration(own, declaration)) continue;
    if (!patternsReach(entry.pattern, declaration.pattern)) continue;
    throw new Error(
      `Collection pattern "${entry.pattern}" can reach the rows of owner-private collection "${declaration.pattern}". ` +
        `Only that collection reads or writes them, each for the user it belongs to.` +
        (heldBy === undefined ? "" : ` Flow "${heldBy}" declares it and is already registered.`)
    );
  }
}

/**
 * The startup fence, for one registration.
 *
 * `known` is every owner-private declaration the registry has admitted, kept
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
