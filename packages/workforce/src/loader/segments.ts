/**
 * What a name in the tree is allowed to be — a team, worker or channel folder,
 * or a document file.
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
 * Names Windows reserves for DOS devices, which it refuses **with any
 * extension** — `con.ts` and `nul.md` are as unopenable as `con`.
 *
 * They pass `SEGMENT_PATTERN` (they are lowercase letters and digits), so
 * without this a tree authored on macOS or Linux generates and commits
 * cleanly, and the repository then cannot be checked out on Windows at all.
 * The failure lands on someone who did not write the file and reads as a
 * broken clone rather than as a naming mistake.
 *
 * Checked in lowercase only, which is sufficient because the pattern above
 * already refuses every other casing. `clock$` needs no entry — `$` is not in
 * the allowlist.
 *
 * The numbered devices run **1–9, not 0–9**: `COM0` and `LPT0` are ordinary
 * names on Windows, and refusing them would cost an author two portable names
 * at every level of the tree for nothing. The same list, to the same bound,
 * is in `engine`'s filesystem store — `workforce` denies `engine`, so the two
 * cannot share it today.
 */
const DOS_DEVICE_SEGMENTS: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, n) => `com${n + 1}`),
  ...Array.from({ length: 9 }, (_, n) => `lpt${n + 1}`),
]);

/**
 * What a segment names, for the error to say.
 *
 * `Team` and `Worker` are the two halves of a seat's address, and `Channel` is
 * the second half of a channel's — dot-joined the same way, because a channel
 * id is a flow instance id and a session id. `Document` is a file-declared
 * resource's name — the one segment that is a *file* rather than a folder, and
 * the one whose identity is joined with a `/` rather than a `.`, because a
 * document's ref is a storage-key namespace and never routes.
 *
 * `Kind` and `Block` are the other two file-named levels: a flow file's
 * basename under `workforce/flows/`, which becomes a kind name on the map an
 * app registers, and a block file's basename under `workforce/blocks/`, which
 * becomes the name a task board assigns by. They obey the same rule as every
 * other segment for the same reason the rest do — a kind name is half of a
 * minted flow instance id, and both are a path on disk at the same time.
 *
 * `Org` is the one label that names **nothing on disk**. It is the leading
 * segment of a runtime-hired seat's address (`<org>.<seatId>`), and it is
 * here rather than in a rule of its own because the `.` exclusion below is
 * precisely what that address needs: org `acme` with seat `support.ada` and
 * org `acme.support` with seat `ada` both spell `acme.support.ada`, so
 * admitting a dotted org would make the join non-injective and one seat would
 * silently answer at the other's address. Sharing the rule does mean an org
 * inherits two constraints it has no need of — the reserved folder name and
 * the Windows device names — which costs a handful of unusable org ids and
 * buys one rule instead of two that can drift.
 */
export type SegmentLabel = "Team" | "Worker" | "Channel" | "Document" | "Kind" | "Block" | "Org";

/**
 * Labels whose segment is a *file* rather than a folder. Held as a set rather
 * than as a comparison so adding a label cannot leave the wording behind.
 */
const FILE_LABELS: ReadonlySet<SegmentLabel> = new Set<SegmentLabel>(["Document", "Kind", "Block"]);

/** Validate one path segment against the naming rules. Throws on a break. */
export function validateSegment(segment: string, label: SegmentLabel): void {
  // `Org` names nothing on disk, so neither "file" nor "folder" is true of it.
  const what =
    label === "Org"
      ? "Organization id"
      : `${label} ${FILE_LABELS.has(label) ? "file" : "folder"} name`;

  if (segment.length > MAX_SEGMENT_LENGTH) {
    throw new Error(`${what} "${segment}" exceeds ${MAX_SEGMENT_LENGTH} characters`);
  }
  if (RESERVED_SEGMENTS.has(segment)) {
    throw new Error(`${what} "${segment}" is reserved`);
  }
  if (DOS_DEVICE_SEGMENTS.has(segment)) {
    throw new Error(
      `${what} "${segment}" is a reserved device name on Windows — a tree ` +
        `containing it cannot be checked out there, whatever the extension`,
    );
  }
  if (!SEGMENT_PATTERN.test(segment)) {
    const identity =
      label === "Org"
        ? `it becomes the leading segment of a hired seat's address, which is joined with a "."`
        : label === "Document"
        ? `it becomes part of the document's ref, which is joined with a "/"`
        : label === "Channel"
          ? `it becomes part of the channel's identity, which is joined with a "."`
          : label === "Kind"
            ? `it becomes the kind's name, which a worker file's \`flow:\` names and a minted flow instance id is built from`
            : label === "Block"
              ? `it becomes the name the block registers under, which a task board assigns by`
              : `it becomes part of the worker's identity, which is joined with a "."`;
    throw new Error(
      `${what} "${segment}" must be lowercase letters, digits, and single ` +
        `hyphens (not at the start or end) — ${identity}`,
    );
  }
}
