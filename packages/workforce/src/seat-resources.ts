/**
 * The seat resource allowlist — a `WORKER.md`'s `resources:` key, from the
 * words an author writes to the narrowed resource map one seat is minted with.
 *
 * **One module, because this is a permission boundary.** The key's spelling,
 * its two modes, every refusal wording, the parse and the resolve all live
 * here: a grant becomes access in exactly one place, so there is exactly one
 * place `ro` can be forgotten. A second construction site is the failure that
 * surfaces as "it worked in testing".
 *
 * The wordings sit here rather than in `./manifest` — which holds the ones the
 * loader and a consumer both refuse a file with — because only one door refuses
 * these. The loader carries `resources:` through untouched, the way it carries
 * every key it does not name, and the hire step is where a ref meets the
 * documents it could match. They are module-private for the same reason: one
 * caller, and a wording nothing outside composes is not a surface.
 *
 * **What a grant may do, and may not.** A seat file is author-controllable
 * input, so it *selects* from what the app declared and never *defines*
 * anything: every entry in the map built here is the app's own definition of
 * that document, or that definition with its two write flags turned off. A ref
 * that matches no declared document refuses rather than resolving to nothing
 * (BP-031).
 */

import type { DeclaredResources } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { emptyMap } from "./empty-map";

/**
 * The key a seat's file names its documents under.
 *
 * Public: a person types it, and it matches the `resources/` folder the
 * documents come from. Read from here by every door, never spelled as a
 * literal — a renamed key with a literal left behind is an access grant that
 * silently does not apply.
 */
export const SEAT_RESOURCES_KEY = "resources";

/** Read-only: what a bare ref already means, spelled out for authors who prefer symmetry. */
export const SEAT_RESOURCE_MODE_READ = "ro";

/** Read-write: the extra word that grants a seat the pen. */
export const SEAT_RESOURCE_MODE_WRITE = "rw";

/**
 * The two modes, in the order a refusal lists them.
 *
 * There are three entry SHAPES and two modes: a bare ref, `ref: ro` (the same
 * thing, spelled out) and `ref: rw`. Explicit `ro` is sugar and carries no
 * separate meaning.
 */
const SEAT_RESOURCE_MODES = [SEAT_RESOURCE_MODE_READ, SEAT_RESOURCE_MODE_WRITE] as const;

/** One of {@link SEAT_RESOURCE_MODES}. */
export type SeatResourceMode = (typeof SEAT_RESOURCE_MODES)[number];

/** One entry of a seat's `resources:`, after parsing: which document, and what it may do to it. */
export interface SeatResourceGrant {
  /** The document's ref, exactly as the file named it. */
  ref: string;
  /** What the entry granted. A bare ref parses as {@link SEAT_RESOURCE_MODE_READ}. */
  mode: SeatResourceMode;
}

/** The modes as a refusal reads them: `` `ro` `` or `` `rw` ``. */
const MODE_LIST = SEAT_RESOURCE_MODES.map((mode) => `\`${mode}\``).join(" or ");

/** The one sentence describing the entry shapes, shared by every shape refusal. */
const SHAPE_SENTENCE =
  `An entry is a ref on its own (read-only), or \`<ref>: ${SEAT_RESOURCE_MODE_WRITE}\` to grant ` +
  `writes — \`<ref>: ${SEAT_RESOURCE_MODE_READ}\` spells the default out.`;

/**
 * The wording for a `resources:` that is not a list at all.
 *
 * Names the mapping form explicitly because that is the near miss an author
 * actually writes: `resources:` with indented `ref: mode` lines underneath is
 * valid YAML, reads as the obvious thing, and would otherwise be refused with
 * nothing to act on.
 */
const malformedSeatResourcesMessage = (value: unknown): string =>
  `declares \`${SEAT_RESOURCES_KEY}:\` as ${describe(value)}, which names no documents. ` +
  `${SEAT_RESOURCES_KEY}: is a LIST — one entry per document, each line starting with \`- \`. ` +
  `${SHAPE_SENTENCE}`;

/** The wording for one entry that is neither a ref nor a one-key `ref: mode` mapping. */
const malformedSeatResourceEntryMessage = (value: unknown): string =>
  `declares \`${SEAT_RESOURCES_KEY}:\` entry ${describe(value)}, which names no document. ` +
  SHAPE_SENTENCE;

/** The wording for a mode that is neither {@link SEAT_RESOURCE_MODE_READ} nor {@link SEAT_RESOURCE_MODE_WRITE}. */
const badSeatResourceModeMessage = (ref: string, mode: unknown): string =>
  `grants "${ref}" mode ${describe(mode)}, which is not a mode. Write ${MODE_LIST}, ` +
  `or the ref on its own for read-only.`;

/**
 * The wording for a ref that matches no declared document.
 *
 * Fatal rather than ignored: a grant that silently resolves to nothing is a
 * lockout wearing the face of a typo, and the seat would boot reaching less
 * than its author believes.
 */
const unmatchedSeatResourceMessage = (ref: string): string =>
  `grants "${ref}", which is not a document this app declared. A grant selects from the ` +
  `documents passed to hireWorkforce as \`documents\`; it cannot declare one.`;

/**
 * The wording for a ref that IS a declared document but is not one this seat's
 * kind was installed with.
 *
 * An app may install a filtered slice of its documents on a kind — the
 * documented way to give a team's seats only its team's documents. A grant is
 * an allowlist over what the kind already holds, so a ref outside that slice
 * would WIDEN the seat past its own kind, on the say-so of a seat file. That is
 * the one direction a grant may never move (BP-031), so it refuses here rather
 * than resolving to a document the app chose not to give this kind.
 */
const seatResourceNotOnKindMessage = (ref: string, kind: string): string =>
  `grants "${ref}", which this app declared but did not install on the \`${kind}\` kind. ` +
  `A grant narrows what a seat's kind already holds; it cannot add a document the kind was not ` +
  `given. Install it on the kind, or drop the grant.`;

/**
 * The wording for a ref named more than once.
 *
 * Carries every mode the entries asked for, so an author sees the conflict
 * rather than only the repetition — the `ro`-and-`rw` case is the one where
 * guessing a precedence would quietly widen or narrow the grant.
 */
const duplicateSeatResourceMessage = (ref: string, modes: readonly string[]): string =>
  `grants "${ref}" ${modes.length} times, as ${modes.map((m) => `\`${m}\``).join(" and ")}. ` +
  `Two grants for one document have no precedence rule — keep one.`;

/**
 * The wording for a grant whose ref is already an accessor the kind's own
 * blocks declare.
 *
 * The substrate points the other way from the intuition: a flow-level
 * declaration OVERRIDES a block's for the same accessor name, and the grant is
 * passed as the seat's flow-level map. So honouring this would replace the
 * kind's own machinery with a document — a seat file editing its kind's
 * wiring, silently.
 */
const seatResourceCollidesWithKindMessage = (ref: string, kind: string): string =>
  `grants "${ref}", and the \`${kind}\` kind's own blocks already declare a resource under that ` +
  `name. The seat's grant is installed at flow level, where it would REPLACE the kind's — a seat ` +
  `file cannot repoint its kind's wiring. Rename the document, or the kind's accessor.`;

/**
 * The wording for an `rw` grant on a document that declared itself unwritable.
 *
 * `writable` is not a derived key, so a document's own frontmatter may set it.
 * A grant selects from what the app declared; it never widens past it.
 */
const seatResourceRwOnUnwritableMessage = (ref: string): string =>
  `grants "${ref}" \`${SEAT_RESOURCE_MODE_WRITE}\`, and that document declares itself ` +
  `\`writable: false\`. A grant selects from what a document allows; it cannot widen it. ` +
  `Drop the mode to take it read-only, or change the document.`;

/**
 * The wording for a seat that declares `resources:` when the hire step was
 * given no documents to resolve against.
 *
 * Fatal, and not an empty grant: every ref would be unmatched, which is a
 * lockout that reads like a roster full of typos.
 */
const seatResourcesWithoutCatalogMessage = (): string =>
  `declares \`${SEAT_RESOURCES_KEY}:\`, and hireWorkforce was given no documents to resolve it ` +
  `against. Pass the app's documents — \`hireWorkforce(workers, { documents: ` +
  `resourcesFromDocs(documents) })\` — so a ref can be matched against what the app declared.`;

/**
 * The wording for a document a seat did not name that its minted flow reaches
 * anyway — the one failure no inspection of the kind's map can predict.
 *
 * The kind's blocks re-declare it, and a block declaration merges back in
 * AFTER the seat's map has replaced the flow-level one, so the narrowing is
 * undone by the build rather than by anything the seat's file said. Fatal:
 * the alternative is a seat that reads as narrowed and is not.
 */
const seatResourceSurvivedNarrowingMessage = (ref: string, kind: string): string =>
  `was not granted \`${ref}\`, but the flow it is minted with reaches that document anyway: ` +
  `a block on the "${kind}" kind declares it, and a block declaration merges back in after a ` +
  `seat's map replaces the flow-level one. Remove that declaration from the block and keep the ` +
  `document at flow level, or grant \`${ref}\` to this seat deliberately.`;

/** A value as a refusal names it: short, quoted, and never a sprawling dump. */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `a list of ${value.length}`;
  return `a mapping of ${Object.keys(value as object).length} key(s)`;
}

/** What {@link parseSeatResources} found: the grants, or every reason it could not read them. */
export interface ParsedSeatResources {
  /** One entry per document named, in file order. Absent when `problems` is non-empty. */
  grants?: SeatResourceGrant[];
  /** Every problem with the declaration. Collected, never thrown — the hire step owns the refusal. */
  problems: string[];
}

/**
 * Read a seat's `resources:` declaration into grants.
 *
 * **Call this only for a declaration that is PRESENT.** Absent and
 * present-and-empty are different answers all the way down — *nobody
 * restricted this seat* and *this seat is restricted to nothing* — and
 * collapsing them turns the one unambiguous way to say "no access" into its
 * opposite. Whether the key is there is the caller's read; `resources: []`
 * parses here to zero grants and no problems.
 *
 * @param declared The value of the seat's {@link SEAT_RESOURCES_KEY} key, uninterpreted.
 * @returns The grants in file order, or every problem with the declaration.
 */
export function parseSeatResources(declared: unknown): ParsedSeatResources {
  if (!Array.isArray(declared)) {
    return { problems: [malformedSeatResourcesMessage(declared)] };
  }

  const problems: string[] = [];
  const grants: SeatResourceGrant[] = [];
  // Ref → every mode declared for it, in file order. Built for every entry so a
  // ref named three times is reported once, with all three modes.
  const modesByRef = new Map<string, string[]>();

  for (const entry of declared) {
    const read = readEntry(entry);
    if (read.problem !== undefined) {
      problems.push(read.problem);
      continue;
    }
    const { ref, mode } = read;
    // The DECLARED spelling, so a duplicate refusal shows what the file said
    // even when one of the two entries also has a bad mode.
    const spelling = typeof mode === "string" ? mode : describe(mode);
    const seen = modesByRef.get(ref);
    if (seen === undefined) modesByRef.set(ref, [spelling]);
    else seen.push(spelling);

    if (typeof mode !== "string" || !isMode(mode)) {
      problems.push(badSeatResourceModeMessage(ref, mode));
      continue;
    }
    grants.push({ ref, mode });
  }

  for (const [ref, modes] of modesByRef) {
    if (modes.length > 1) problems.push(duplicateSeatResourceMessage(ref, modes));
  }

  if (problems.length > 0) return { problems };
  return { grants, problems };
}

/** One entry, read into a ref and the mode it asked for — or why it is not an entry. */
function readEntry(
  entry: unknown,
): { ref: string; mode: unknown; problem?: undefined } | { problem: string; ref?: undefined; mode?: undefined } {
  // A bare ref. Read-only is what naming a document means (D2).
  if (typeof entry === "string") {
    if (entry.trim().length === 0) return { problem: malformedSeatResourceEntryMessage(entry) };
    return { ref: entry, mode: SEAT_RESOURCE_MODE_READ };
  }

  // `- <ref>: <mode>`, which YAML parses as a one-key mapping. More than one
  // key is an indentation mistake that would otherwise take a grant with it.
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const keys = Object.keys(entry as Record<string, unknown>);
    if (keys.length !== 1) return { problem: malformedSeatResourceEntryMessage(entry) };
    const ref = keys[0]!;
    if (ref.trim().length === 0) return { problem: malformedSeatResourceEntryMessage(entry) };
    // A non-string mode is still reported as a BAD MODE rather than a bad
    // entry: the author named a document and got the second half wrong, and
    // the refusal that names both valid modes is the useful one.
    return { ref, mode: (entry as Record<string, unknown>)[ref] };
  }

  return { problem: malformedSeatResourceEntryMessage(entry) };
}

function isMode(value: string): value is SeatResourceMode {
  return (SEAT_RESOURCE_MODES as readonly string[]).includes(value);
}

/** Everything {@link resolveSeatResources} needs to turn grants into one seat's map. */
export interface ResolveSeatResourcesInput {
  /** The grants, from {@link parseSeatResources}. */
  grants: readonly SeatResourceGrant[];
  /**
   * The app's declared documents, keyed by ref — the map `resourcesFromDocs`
   * returns, handed over by the app.
   *
   * `undefined` means none was supplied, which is a refusal rather than an
   * empty catalog: see {@link seatResourcesWithoutCatalogMessage}.
   */
  catalog: DeclaredResources | undefined;
  /** The kind's MERGED resource map — its own flow-level entries plus what its blocks declare. */
  kindResources: DeclaredResources;
  /** The accessor keys the kind declared at FLOW level, which is the subset a seat's map replaces. */
  kindFlowLevelKeys: ReadonlySet<string>;
  /** The kind's name, for the collision refusal. */
  kind: string;
}

/** What {@link resolveSeatResources} produced: the seat's map, or every reason there is none. */
export interface ResolvedSeatResources {
  /** The map to mint this seat with. Absent when `problems` is non-empty. */
  resources?: DeclaredResources;
  /** Every problem with the grants. Collected, never thrown. */
  problems: string[];
}

/**
 * Turn a seat's grants into the flow-level resource map it is minted with.
 *
 * **Built by subtraction, never assembled from the grants alone.** A flow
 * instance's `resources` option REPLACES the definition's flow-level map, so a
 * map holding only the granted documents also deletes every non-document
 * resource the app declared beside them — its boards, its stores — with no
 * refusal and no warning. So the map starts as the kind's flow-level entries
 * that are NOT documents, and the granted documents are added to it.
 *
 * Which entries are documents is answered by the catalog the app handed over,
 * never inferred from an entry's shape: the boundary of a permission feature
 * cannot rest on a heuristic that would make a board which happens to look
 * like a document grantable.
 *
 * `ro` is the app's own definition with both write flags turned off —
 * `writable` gates code, `llmWritable` gates the model's built-in write tool.
 * Two doors on one document, and closing one would leave a mode that holds
 * against the implementer and not against the model.
 *
 * @param input The grants, the catalog, and the kind's own map. See {@link ResolveSeatResourcesInput}.
 * @returns The seat's flow-level map, or every problem with the grants.
 */
export function resolveSeatResources(input: ResolveSeatResourcesInput): ResolvedSeatResources {
  const { grants, catalog, kindResources, kindFlowLevelKeys, kind } = input;

  if (catalog === undefined) {
    return { problems: [seatResourcesWithoutCatalogMessage()] };
  }

  // What the KIND's blocks declare and the kind does not already shadow:
  // everything on the merged map that the kind did not declare at flow level.
  // A grant colliding with one of these would win the merge and replace it.
  //
  // **This is narrower than "every accessor the kind's blocks declare", and the
  // difference is not reachable.** A block declaration the kind ALSO declares
  // at flow level is already shadowed by that flow-level entry before any seat
  // file exists, so it does not appear on the merged map and cannot be read off
  // a built flow at all. It is also not a hazard: the grant installs the same
  // document the kind already had there, so the seat's map changes nothing
  // about it. Every case where honouring a grant would newly take a name away
  // from the kind's own wiring is in this set.
  const blockAccessors = new Set(
    Object.keys(kindResources).filter((key) => !kindFlowLevelKeys.has(key)),
  );

  const problems: string[] = [];
  for (const { ref, mode } of grants) {
    if (!Object.hasOwn(catalog, ref)) {
      problems.push(unmatchedSeatResourceMessage(ref));
      continue;
    }
    if (blockAccessors.has(ref)) {
      problems.push(seatResourceCollidesWithKindMessage(ref, kind));
      continue;
    }
    // Checked AFTER the collision so a block accessor — which is never a
    // flow-level key — keeps the refusal that names what actually went wrong.
    if (!kindFlowLevelKeys.has(ref)) {
      problems.push(seatResourceNotOnKindMessage(ref, kind));
      continue;
    }
    if (mode === SEAT_RESOURCE_MODE_WRITE && isUnwritable(kindResources[ref])) {
      problems.push(seatResourceRwOnUnwritableMessage(ref));
    }
  }

  if (problems.length > 0) return { problems };

  const resources: DeclaredResources = emptyMap();
  const documents = documentKeys(catalog, kindResources);
  // The subtraction: the kind's flow-level entries that are not documents.
  for (const key of kindFlowLevelKeys) {
    if (documents.has(key)) continue;
    if (!Object.hasOwn(kindResources, key)) continue;
    resources[key] = kindResources[key]!;
  }
  // The grants, from the definition the KIND was installed with — which the
  // check above has already established is there. Not the catalog's copy: the
  // catalog says which entries are documents, and the kind says which of them
  // this seat's flow actually holds.
  for (const { ref, mode } of grants) {
    const declared = kindResources[ref]!;
    resources[ref] = mode === SEAT_RESOURCE_MODE_READ ? readOnly(declared) : declared;
  }

  return { resources, problems };
}

/**
 * Every accessor on a kind's map that holds one of the app's documents.
 *
 * **By name OR by the definition itself**, because a map is an object and an
 * app may expose one definition under a second key —
 * `{ ...documents, handbookAlias: documents.handbook }`. Matching names alone
 * leaves that alias out of the subtraction, so a seat denied the handbook
 * keeps a writable handle on it under another name. The union never recognises
 * fewer documents than the names alone would, so closing this cannot silently
 * widen a seat.
 *
 * A key the app overwrote with something that is NOT a document (a store that
 * happens to share a document's ref) is still dropped by name. That is the safe
 * direction: a seat loses a resource it can be given back deliberately, rather
 * than keeping one the narrowing was supposed to take.
 */
function documentKeys(
  catalog: DeclaredResources,
  kindResources: DeclaredResources,
): ReadonlySet<string> {
  const definitions = new Set<unknown>(Object.values(catalog));
  const keys = new Set<string>();
  for (const key of Object.keys(kindResources)) {
    if (Object.hasOwn(catalog, key) || definitions.has(kindResources[key])) keys.add(key);
  }
  for (const key of Object.keys(catalog)) keys.add(key);
  return keys;
}

/** What {@link verifySeatNarrowing} is asked to check: the seat as it was actually built. */
export interface VerifySeatNarrowingInput {
  /** The MERGED map of the minted instance — what a block will really hold. */
  minted: DeclaredResources | undefined;
  /** The grants that map was built from, by ref. */
  grants: readonly SeatResourceGrant[];
  /** The app's declared documents, keyed by ref. */
  catalog: DeclaredResources;
  /** The kind's name, for the refusal. */
  kind: string;
}

/**
 * Check the seat that was actually minted, and refuse if a document it was
 * denied is reachable anyway.
 *
 * **This exists because no inspection of the kind's map can predict the
 * answer.** A flow instance's `resources` option replaces the definition's
 * flow-level map, and `defineFlow` then merges the blocks' own declarations
 * back on top of the result. So a document declared BOTH at flow level and by
 * one of the kind's blocks is shadowed at definition time — invisible on the
 * merged map, indistinguishable from a document no block mentions — and comes
 * back the moment a seat's map removes the flow-level entry that was hiding
 * it. The seat reads as narrowed, and reaches the document anyway.
 *
 * Reading the built instance answers it instead of predicting it, and answers
 * it for every path the build might take, not the one enumerated here.
 *
 * @param input The minted map, the grants it came from, and the catalog. See {@link VerifySeatNarrowingInput}.
 * @returns Every document that survived a narrowing it should not have. Empty is the pass.
 */
export function verifySeatNarrowing(input: VerifySeatNarrowingInput): string[] {
  const { minted, grants, catalog, kind } = input;
  if (minted === undefined) return [];

  const granted = new Set(grants.map(({ ref }) => ref));
  const definitions = new Set<unknown>(Object.values(catalog));
  const problems: string[] = [];

  // **Identity, not name.** The question here is whether this accessor holds
  // one of the app's documents, and a block resource that merely shares a
  // document's ref is not that document — `BR-8`'s collision refusal is what
  // governs the grant naming it. Flagging by name would refuse the kind that
  // check exists for. What identity cannot see is a block declaring its own
  // COPY of a document; there is no sound test for "a copy of", and the
  // subtraction already drops such an entry by name at flow level.
  for (const key of Object.keys(minted)) {
    if (!definitions.has(minted[key])) continue;
    // Only the DENIAL can be undone this way. A granted `ro` document is
    // installed at flow level as the read-only copy, and a flow-level entry
    // wins the merge over a block's, so the pen cannot come back with it —
    // pinned by V9's read-only case rather than guarded by a branch here that
    // nothing could make fire.
    if (!granted.has(key)) problems.push(seatResourceSurvivedNarrowingMessage(key, kind));
  }

  return problems;
}

/** A declared entry that says it cannot be written, whatever a grant asks for. */
function isUnwritable(entry: DeclaredResourceEntry | undefined): boolean {
  return (entry as { writable?: unknown } | undefined)?.writable === false;
}

/**
 * The seat's read-only copy: the same definition, both write doors shut.
 *
 * A shallow copy rather than a second definition path — the entry IS the config
 * the engine reads, so there is nothing to keep in step.
 */
function readOnly(entry: DeclaredResourceEntry): DeclaredResourceEntry {
  return { ...(entry as object), writable: false, llmWritable: false } as DeclaredResourceEntry;
}
