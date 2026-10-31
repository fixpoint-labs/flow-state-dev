/**
 * The issue a coding run is for, and its spec brief.
 *
 * A run can be told which tracker issue it works on (`FIX-2165`): a harness
 * session is born with one, and a board task names one under
 * `harnessFeature: { issue }`. This module holds the two things both entries
 * share about it:
 *
 * - **The grammar** ({@link isTrackerIssue}): letters and digits in runs
 *   joined by single `-` or `_`, so the key can be a path segment and a git
 *   ref component as it is, and can never climb out of a directory.
 * - **The brief** ({@link readIssueSpecSection}): the issue's spec file read
 *   from the run's own checkout, as the section that opens its prompt. Opt-in
 *   through each entry's `issueSpec` option; a host that doesn't pass it gets
 *   none of this.
 *
 * A missing spec is one line, never a failure: an issue filed without a spec
 * is ordinary, and the run still has its goal.
 */
import { open } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";

import { OWNED_SEGMENT } from "./identity";

/** The longest issue key accepted: the same bound every owned identity segment has. */
const MAX_ISSUE_LENGTH = 64;

/** How much of a spec file the brief carries before it cuts the rest (E3: 64 KB). */
export const ISSUE_SPEC_MAX_BYTES = 64 * 1024;

/** True when `value` is a usable tracker issue key, such as `FIX-2165`. */
export function isTrackerIssue(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ISSUE_LENGTH && OWNED_SEGMENT.test(value);
}

/** The message a malformed issue is refused with, naming the value's shape rather than echoing it whole. */
export const TRACKER_ISSUE_REFUSED =
  "An issue is a tracker key such as FIX-2165: letters and digits joined by single - or _, at most 64 characters.";

/** Options for the spec brief. */
export interface IssueSpecOptions {
  /**
   * The spec file for an issue, relative to the run's checkout. Default
   * `specs/issues/<ISSUE>/SPEC.md`. A path that leaves the checkout is
   * refused when read.
   */
  path?: (issue: string) => string;
}

/** An entry's `issueSpec` option: `true` for the defaults, or the options. Absent or `false` is off. */
export type IssueSpecOption = boolean | IssueSpecOptions;

/** The default spec path: this repository's convention. */
export function defaultIssueSpecPath(issue: string): string {
  return `specs/issues/${issue}/SPEC.md`;
}

/** The options an `issueSpec` value turns on, or `undefined` when it is off. */
export function issueSpecOptions(option: IssueSpecOption | undefined): IssueSpecOptions | undefined {
  if (option === undefined || option === false) return undefined;
  return option === true ? {} : option;
}

/**
 * The section that opens a run's brief: the issue, and its spec as the
 * checkout at `cwd` holds it.
 *
 * Read fresh each call, so an attempt sees the spec its checkout has now.
 * Cut at {@link ISSUE_SPEC_MAX_BYTES} with a line saying so. A missing or
 * unreadable file is said in one line. A path that leaves the checkout is
 * said the same way and nothing is read.
 *
 * @param cwd The run's checkout, already provisioned.
 * @param issue The issue key; checked by {@link isTrackerIssue} before it is used in a path.
 * @param options Where the spec lives.
 * @returns The section, as Markdown, starting with a `##` heading.
 */
export async function readIssueSpecSection(cwd: string, issue: string, options: IssueSpecOptions = {}): Promise<string> {
  const heading = `## This work is for issue ${issue}`;
  if (!isTrackerIssue(issue)) return `${heading}\n\n${TRACKER_ISSUE_REFUSED} No spec was read.`;
  const relativePath = normalize((options.path ?? defaultIssueSpecPath)(issue));
  const absolute = join(cwd, relativePath);
  const inside = relative(cwd, absolute);
  if (isAbsolute(relativePath) || inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    return `${heading}\n\nIts spec path, ${relativePath}, is outside this checkout, so no spec was read.`;
  }
  let text: string;
  let cut = false;
  try {
    const file = await open(absolute, "r");
    try {
      const buffer = Buffer.alloc(ISSUE_SPEC_MAX_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      cut = bytesRead > ISSUE_SPEC_MAX_BYTES;
      text = buffer.subarray(0, Math.min(bytesRead, ISSUE_SPEC_MAX_BYTES)).toString("utf8");
    } finally {
      await file.close();
    }
  } catch {
    return `${heading}\n\nThere is no spec for it at ${relativePath} in this checkout. Work from the task as given.`;
  }
  // A cut can land inside a multi-byte character; drop the replacement it decodes to.
  if (cut) text = text.replace(/�$/, "");
  return (
    `${heading}\n\nIts spec, from ${relativePath} in this checkout, follows. Read it before you change anything.\n\n` +
    `${text.trimEnd()}` +
    (cut ? `\n\n(The spec is longer than ${ISSUE_SPEC_MAX_BYTES / 1024} KB and was cut here. Read the rest from the file.)` : "")
  );
}
