/**
 * Which message a Windows device name gets from the tree's segment rule.
 *
 * The device list is a platform fact shared with other packages, and the
 * shared check folds case. This rule's lowercase pattern is what refuses every
 * non-lowercase spelling, so `CON` has always been told it is not lowercase,
 * not that it is a device. That ordering is what these cases pin: a device
 * spelled in lowercase gets the device message, any other spelling gets the
 * lowercase message, and `com0`/`lpt0` pass, each message byte for byte.
 */
import { describe, expect, it } from "vitest";
import { validateSegment, type SegmentLabel } from "../src/loader";

/** The exact message `validateSegment` throws, or `null` when it accepts. */
function messageFor(segment: string, label: SegmentLabel): string | null {
  try {
    validateSegment(segment, label);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

const deviceMessage = (what: string, segment: string): string =>
  `${what} "${segment}" is a reserved device name on Windows — a tree ` +
  `containing it cannot be checked out there, whatever the extension`;

describe("Windows device names in a tree segment", () => {
  it.each(["con", "nul", "com1", "lpt9"])(
    "refuses lowercase %s as a device, naming why the tree would break",
    (segment) => {
      expect(messageFor(segment, "Team")).toBe(deviceMessage("Team folder name", segment));
      expect(messageFor(segment, "Document")).toBe(deviceMessage("Document file name", segment));
    },
  );

  it.each(["CON", "Nul", "COM1", "lPt9"])(
    "refuses %s as not lowercase, because the lowercase rule is what catches every other casing",
    (segment) => {
      expect(messageFor(segment, "Team")).toBe(
        `Team folder name "${segment}" must be lowercase letters, digits, and single ` +
          `hyphens (not at the start or end) — it becomes part of the worker's ` +
          `identity, which is joined with a "."`,
      );
    },
  );

  it.each(["com0", "lpt0", "console", "com10"])(
    "accepts %s, an ordinary name on Windows",
    (segment) => {
      expect(messageFor(segment, "Worker")).toBeNull();
    },
  );
});
