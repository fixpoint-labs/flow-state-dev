/**
 * Where a resource lives, and what names it.
 *
 * The convention covers two slots — `resources/` and `references/` — read by
 * two doors: the Markdown reader in `read-resources-directory.ts`, and the
 * module walk in `../codegen` that finds the TypeScript beside it. They are
 * separate readers on purpose — one reader holding two conventions is the
 * mega-loader the shared walk primitives exist to prevent — but they are not
 * allowed to disagree about **which folders the convention covers** or **what a
 * file in one is called**.
 *
 * So the folder names, the document extension and the ref rule live here, once.
 * Two spellings of one ref is how a module and a document silently overwrite
 * each other, and the check that refuses a basename claimed by both can only
 * refuse what both sides minted the same way.
 *
 * **Both slots mint into ONE namespace.** `references/handbook.md` and
 * `resources/handbook.md` at the same level are two spellings of the ref
 * `handbook`, which is why the collision is refused rather than resolved: the
 * two behave differently — one is read from the file and sealed, the other
 * seeds a row and then evolves — so whichever won would be a coin flip an
 * author never sees.
 *
 * Pure: no `node:fs`. It ships behind `./loader` because that is where its
 * callers are, not because it touches a disk.
 */

import { validateSegment } from "./segments";

/** The slot a resource sits in, under any of the roots the convention reads. */
export const RESOURCES_SLOT = "resources";

/**
 * The slot a REFERENCE sits in, at the same levels {@link RESOURCES_SLOT} sits
 * at and minted by the same {@link mintResourceRef}.
 *
 * A reference is a read path, not a second kind of resource: its body is read
 * from the file rather than from a stored row, and no write path reaches it.
 * The folder is what carries that — a file does not opt in, and cannot opt out.
 * What "no write path" covers exactly, and the one thing it does not, is in
 * `../references-from-docs`.
 */
export const REFERENCES_SLOT = "references";

/**
 * Both slots, in the order a collision refusal lists them.
 *
 * Read from here by every walk, never spelled as a literal, for the reason the
 * ref rule lives here: a door that knows one slot and not the other is a folder
 * an author writes into and nothing reads.
 */
export const DOCUMENT_SLOTS = [RESOURCES_SLOT, REFERENCES_SLOT] as const;

/** One of {@link DOCUMENT_SLOTS}. */
export type DocumentSlot = (typeof DOCUMENT_SLOTS)[number];

/**
 * The same path with its slot segment swapped for the other slot's.
 *
 * "This path's sibling in the other slot" is a derived fact about the
 * convention, so it belongs here with the folder names rather than being worked
 * out at each call site — which is where it was, twice, in two directions: the
 * module walk sliced a trailing `resources` off and concatenated, and the
 * roster join did a separator-aware replace. The slice was the fragile half. It
 * assumed the path ended in exactly the slot with nothing after it, which held
 * only because of how its callers happened to build the string.
 *
 * Swaps the LAST occurrence, because a path may legitimately contain the slot
 * name higher up — a team called `references` is a legal team.
 *
 * @param at The path, in whatever separator its caller uses.
 * @param from The slot `at` sits in.
 * @param to The slot to address instead.
 * @param sep The separator `at` is written with. Slash for the loader's
 *   root-relative paths, `path.sep` for an absolute one.
 * @returns The sibling path, or `at` unchanged when it holds no `from` segment.
 */
export function siblingSlotPath(
  at: string,
  from: DocumentSlot,
  to: DocumentSlot,
  sep = "/",
): string {
  const segments = at.split(sep);
  // Last, not first: only the trailing one is the slot this path sits in.
  const slotAt = segments.lastIndexOf(from);
  if (slotAt === -1) return at;
  segments[slotAt] = to;
  return segments.join(sep);
}

/** The level a worker's folder sits in, under `org/` and under every team. */
export const WORKERS_LEVEL = "workers";

/** The extension a document is written in. Anything else is not a document. */
export const DOCUMENT_EXTENSION = ".md";

/**
 * Mint a resource's whole identity from where it sits. Four forms, one per
 * place a `resources/` slot can be:
 *
 * - `"<name>"` — the org level
 * - `"teams/<teamId>/<name>"` — a team's
 * - `"workers/<workerName>/<name>"` — an org worker's, dropping `org/` exactly
 *   as an org document's ref does
 * - `"teams/<teamId>/workers/<workerName>/<name>"` — a team worker's
 *
 * The one place this string is built, for a document and for a module alike.
 * Both optional parameters are read rather than overloaded, because the four
 * combinations ARE the four refs: a call site passes what it has and never
 * picks between shapes.
 *
 * Qualified by the folders above it so two teams — and two seats in one team —
 * can each have a `handbook` without coordinating names, and **path-joined, not
 * dot-joined**: the atlas fixes this key as a path, so a dotted ref would put
 * the same logical document at a different org storage row from anything else
 * following the atlas. The worker id's reason for dot-joining does not carry
 * across — a worker id becomes a flow instance id and a slashed one fails to
 * route, while a resource ref is a storage-key namespace and never routes.
 *
 * A `workers/` first segment cannot be confused with a `teams/` one or with a
 * single-segment org name: the segment rules admit neither `/` nor `.`, so no
 * legal document, team or worker name is ever the string `teams` followed by a
 * separator.
 *
 * The `Document` label on the final segment is the file's, whichever door read
 * it: a module's basename is a resource ref exactly as a document's is, and a
 * name one door accepted while the other refused would be a thing that can be
 * generated and never addressed, or the reverse.
 *
 * Throws when a segment breaks the rules, naming the rule.
 */
export function mintResourceRef(
  teamId: string | undefined,
  workerName: string | undefined,
  name: string,
): string {
  // Identity first, and validated outermost-in, so the message names the
  // segment highest in the tree when more than one is unusable.
  const prefix: string[] = [];
  if (teamId !== undefined) {
    validateSegment(teamId, "Team");
    prefix.push("teams", teamId);
  }
  if (workerName !== undefined) {
    validateSegment(workerName, "Worker");
    prefix.push(WORKERS_LEVEL, workerName);
  }
  validateSegment(name, "Document");
  return [...prefix, name].join("/");
}
