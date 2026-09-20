/**
 * The seat reference wall — which references a seat can reach, derived from
 * where it and they sit in the tree, and narrowed by a `WORKER.md`'s
 * `references:` key.
 *
 * **One module, because this is a permission boundary**, the reason
 * `./seat-resources` is one. A reference becomes reachable in exactly one
 * place, so there is exactly one place the wall can be forgotten.
 *
 * **It is a sibling of `seat-resources`, not a copy of it.** The two answer
 * different questions and the difference is the point:
 *
 * | | `resources:` | `references:` |
 * |---|---|---|
 * | absent | reaches everything on the kind | reaches everything **at or above its place in the tree** |
 * | present | narrows | narrows, within the wall |
 * | entry shape | a ref, or `<ref>: rw` | a ref. There is no mode — nothing writes a reference |
 * | the wall | the app's install filter | derived here, from the path |
 *
 * So the mutable key has modes and no derived wall, and this one has a derived
 * wall and no modes. They share `describe()` and the shape of their refusals;
 * merging them would mean a function whose every branch asked which key it was
 * called for.
 *
 * **Width comes from the tree and from nothing else.** There is no install-side
 * override: one would make the wall optional again, which is the hole this
 * exists to close. A document that should reach more people moves up the tree.
 *
 * **A seat file selects, it never defines** (BP-031). Both inputs the wall is
 * computed from — the seat's id and each reference's ref — are minted by the
 * loader from the path on disk, never taken from anything a seat wrote. A
 * `references:` entry naming something outside the wall is refused, not
 * granted.
 */

import type { DeclaredResources } from "@flow-state-dev/core";
import { describe } from "./describe-value";
import { isReferenceDefinition } from "./references-from-docs";
import { emptyMap } from "./empty-map";

/**
 * The key a seat's file names its references under.
 *
 * Public: a person types it, and it matches the `references/` folder the
 * documents come from. Read from here by every door, never spelled as a
 * literal — a renamed key with a literal left behind is an access grant that
 * silently does not apply.
 */
export const SEAT_REFERENCES_KEY = "references";

/** The `teams/` first segment, as both a ref and a seat address use it. */
const TEAMS_LEVEL = "teams";

/** The `workers/` level inside `org/` or a team. Mirrors `loader`'s `WORKERS_LEVEL`. */
const WORKERS_LEVEL = "workers";

// ---------------------------------------------------------------------------
// Where a thing sits
// ---------------------------------------------------------------------------

/**
 * A place in the workforce tree — the only thing reachability is decided from.
 *
 * `undefined` means "not at that level", so the org level is
 * `{ team: undefined, worker: undefined }` and a team's own folder is
 * `{ team: "engineering", worker: undefined }`.
 */
export interface TreePlace {
  /** The team folder, or `undefined` at the org level. */
  team?: string;
  /** The worker folder, or `undefined` when this is not inside one. */
  worker?: string;
}

/**
 * Read a reference's ref back into the place its file sits.
 *
 * The inverse of `mintResourceRef`, and total: anything that is not one of the
 * four shapes the minter produces returns `undefined`, which the wall reads as
 * *unreachable*. Denying an unrecognised shape is the safe direction — a
 * hand-built catalog can hold any string, and a permission boundary that
 * guesses at one it does not recognise is a boundary that can be talked past.
 *
 * The four shapes, and the two length rules that keep them apart:
 *
 * - `<name>` — the org level
 * - `teams/<teamId>/<name>` — a team's
 * - `workers/<worker>/<name>` — an org worker's
 * - `teams/<teamId>/workers/<worker>/<name>` — a team worker's
 *
 * A `workers` first segment is only read as the workers LEVEL when exactly two
 * segments follow it. Otherwise a document legitimately named `workers`, which
 * mints `teams/eng/workers`, would be misread as a malformed worker address.
 *
 * @param ref A reference's ref, as the loader minted it.
 * @returns Where its file sits, or `undefined` if the ref is not a shape the
 *   convention mints.
 */
export function placeOfReference(ref: string): TreePlace | undefined {
  const parts = ref.split("/");
  if (parts.some((part) => part.length === 0)) return undefined;

  // **Length decides which segments are structural, never their spelling.**
  // `teams` and `workers` are reserved PATH segments and also perfectly legal
  // document names — `validateSegment` admits both — so `org/references/teams.md`
  // mints the single-segment ref `teams`. Reading that as a broken `teams/`
  // path made an ordinary org document reachable by nobody.
  //
  // Handled as a class rather than as two special cases: a ref's shape is fixed
  // by how many segments it has, because that is what `mintResourceRef`
  // guarantees. A single segment is an org document whatever it spells.
  if (parts.length === 1) return { team: undefined, worker: undefined };

  let team: string | undefined;
  let rest = parts;
  if (parts[0] === TEAMS_LEVEL) {
    if (parts.length < 3) return undefined;
    team = parts[1];
    rest = parts.slice(2);
  }

  if (rest.length === 1) return { team, worker: undefined };
  if (rest.length === 3 && rest[0] === WORKERS_LEVEL) return { team, worker: rest[1] };
  return undefined;
}

/**
 * Where the reference behind one of a kind's accessor keys actually sits.
 *
 * **The accessor key is not the place.** An app may expose one definition under
 * a second key — `{ ...references, handbook: references["teams/eng/handbook"] }`
 * — and that alias is still the team's handbook. Placing it by its key would
 * read a single-segment alias as an org document and hand it to every seat in
 * the company, which is the exact widening the wall exists to stop. So the
 * place comes from the definition's own minted `ref`, which the loader derived
 * from the path on disk, and never from the key an app chose (BP-031).
 *
 * `undefined` when no minted ref can be read, which the wall treats as
 * unreachable. That is the safer reading of a definition this module cannot
 * place: an alias nobody can locate is denied rather than published org-wide.
 */
function placeOfEntry(entry: unknown): TreePlace | undefined {
  const minted = (entry as { ref?: unknown } | undefined)?.ref;
  if (typeof minted !== "string" || minted.length === 0) return undefined;
  return placeOfReference(minted);
}

/**
 * Read a seat's id back into the place its folder sits.
 *
 * A worker id is `"<teamId>.<name>"` — dot-joined, because it becomes a flow
 * address and a `/` there is unroutable — so a seat always sits at
 * `teams/<teamId>/workers/<name>/`.
 *
 * Returns `undefined` for an id that is not team-qualified. That is not a seat
 * the loader can mint, so there is no folder to place it at and no honest
 * answer to what is above it; {@link seatHasNoPlaceMessage} is what the caller
 * does with it.
 *
 * @param seatId The worker's id, as the roster minted it.
 * @returns Where the seat sits, or `undefined` if the id names no place.
 */
export function placeOfSeat(seatId: string): TreePlace | undefined {
  const dot = seatId.indexOf(".");
  if (dot <= 0 || dot === seatId.length - 1) return undefined;
  const team = seatId.slice(0, dot);
  const worker = seatId.slice(dot + 1);
  // A second dot is still one team and one name — `indexOf` splits at the
  // first, which is the rule the id minter uses.
  if (team.includes("/") || worker.includes("/")) return undefined;
  return { team, worker };
}

/**
 * Whether a seat can reach a reference: is the reference's folder at or above
 * the seat's place?
 *
 * Three ways yes, and nothing else:
 *
 * - the org level is above everyone;
 * - the seat's own team's folder;
 * - the seat's own worker folder.
 *
 * Everything else is no, and the two that matter are the ones a person expects
 * to be yes and should not be: **another team's folder**, and **a sibling
 * seat's folder on the same team**. The walk inherits downward only — a
 * sibling's folder is not above anyone.
 *
 * An org WORKER's folder (`workers/<w>/<name>`) is also no, for the same
 * reason: it is an address beside the org level, not above a team's seat.
 */
export function referenceReachableBySeat(seat: TreePlace, reference: TreePlace): boolean {
  // The org level: above every seat.
  if (reference.team === undefined) return reference.worker === undefined;
  // Another team's tree is never above this seat.
  if (reference.team !== seat.team) return false;
  // The seat's own team folder, or its own worker folder. A sibling's is not.
  if (reference.worker === undefined) return true;
  return reference.worker === seat.worker;
}

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

/** The one sentence describing the entry shape, shared by every shape refusal. */
const SHAPE_SENTENCE =
  `An entry is a reference's ref on its own. There is no mode — nothing writes a reference.`;

/** The wording for a `references:` that is not a list at all. */
const malformedSeatReferencesMessage = (value: unknown): string =>
  `declares \`${SEAT_REFERENCES_KEY}:\` as ${describe(value)}, which names no references. ` +
  `${SEAT_REFERENCES_KEY}: is a LIST — one entry per reference, each line starting with \`- \`. ` +
  SHAPE_SENTENCE;

/** The wording for one entry that is not a ref. */
const malformedSeatReferenceEntryMessage = (value: unknown): string =>
  `declares \`${SEAT_REFERENCES_KEY}:\` entry ${describe(value)}, which names no reference. ` +
  SHAPE_SENTENCE;

/** The wording for a ref named more than once. */
const duplicateSeatReferenceMessage = (ref: string, times: number): string =>
  `names "${ref}" ${times} times. Keep one.`;

/**
 * The wording for a ref that matches no reference this seat can reach.
 *
 * One message for "does not exist" and for "exists, but not above this seat",
 * deliberately. Telling them apart would let a seat file probe the tree for
 * which teams have a handbook — and the fix is the same either way: put the
 * file where this seat can see it, or drop the entry.
 */
const unreachableSeatReferenceMessage = (ref: string, seatId: string): string =>
  `names "${ref}", which is not a reference "${seatId}" can reach. A \`${SEAT_REFERENCES_KEY}:\` ` +
  `list NARROWS what a seat's place in the tree already gives it — the org's references, its ` +
  `own team's, and its own folder's — and cannot add one from outside. Move the file up the ` +
  `tree to widen who reads it, or drop the entry.`;

/**
 * The wording for a kind holding references the hire step was not given.
 *
 * The one refusal that is about the APP's wiring rather than a seat's file, so
 * it names the option rather than the seat. Fatal, and deliberately not a
 * warning: a warning here would be a wall that is off with a log line, which is
 * the failure this convention exists to end.
 */
const referencesNotDeclaredMessage = (refs: readonly string[]): string =>
  `is hired onto a kind holding ${refs.length} reference(s) that hireWorkforce was not given: ` +
  `${refs.map((ref) => `"${ref}"`).join(", ")}. A reference's reach is derived from where its ` +
  `file sits, and that can only be worked out against the app's own catalog — so without it ` +
  `every seat would reach every team's references and nothing would say so. Pass the same map ` +
  `you installed on the kind: \`hireWorkforce(workers, { references: referencesFromDocs(refs) })\`.`;

/**
 * The wording for a seat whose id names no place in the tree.
 *
 * Fatal once the kind holds references, and silent before that: reachability is
 * derived from where a seat sits, so a seat that sits nowhere has no derivable
 * answer. Guessing one would mean picking between "reaches the org's
 * references" and "reaches none", and both are wrong in a way nothing reports.
 */
const seatHasNoPlaceMessage = (seatId: string): string =>
  `has the id "${seatId}", which names no place in the tree, and this kind holds references. ` +
  `A worker id is "<teamId>.<name>" — the loader mints it from the seat's folder, and a ` +
  `reference is reachable because of where it sits relative to that folder. Give the seat a ` +
  `team-qualified id.`;

/**
 * The wording for a reference the wall denied that the minted flow reaches
 * anyway.
 *
 * The twin of `seat-resources`'s survived-narrowing refusal, and it exists for
 * the same substrate reason: a flow instance's `resources` option replaces the
 * definition's flow-level map, and `defineFlow` then merges the blocks' own
 * declarations back on top. So a reference a block also declares comes back
 * after the wall removed it. Fatal — the alternative is a wall that reads as
 * enforced and is not.
 */
const referenceCrossedWallMessage = (ref: string, seatId: string, kind: string): string =>
  `cannot reach "${ref}" from its place in the tree, but the flow it is minted with reaches ` +
  `it anyway: a block on the "${kind}" kind declares it, and a block declaration merges back ` +
  `in after a seat's map replaces the flow-level one. Remove that declaration from the block ` +
  `and keep the reference at flow level, or move the file where "${seatId}" can see it.`;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** What {@link parseSeatReferences} found: the refs named, or why it could not read them. */
export interface ParsedSeatReferences {
  /** One ref per entry, in file order. Absent when `problems` is non-empty. */
  refs?: string[];
  /** Every problem with the declaration. Collected, never thrown — the hire step owns the refusal. */
  problems: string[];
}

/**
 * Read a seat's `references:` declaration into refs.
 *
 * **Call this only for a declaration that is PRESENT.** Absent and
 * present-and-empty are three-way distinct all the way down — *nobody narrowed
 * this seat*, versus *this seat is narrowed to nothing* — and collapsing them
 * turns the one way to say "no ambient reading" into its opposite. Whether the
 * key is there is the caller's read; `references: []` parses here to zero refs
 * and no problems.
 *
 * @param declared The value of the seat's {@link SEAT_REFERENCES_KEY} key, uninterpreted.
 * @returns The refs in file order, or every problem with the declaration.
 */
export function parseSeatReferences(declared: unknown): ParsedSeatReferences {
  if (!Array.isArray(declared)) {
    return { problems: [malformedSeatReferencesMessage(declared)] };
  }

  const problems: string[] = [];
  const refs: string[] = [];
  const counts = new Map<string, number>();

  for (const entry of declared) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      problems.push(malformedSeatReferenceEntryMessage(entry));
      continue;
    }
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
    refs.push(entry);
  }

  for (const [ref, times] of counts) {
    if (times > 1) problems.push(duplicateSeatReferenceMessage(ref, times));
  }

  if (problems.length > 0) return { problems };
  return { refs, problems };
}

// ---------------------------------------------------------------------------
// Applying the wall
// ---------------------------------------------------------------------------

/** Everything {@link applyReferenceWall} needs to build one seat's map. */
export interface ApplyReferenceWallInput {
  /** The seat's id, as the roster minted it. Its place in the tree comes from here. */
  seatId: string;
  /**
   * The seat's `references:` value, uninterpreted, or `undefined` when the key
   * is ABSENT — which means ambient, not empty.
   */
  declared: unknown;
  /** Whether the key is present at all. `declared` cannot carry this: `references:` with nothing after it parses to `null`. */
  hasDeclared: boolean;
  /** The app's references, keyed by ref — the map `referencesFromDocs` returns. */
  catalog: DeclaredResources | undefined;
  /** The kind's MERGED resource map — its own flow-level entries plus what its blocks declare. */
  kindResources: DeclaredResources;
  /** The accessor keys the kind declared at FLOW level, which is the subset a seat's map replaces. */
  kindFlowLevelKeys: ReadonlySet<string>;
  /**
   * The map this seat would otherwise be minted with — `resolveSeatResources`'
   * output when the seat also declares `resources:`, or `undefined` when it
   * declares none and would be minted with the kind's own map.
   */
  base: DeclaredResources | undefined;
}

/** What {@link applyReferenceWall} produced. */
export interface AppliedReferenceWall {
  /**
   * The map to mint this seat with, or `undefined` to mint it with no map at
   * all — which is what a kind holding no references gets, so an app with no
   * `references/` folder is minted exactly as it is today.
   */
  resources?: DeclaredResources;
  /** The references this seat may reach, for the post-mint check. */
  reachable: ReadonlySet<string>;
  /** Every problem. Collected, never thrown. */
  problems: string[];
}

/**
 * Narrow a seat's map to the references its place in the tree allows, and then
 * to the ones it named.
 *
 * **Built by subtraction, exactly as `resolveSeatResources` is**, and for the
 * same substrate reason: a flow instance's `resources` option REPLACES the
 * definition's flow-level map, so a map assembled from the reachable
 * references alone would delete every other resource the kind declared. The map
 * starts as everything the seat would otherwise hold and loses the references
 * the wall denies.
 *
 * **A kind holding no references is left alone entirely** — `base` comes back
 * untouched, including `undefined`. That is what keeps every existing app byte
 * for byte as it is: no `references/` folder, no map where there was none, no
 * change to what a seat reaches.
 *
 * @param input The seat, its declaration, the catalog and the kind's map.
 * @returns The seat's map, the reachable set, and every problem.
 */
export function applyReferenceWall(input: ApplyReferenceWallInput): AppliedReferenceWall {
  // No `kind` here, deliberately: none of this function's three refusals names
  // it. The wall is about where a seat SITS, and `hireWorkforce` already
  // prefixes every refusal with the worker's id. The kind is named only by
  // `verifySeatReferenceWall`, whose refusal is about a block on that kind.
  const { seatId, declared, hasDeclared, catalog, kindResources, kindFlowLevelKeys, base } = input;

  // Which of the kind's accessors hold one of the app's references. By name OR
  // by definition identity, the way `seat-resources` recognises a document: an
  // app may expose one definition under a second key, and matching names alone
  // would leave that alias outside the wall.
  const references = referenceKeys(catalog, kindResources);

  // **Before the wall can be applied, check it is not simply absent.**
  //
  // Reachability is derived from the catalog, and the catalog is the app's to
  // hand over. An app that spreads `referencesFromDocs(...)` into its flow but
  // forgets to pass the same map here gets a kind full of references that
  // nothing recognises: D1 still holds, because the seal rides on the
  // definition, but D2 evaporates and every seat reaches every team's
  // handbook. Nothing would warn, and the folder would still be called
  // `references/`.
  //
  // That is this convention's own problem statement one level up — the wall
  // back to a line the app must remember, with the same silence when it is
  // missing — so omission is refused rather than tolerated. Fail closed and
  // loud, the way the migration refuses an address it cannot compute.
  //
  // Recognised by IDENTITY, not by shape: see `isReferenceDefinition`. A
  // partial catalog is refused for the same reason and by the same check —
  // one unrecognised reference is one document the wall does not cover.
  const unwalled = Object.keys(kindResources).filter(
    (key) => isReferenceDefinition(kindResources[key]) && !references.has(key),
  );
  if (unwalled.length > 0) {
    return { reachable: new Set<string>(), problems: [referencesNotDeclaredMessage(unwalled)] };
  }

  // Nothing to wall. Left exactly as it was — the branch that keeps an app with
  // no references/ folder unchanged, including being minted with no map.
  if (references.size === 0 && !hasDeclared) {
    return { resources: base, reachable: new Set<string>(), problems: [] };
  }

  const problems: string[] = [];

  const seat = placeOfSeat(seatId);
  if (seat === undefined) {
    return { reachable: new Set<string>(), problems: [seatHasNoPlaceMessage(seatId)] };
  }

  // The wall: derived, before anything the seat wrote is read.
  //
  // Placed from the DEFINITION's minted ref, not from the accessor key it sits
  // under — see `placeOfEntry`. The two are the same string for every entry an
  // app installs under its own ref, and differ exactly for an alias, which is
  // the case that would otherwise widen.
  const reachable = new Set<string>();
  for (const key of references) {
    const place = placeOfEntry(kindResources[key] ?? catalog?.[key]);
    if (place !== undefined && referenceReachableBySeat(seat, place)) reachable.add(key);
  }

  // The narrowing, if the seat asked for one. Selects from `reachable`; a ref
  // outside it is refused rather than granted (BP-031).
  let allowed: ReadonlySet<string> = reachable;
  if (hasDeclared) {
    const parsed = parseSeatReferences(declared);
    if (parsed.problems.length > 0) {
      return { reachable, problems: parsed.problems };
    }
    const named = new Set<string>();
    for (const ref of parsed.refs ?? []) {
      if (!reachable.has(ref)) {
        problems.push(unreachableSeatReferenceMessage(ref, seatId));
        continue;
      }
      named.add(ref);
    }
    allowed = named;
  }

  if (problems.length > 0) return { reachable, problems };

  // The subtraction. `base` when the seat already has a map (it declared
  // `resources:`), otherwise the kind's own flow-level entries — which is what
  // it would have been minted with.
  const resources: DeclaredResources = emptyMap();
  if (base !== undefined) {
    for (const [key, entry] of Object.entries(base)) {
      if (references.has(key) && !allowed.has(key)) continue;
      resources[key] = entry;
    }
  } else {
    for (const key of kindFlowLevelKeys) {
      if (!Object.hasOwn(kindResources, key)) continue;
      if (references.has(key) && !allowed.has(key)) continue;
      resources[key] = kindResources[key]!;
    }
  }

  return { resources, reachable: allowed, problems };
}

/**
 * Every accessor on a kind's map that holds one of the app's references.
 *
 * By name OR by definition identity, for the reason `seat-resources`'
 * `documentKeys` is: an app may expose one definition under a second key, and a
 * wall that matched names alone would leave the alias reachable across a team
 * boundary. The union never recognises fewer references than names alone, so
 * closing this cannot silently widen a seat.
 */
function referenceKeys(
  catalog: DeclaredResources | undefined,
  kindResources: DeclaredResources,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (catalog === undefined) return keys;
  const definitions = new Set<unknown>(Object.values(catalog));
  for (const key of Object.keys(kindResources)) {
    if (Object.hasOwn(catalog, key) || definitions.has(kindResources[key])) keys.add(key);
  }
  for (const key of Object.keys(catalog)) {
    if (Object.hasOwn(kindResources, key)) keys.add(key);
  }
  return keys;
}

/** What {@link verifySeatReferenceWall} is asked to check: the seat as it was actually built. */
export interface VerifySeatReferenceWallInput {
  /** The MERGED map of the minted instance — what a block will really hold. */
  minted: DeclaredResources | undefined;
  /** The references this seat is allowed, from {@link applyReferenceWall}. */
  allowed: ReadonlySet<string>;
  /** The app's references, keyed by ref. */
  catalog: DeclaredResources | undefined;
  /** The seat's id, for the refusal. */
  seatId: string;
  /** The kind's name, for the refusal. */
  kind: string;
}

/**
 * Check the seat that was actually minted, and refuse if a reference the wall
 * denied is reachable anyway.
 *
 * **This exists because no inspection of the kind's map can predict the
 * answer** — the same reason `verifySeatNarrowing` exists, and the reason it
 * reads the built instance rather than reasoning about the build. A reference
 * declared both at flow level and by one of the kind's blocks is shadowed at
 * definition time, invisible on the merged map, and comes back the moment the
 * wall removes the flow-level entry that was hiding it.
 *
 * @param input The minted map, the allowed set, and the catalog.
 * @returns Every reference that crossed the wall. Empty is the pass.
 */
export function verifySeatReferenceWall(input: VerifySeatReferenceWallInput): string[] {
  const { minted, allowed, catalog, seatId, kind } = input;
  if (minted === undefined || catalog === undefined) return [];

  const definitions = new Set<unknown>(Object.values(catalog));
  // Re-derived here rather than taken from `applyReferenceWall`, so this is an
  // independent check and not a restatement. Asking only "is this key in
  // `allowed`?" makes the verification agree with whatever the wall computed —
  // including a mistake, which is how an aliased entry could be waved through
  // by the very check that exists to catch it.
  const seat = placeOfSeat(seatId);
  const problems: string[] = [];

  for (const key of Object.keys(minted)) {
    // Identity, not name: a block resource that merely shares a reference's ref
    // is not that reference, and flagging it by name would refuse an app whose
    // wiring is fine.
    if (!definitions.has(minted[key])) continue;

    const place = placeOfEntry(minted[key]);
    const withinWall =
      seat !== undefined && place !== undefined && referenceReachableBySeat(seat, place);

    // Two ways to be wrong, one refusal: the entry is outside this seat's place
    // in the tree, or it is inside but the seat narrowed it away and it came
    // back. Both mean the minted flow reaches a reference the seat must not.
    if (!withinWall || !allowed.has(key)) {
      problems.push(referenceCrossedWallMessage(key, seatId, kind));
    }
  }

  return problems;
}
