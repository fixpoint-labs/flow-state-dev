/**
 * The naming rule for a name that is a path segment on disk and half of an
 * identity at the same time: a kit's name, and a team, worker, document, flow,
 * block or package name in a workforce folder.
 *
 * One rule, shared, because every reader that names a level of a tree must
 * agree on it: a reader that accepted a name another refused would load a
 * thing that cannot be addressed, or address one that cannot be loaded. Pure
 * and browser-safe, so code that only checks a name never pulls in `node:fs`.
 */
import { isWindowsReservedName } from "./windows-reserved-name";

/**
 * Lowercase `a-z`/`0-9` runs joined by single hyphens.
 *
 * The allowlist excludes `.`, and that is load-bearing: `.` is the joiner of
 * every identity minted from these names (`team.worker`, `kit.slot`), so a
 * dotted segment would make the identity impossible to split back. Do not
 * relax this to admit `.`.
 */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest legal segment. */
export const MAX_SEGMENT_LENGTH = 64;

/** Names the framework reserves. */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(["_meta"]);

/**
 * Which part of the naming rule a segment breaks, checked in this order.
 *
 * - `too-long`: over {@link MAX_SEGMENT_LENGTH} characters.
 * - `reserved`: a name the framework keeps for itself.
 * - `pattern`: not lowercase letters, digits and single inner hyphens.
 * - `windows-device`: a DOS device name Windows refuses with any extension
 *   (`con`, `nul`), which would make a repository holding it impossible to
 *   check out there.
 */
export type SegmentNameProblem = "too-long" | "reserved" | "pattern" | "windows-device";

/**
 * The first part of the naming rule `segment` breaks, or `undefined` when the
 * name is legal. The caller words the refusal, since what the name is (a kit,
 * a team folder, a document file) belongs to the caller.
 */
export function segmentNameProblem(segment: string): SegmentNameProblem | undefined {
  if (segment.length > MAX_SEGMENT_LENGTH) return "too-long";
  if (RESERVED_SEGMENTS.has(segment)) return "reserved";
  if (!SEGMENT_PATTERN.test(segment)) return "pattern";
  // After the pattern on purpose: the pattern already refuses every
  // non-lowercase spelling, so only a lowercase device name reaches this.
  if (isWindowsReservedName(segment)) return "windows-device";
  return undefined;
}
