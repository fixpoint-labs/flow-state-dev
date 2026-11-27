/**
 * What a name in the tree is allowed to be — a team or worker folder,
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
import { MAX_SEGMENT_LENGTH, segmentNameProblem } from "@flow-state-dev/core/helpers";

/**
 * What a segment names, for the error to say.
 *
 * `Team` and `Worker` are the two halves of a worker's address. `Document` is a file-declared
 * resource's name — the one segment that is a *file* rather than a folder, and
 * the one whose identity is joined with a `/` rather than a `.`, because a
 * document's ref is a storage-key namespace and never routes.
 *
 * `Worker flow` and `Block` are the other two file-named levels: a flow file's
 * basename under `workforce/flows/`, which becomes a flow name on the map an
 * app registers, and a block file's basename under `workforce/blocks/`, which
 * becomes the name a task board assigns by. They obey the same rule as every
 * other segment for the same reason the rest do — a flow name is half of a
 * minted copy's id, and both are a path on disk at the same time.
 *
 * `Package` is a folder under a `packages/` slot. Its name is what a worker's
 * `packages:` line takes it by and half of the address its blocks are
 * registered under, so it obeys the rule every other name does.
 */
export type SegmentLabel =
  | "Team"
  | "Worker"
  | "Document"
  | "Worker flow"
  | "Block"
  | "Package";

/**
 * Labels whose segment is a *file* rather than a folder. Held as a set rather
 * than as a comparison so adding a label cannot leave the wording behind.
 */
const FILE_LABELS: ReadonlySet<SegmentLabel> = new Set<SegmentLabel>(["Document", "Worker flow", "Block"]);

/** Validate one path segment against the naming rules. Throws on a break. */
export function validateSegment(segment: string, label: SegmentLabel): void {
  const what = `${label} ${FILE_LABELS.has(label) ? "file" : "folder"} name`;

  // The rule itself is core's (`segmentNameProblem`), shared with kit names;
  // the wording is this reader's, since it knows what the segment names.
  const problem = segmentNameProblem(segment);
  if (problem === "too-long") {
    throw new Error(`${what} "${segment}" exceeds ${MAX_SEGMENT_LENGTH} characters`);
  }
  if (problem === "reserved") {
    throw new Error(`${what} "${segment}" is reserved`);
  }
  if (problem === "pattern") {
    const identity =
      label === "Document"
        ? `it becomes part of the document's ref, which is joined with a "/"`
        : label === "Worker flow"
          ? `it becomes the worker flow's name, which a worker file's \`flow:\` names`
          : label === "Block"
            ? `it becomes the name the block registers under, which a task board assigns by`
            : label === "Package"
              ? `it becomes the name a worker's \`packages:\` takes the package by`
              : `it becomes part of the worker's identity, which is joined with a "."`;
    throw new Error(
      `${what} "${segment}" must be lowercase letters, digits, and single ` +
        `hyphens (not at the start or end) — ${identity}`,
    );
  }
  // A DOS device name, refused **with any extension** on Windows: a tree
  // authored on macOS or Linux would commit cleanly and then not check out
  // there, landing on someone who did not write the file.
  if (problem === "windows-device") {
    throw new Error(
      `${what} "${segment}" is a reserved device name on Windows — a tree ` +
        `containing it cannot be checked out there, whatever the extension`,
    );
  }
}
