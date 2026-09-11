/**
 * What a name in the tree is allowed to be — a team or worker folder, or a
 * document file.
 *
 * One rule, shared by every reader that names a level of the tree, because the
 * readers must agree on it for the same reason a worker id and a path must: the
 * segment is a path on disk and half of an identity at the same time. A reader
 * that accepted a name another refused would load a thing that cannot be
 * addressed, or address one that cannot be loaded.
 *
 * The rule is also what keeps a caller-supplied segment inside the configured
 * root. A segment reaches these readers from an argument as well as from a
 * walk, and `..` in one would read a folder the caller never configured — the
 * same escape the walk's symlink refusal exists to stop.
 */

/**
 * Pattern a team or worker folder name must match: lowercase `a-z`/`0-9` runs
 * joined by single hyphens. These are the skill-name rules, adopted rather than
 * shared: the minted identity becomes a flow instance id and a board key, while
 * each segment is separately a path segment on disk, and lowercase-hyphen is the
 * one shape safe in all of them.
 *
 * The allowlist excludes `.`, and that exclusion is load-bearing rather than
 * incidental: `.` is the joiner, so a dotted segment would make the minted id
 * impossible to split back into a team and a name — `a.b.lead` could be read
 * two ways. Do not relax this to admit `.`.
 */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest legal team or worker folder name. */
const MAX_SEGMENT_LENGTH = 64;

/** Folder names the framework reserves. */
const RESERVED_SEGMENTS = new Set(["_meta"]);

/**
 * What a segment names, for the error to say.
 *
 * `Team` and `Worker` are the two halves of a seat's address. `Document` is a
 * file-declared resource's name — the one segment that is a *file* rather than
 * a folder, and the one whose identity is joined with a `/` rather than a `.`,
 * because a document's ref is a storage-key namespace and never routes.
 */
export type SegmentLabel = "Team" | "Worker" | "Document";

/** Validate one path segment against the naming rules. Throws on a break. */
export function validateSegment(segment: string, label: SegmentLabel): void {
  const what = `${label} ${label === "Document" ? "file" : "folder"} name`;

  if (segment.length > MAX_SEGMENT_LENGTH) {
    throw new Error(`${what} "${segment}" exceeds ${MAX_SEGMENT_LENGTH} characters`);
  }
  if (RESERVED_SEGMENTS.has(segment)) {
    throw new Error(`${what} "${segment}" is reserved`);
  }
  if (!SEGMENT_PATTERN.test(segment)) {
    const identity =
      label === "Document"
        ? `it becomes part of the document's ref, which is joined with a "/"`
        : `it becomes part of the worker's identity, which is joined with a "."`;
    throw new Error(
      `${what} "${segment}" must be lowercase letters, digits, and single ` +
        `hyphens (not at the start or end) — ${identity}`,
    );
  }
}
