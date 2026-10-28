/**
 * The worker reference wall — which references a worker can reach, derived from
 * where it and they sit in the tree, and narrowed by a `WORKER.md`'s
 * `references:` key.
 *
 * **One module, because this is a permission boundary**, the reason
 * `./worker-resources` is one. A reference becomes reachable in exactly one
 * place, so there is exactly one place the wall can be forgotten.
 *
 * **It is a sibling of `worker-resources`, not a copy of it.** The two answer
 * different questions and the difference is the point:
 *
 * | | `resources:` | `references:` |
 * |---|---|---|
 * | absent | reaches everything on the worker flow | reaches everything **at or above its place in the tree** |
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
 * **A worker file selects, it never defines** (BP-031). Both inputs the wall is
 * computed from — the worker's id and each reference's ref — are minted by the
 * loader from the path on disk, never taken from anything a worker wrote. A
 * `references:` entry naming something outside the wall is refused, not
 * granted.
 */

import type { DeclaredResources } from "@flow-state-dev/core";
import { describe } from "./describe-value";
import { isReferenceDefinition } from "./references-from-docs";
import { emptyMap } from "./empty-map";
import { validateSegment, type SegmentLabel } from "./loader/segments";

/**
 * The key a worker's file names its references under.
 *
 * Public: a user types it, and it matches the `references/` folder the
 * documents come from. Read from here by every door, never spelled as a
 * literal — a renamed key with a literal left behind is an access grant that
 * silently does not apply.
 */
export const WORKER_REFERENCES_KEY = "references";

/** The `teams/` first segment, as both a ref and a worker address use it. */
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
 * Where the reference behind one of a worker flow's accessor keys actually sits.
 *
 * **The accessor key is not the place.** An app may expose one definition under
 * a second key — `{ ...references, handbook: references["teams/eng/handbook"] }`
 * — and that alias is still the team's handbook. Placing it by its key would
 * read a single-segment alias as an org document and hand it to every worker in
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

/** A declared worker's id, read back into the folder names it was minted from. */
export interface DeclaredWorkerId {
  /** The team folder, or `undefined` for an org worker (`org/workers/<name>/`). */
  team?: string;
  /** The worker's own folder name. */
  name: string;
}

/**
 * Read a declared worker's id back into the folders it was minted from.
 *
 * The one rule every reader that needs a worker's team uses, so none of them
 * splits an id on its own. The loader mints two shapes:
 *
 * - `"<name>"` — no dot: an org worker, declared at `org/workers/<name>/`;
 * - `"<teamId>.<name>"` — a team worker, at `teams/<teamId>/workers/<name>/`.
 *
 * The split is at the first dot. Neither folder name may hold a `.`, so the
 * two shapes never overlap, and an id with a second dot is neither.
 *
 * Both halves are held to the segment rule the loader mints by
 * (`validateSegment`), so an id the loader could not have minted — `Bad_Name`,
 * `eng.Lead`, an empty half, a `/`, a second dot — names no worker rather than
 * being placed.
 *
 * @param workerId The worker's declared id: a record's `workerId ?? id`. Never a
 *   runtime hire's `id`, which is its org-qualified address.
 * @returns The folders, or `undefined` for an id the loader cannot mint.
 *
 * @example
 * parseDeclaredWorkerId("shift-coordinator"); // { name: "shift-coordinator" }
 * parseDeclaredWorkerId("eng.lead");       // { team: "eng", name: "lead" }
 */
export function parseDeclaredWorkerId(workerId: string): DeclaredWorkerId | undefined {
  const dot = workerId.indexOf(".");
  const parsed: DeclaredWorkerId =
    dot === -1 ? { name: workerId } : { team: workerId.slice(0, dot), name: workerId.slice(dot + 1) };
  if (parsed.team !== undefined && !isSegment(parsed.team, "Team")) return undefined;
  // A worker folder name is one segment, so a second dot is an id the loader
  // never mints: the segment rule refuses it.
  if (!isSegment(parsed.name, "Worker")) return undefined;
  return parsed;
}

/** Whether `segment` passes the loader's segment rule. */
function isSegment(segment: string, label: SegmentLabel): boolean {
  try {
    validateSegment(segment, label);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a worker's id back into the place its folder sits.
 *
 * Through {@link parseDeclaredWorkerId}: an org worker (`"<name>"`) sits at
 * `org/workers/<name>/`, a team worker (`"<teamId>.<name>"`) at
 * `teams/<teamId>/workers/<name>/`.
 *
 * Returns `undefined` for an id the loader cannot mint, so there is no folder
 * to place it at and no honest answer to what is above it;
 * {@link workerHasNoPlaceMessage} is what the caller does with it.
 *
 * @param workerId The worker's id, as the roster minted it.
 * @returns Where the worker sits, or `undefined` if the id names no place.
 */
export function placeOfWorker(workerId: string): TreePlace | undefined {
  const parsed = parseDeclaredWorkerId(workerId);
  if (parsed === undefined) return undefined;
  return { team: parsed.team, worker: parsed.name };
}

/**
 * Whether a worker can reach a reference: is the reference's folder at or above
 * the worker's place?
 *
 * Three ways yes, and nothing else:
 *
 * - the org level is above everyone;
 * - the worker's own team's folder (a team worker's);
 * - the worker's own worker folder — under its team, or under `org/workers/` for
 *   an org worker.
 *
 * Everything else is no, and the two that matter are the ones a user expects
 * to be yes and should not be: **another team's folder**, and **a sibling
 * worker's folder on the same team**. The walk inherits downward only — a
 * sibling's folder is not above anyone.
 *
 * An org WORKER's folder (`workers/<w>/<name>`) is also no to every worker but
 * that org worker, for the same reason: it is an address beside the org level,
 * not above anyone else. And an org worker has no team, so no team's folder is
 * above it.
 */
export function referenceReachableByWorker(worker: TreePlace, reference: TreePlace): boolean {
  // The org level: above every worker. An org worker's folder: that worker's own.
  if (reference.team === undefined) {
    if (reference.worker === undefined) return true;
    return worker.team === undefined && reference.worker === worker.worker;
  }
  // Another team's tree is never above this worker.
  if (reference.team !== worker.team) return false;
  // The worker's own team folder, or its own worker folder. A sibling's is not.
  if (reference.worker === undefined) return true;
  return reference.worker === worker.worker;
}

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

/** The one sentence describing the entry shape, shared by every shape refusal. */
const SHAPE_SENTENCE =
  `An entry is a reference's ref on its own. There is no mode — nothing writes a reference.`;

/** The wording for a `references:` that is not a list at all. */
const malformedWorkerReferencesMessage = (value: unknown): string =>
  `declares \`${WORKER_REFERENCES_KEY}:\` as ${describe(value)}, which names no references. ` +
  `${WORKER_REFERENCES_KEY}: is a LIST — one entry per reference, each line starting with \`- \`. ` +
  SHAPE_SENTENCE;

/** The wording for one entry that is not a ref. */
const malformedWorkerReferenceEntryMessage = (value: unknown): string =>
  `declares \`${WORKER_REFERENCES_KEY}:\` entry ${describe(value)}, which names no reference. ` +
  SHAPE_SENTENCE;

/** The wording for a ref named more than once. */
const duplicateWorkerReferenceMessage = (ref: string, times: number): string =>
  `names "${ref}" ${times} times. Keep one.`;

/**
 * The wording for a ref that matches no reference this worker can reach.
 *
 * One message for "does not exist" and for "exists, but not above this worker",
 * deliberately. Telling them apart would let a worker file probe the tree for
 * which teams have a handbook — and the fix is the same either way: put the
 * file where this worker can see it, or drop the entry.
 */
const unreachableWorkerReferenceMessage = (ref: string, workerId: string): string =>
  `names "${ref}", which is not a reference "${workerId}" can reach. A \`${WORKER_REFERENCES_KEY}:\` ` +
  `list NARROWS what a worker's place in the tree already gives it — the org's references, its ` +
  `own team's, and its own folder's — and cannot add one from outside. Move the file up the ` +
  `tree to widen who reads it, or drop the entry.`;

/**
 * The wording for a worker flow holding references the hire step was not given.
 *
 * The one refusal that is about the APP's wiring rather than a worker's file, so
 * it names the option rather than the worker. Fatal, and deliberately not a
 * warning: a warning here would be a wall that is off with a log line, which is
 * the failure this convention exists to end.
 */
const referencesNotDeclaredMessage = (refs: readonly string[]): string =>
  `runs on a flow holding ${refs.length} reference(s) its installation was not given: ` +
  `${refs.map((ref) => `"${ref}"`).join(", ")}. A reference's reach is derived from where its ` +
  `file sits, and that can only be worked out against the app's own catalog — so without it ` +
  `every worker would reach every team's references and nothing would say so. Pass the same map ` +
  `you declared on the flow: \`createWorkerInstallation({ references: referencesFromDocs(refs) })\`.`;

/**
 * The wording for a worker whose id names no place in the tree.
 *
 * Fatal once the worker flow holds references, and silent before that: reachability is
 * derived from where a worker sits, so a worker that sits nowhere has no derivable
 * answer. Guessing one would mean picking between "reaches the org's
 * references" and "reaches none", and both are wrong in a way nothing reports.
 */
const workerHasNoPlaceMessage = (workerId: string): string =>
  `has the id "${workerId}", which names no place in the tree, and this worker flow holds references. ` +
  `A worker id is "<teamId>.<name>", or "<name>" for an org worker — the loader mints it from ` +
  `the worker's folder, and a reference is reachable because of where it sits relative to that ` +
  `folder. Give the worker an id of one of those shapes.`;

/**
 * The wording for a reference the wall denied that the minted flow reaches
 * anyway.
 *
 * The twin of `worker-resources`'s survived-narrowing refusal, and it exists for
 * the same substrate reason: a minted worker's `resources` option replaces the
 * definition's flow-level map, and `defineFlow` then merges the blocks' own
 * declarations back on top. So a reference a block also declares comes back
 * after the wall removed it. Fatal — the alternative is a wall that reads as
 * enforced and is not.
 */
const referenceCrossedWallMessage = (ref: string, workerId: string, flow: string): string =>
  `cannot reach "${ref}" from its place in the tree, but the flow it is minted with reaches ` +
  `it anyway: a block on the "${flow}" worker flow declares it, and a block declaration merges back ` +
  `in after a worker's map replaces the flow-level one. Remove that declaration from the block ` +
  `and keep the reference at flow level, or move the file where "${workerId}" can see it.`;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** What {@link parseWorkerReferences} found: the refs named, or why it could not read them. */
export interface ParsedWorkerReferences {
  /** One ref per entry, in file order. Absent when `problems` is non-empty. */
  refs?: string[];
  /** Every problem with the declaration. Collected, never thrown — the hire step owns the refusal. */
  problems: string[];
}

/**
 * Read a worker's `references:` declaration into refs.
 *
 * **Call this only for a declaration that is PRESENT.** Absent and
 * present-and-empty are three-way distinct all the way down — *nobody narrowed
 * this worker*, versus *this worker is narrowed to nothing* — and collapsing them
 * turns the one way to say "no ambient reading" into its opposite. Whether the
 * key is there is the caller's read; `references: []` parses here to zero refs
 * and no problems.
 *
 * @param declared The value of the worker's {@link WORKER_REFERENCES_KEY} key, uninterpreted.
 * @returns The refs in file order, or every problem with the declaration.
 */
export function parseWorkerReferences(declared: unknown): ParsedWorkerReferences {
  if (!Array.isArray(declared)) {
    return { problems: [malformedWorkerReferencesMessage(declared)] };
  }

  const problems: string[] = [];
  const refs: string[] = [];
  const counts = new Map<string, number>();

  for (const entry of declared) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      problems.push(malformedWorkerReferenceEntryMessage(entry));
      continue;
    }
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
    refs.push(entry);
  }

  for (const [ref, times] of counts) {
    if (times > 1) problems.push(duplicateWorkerReferenceMessage(ref, times));
  }

  if (problems.length > 0) return { problems };
  return { refs, problems };
}

// ---------------------------------------------------------------------------
// Applying the wall
// ---------------------------------------------------------------------------

/** Everything {@link applyReferenceWall} needs to build one worker's map. */
export interface ApplyReferenceWallInput {
  /** The worker's id, as the roster minted it. Its place in the tree comes from here. */
  workerId: string;
  /**
   * The worker's `references:` value, uninterpreted, or `undefined` when the key
   * is ABSENT — which means ambient, not empty.
   */
  declared: unknown;
  /** Whether the key is present at all. `declared` cannot carry this: `references:` with nothing after it parses to `null`. */
  hasDeclared: boolean;
  /** The app's references, keyed by ref — the map `referencesFromDocs` returns. */
  catalog: DeclaredResources | undefined;
  /** The worker flow's MERGED resource map — its own flow-level entries plus what its blocks declare. */
  workerFlowResources: DeclaredResources;
  /** The accessor keys the worker flow declared at FLOW level, which is the subset a worker's map replaces. */
  flowLevelKeys: ReadonlySet<string>;
  /**
   * The map this worker would otherwise be minted with — `resolveWorkerResources`'
   * output when the worker also declares `resources:`, or `undefined` when it
   * declares none and would be minted with the worker flow's own map.
   */
  base: DeclaredResources | undefined;
}

/** What {@link applyReferenceWall} produced. */
export interface AppliedReferenceWall {
  /**
   * The map to mint this worker with, or `undefined` to mint it with no map at
   * all — which is what a worker flow holding no references gets, so an app with no
   * `references/` folder is minted exactly as it is today.
   */
  resources?: DeclaredResources;
  /** The references this worker may reach, for the post-mint check. */
  reachable: ReadonlySet<string>;
  /** Every problem. Collected, never thrown. */
  problems: string[];
}

/**
 * Narrow a worker's map to the references its place in the tree allows, and then
 * to the ones it named.
 *
 * **Built by subtraction, exactly as `resolveWorkerResources` is**, and for the
 * same substrate reason: a minted worker's `resources` option REPLACES the
 * definition's flow-level map, so a map assembled from the reachable
 * references alone would delete every other resource the worker flow declared. The map
 * starts as everything the worker would otherwise hold and loses the references
 * the wall denies.
 *
 * **A worker flow holding no references is left alone entirely** — `base` comes back
 * untouched, including `undefined`. That is what keeps every existing app byte
 * for byte as it is: no `references/` folder, no map where there was none, no
 * change to what a worker reaches.
 *
 * @param input The worker, its declaration, the catalog and the worker flow's map.
 * @returns The worker's map, the reachable set, and every problem.
 */
export function applyReferenceWall(input: ApplyReferenceWallInput): AppliedReferenceWall {
  // No `kind` here, deliberately: none of this function's three refusals names
  // it. The wall is about where a worker SITS, and `hireWorkforce` already
  // prefixes every refusal with the worker's id. The worker flow is named only by
  // `verifyWorkerReferenceWall`, whose refusal is about a block on that flow.
  const { workerId, declared, hasDeclared, catalog, workerFlowResources, flowLevelKeys, base } = input;

  // Which of the worker flow's accessors hold one of the app's references. By name OR
  // by definition identity, the way `worker-resources` recognises a document: an
  // app may expose one definition under a second key, and matching names alone
  // would leave that alias outside the wall.
  const references = referenceKeys(catalog, workerFlowResources);

  // **Before the wall can be applied, check it is not simply absent.**
  //
  // Reachability is derived from the catalog, and the catalog is the app's to
  // hand over. An app that spreads `referencesFromDocs(...)` into its flow but
  // forgets to pass the same map here gets a worker flow full of references that
  // nothing recognises: D1 still holds, because the seal rides on the
  // definition, but D2 evaporates and every worker reaches every team's
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
  const unwalled = Object.keys(workerFlowResources).filter(
    (key) => isReferenceDefinition(workerFlowResources[key]) && !references.has(key),
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

  const worker = placeOfWorker(workerId);
  if (worker === undefined) {
    return { reachable: new Set<string>(), problems: [workerHasNoPlaceMessage(workerId)] };
  }

  // The wall: derived, before anything the worker wrote is read.
  //
  // Placed from the DEFINITION's minted ref, not from the accessor key it sits
  // under — see `placeOfEntry`. The two are the same string for every entry an
  // app installs under its own ref, and differ exactly for an alias, which is
  // the case that would otherwise widen.
  const reachable = new Set<string>();
  for (const key of references) {
    const place = placeOfEntry(workerFlowResources[key] ?? catalog?.[key]);
    if (place !== undefined && referenceReachableByWorker(worker, place)) reachable.add(key);
  }

  // The narrowing, if the worker asked for one. Selects from `reachable`; a ref
  // outside it is refused rather than granted (BP-031).
  let allowed: ReadonlySet<string> = reachable;
  if (hasDeclared) {
    const parsed = parseWorkerReferences(declared);
    if (parsed.problems.length > 0) {
      return { reachable, problems: parsed.problems };
    }
    const named = new Set<string>();
    for (const ref of parsed.refs ?? []) {
      if (!reachable.has(ref)) {
        problems.push(unreachableWorkerReferenceMessage(ref, workerId));
        continue;
      }
      named.add(ref);
    }
    allowed = named;
  }

  if (problems.length > 0) return { reachable, problems };

  // The subtraction. `base` when the worker already has a map (it declared
  // `resources:`), otherwise the worker flow's own flow-level entries — which is what
  // it would have been minted with.
  const resources: DeclaredResources = emptyMap();
  if (base !== undefined) {
    for (const [key, entry] of Object.entries(base)) {
      if (references.has(key) && !allowed.has(key)) continue;
      resources[key] = entry;
    }
  } else {
    for (const key of flowLevelKeys) {
      if (!Object.hasOwn(workerFlowResources, key)) continue;
      if (references.has(key) && !allowed.has(key)) continue;
      resources[key] = workerFlowResources[key]!;
    }
  }

  return { resources, reachable: allowed, problems };
}

/**
 * Every accessor on a worker flow's map that holds one of the app's references.
 *
 * By name OR by definition identity, for the reason `worker-resources`'
 * `documentKeys` is: an app may expose one definition under a second key, and a
 * wall that matched names alone would leave the alias reachable across a team
 * boundary. The union never recognises fewer references than names alone, so
 * closing this cannot silently widen a worker.
 */
function referenceKeys(
  catalog: DeclaredResources | undefined,
  workerFlowResources: DeclaredResources,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (catalog === undefined) return keys;
  const definitions = new Set<unknown>(Object.values(catalog));
  for (const key of Object.keys(workerFlowResources)) {
    if (Object.hasOwn(catalog, key) || definitions.has(workerFlowResources[key])) keys.add(key);
  }
  for (const key of Object.keys(catalog)) {
    if (Object.hasOwn(workerFlowResources, key)) keys.add(key);
  }
  return keys;
}

/** What {@link verifyWorkerReferenceWall} is asked to check: the worker as it was actually built. */
export interface VerifyWorkerReferenceWallInput {
  /** The MERGED map of the minted instance — what a block will really hold. */
  minted: DeclaredResources | undefined;
  /** The references this worker is allowed, from {@link applyReferenceWall}. */
  allowed: ReadonlySet<string>;
  /** The app's references, keyed by ref. */
  catalog: DeclaredResources | undefined;
  /** The worker's id, for the refusal. */
  workerId: string;
  /** The worker flow's name, for the refusal. */
  kind: string;
}

/**
 * Check the worker that was actually minted, and refuse if a reference the wall
 * denied is reachable anyway.
 *
 * **This exists because no inspection of the worker flow's map can predict the
 * answer** — the same reason `verifyWorkerNarrowing` exists, and the reason it
 * reads the built instance rather than reasoning about the build. A reference
 * declared both at flow level and by one of the flow's blocks is shadowed at
 * definition time, invisible on the merged map, and comes back the moment the
 * wall removes the flow-level entry that was hiding it.
 *
 * @param input The minted map, the allowed set, and the catalog.
 * @returns Every reference that crossed the wall. Empty is the pass.
 */
export function verifyWorkerReferenceWall(input: VerifyWorkerReferenceWallInput): string[] {
  const { minted, allowed, catalog, workerId, kind: flow } = input;
  if (minted === undefined || catalog === undefined) return [];

  const definitions = new Set<unknown>(Object.values(catalog));
  // Re-derived here rather than taken from `applyReferenceWall`, so this is an
  // independent check and not a restatement. Asking only "is this key in
  // `allowed`?" makes the verification agree with whatever the wall computed —
  // including a mistake, which is how an aliased entry could be waved through
  // by the very check that exists to catch it.
  const worker = placeOfWorker(workerId);
  const problems: string[] = [];

  for (const key of Object.keys(minted)) {
    // Identity, not name: a block resource that merely shares a reference's ref
    // is not that reference, and flagging it by name would refuse an app whose
    // wiring is fine.
    if (!definitions.has(minted[key])) continue;

    const place = placeOfEntry(minted[key]);
    const withinWall =
      worker !== undefined && place !== undefined && referenceReachableByWorker(worker, place);

    // Two ways to be wrong, one refusal: the entry is outside this worker's place
    // in the tree, or it is inside but the worker narrowed it away and it came
    // back. Both mean the minted flow reaches a reference the worker must not.
    if (!withinWall || !allowed.has(key)) {
      problems.push(referenceCrossedWallMessage(key, workerId, flow));
    }
  }

  return problems;
}
