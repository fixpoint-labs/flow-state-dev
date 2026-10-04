/**
 * Unit tests for the shared resource-state write-version rule. Every
 * `ResourceStateStore` adapter calls these, so what they refuse and what a
 * conflict reports is the contract for all of them; the engine's conformance
 * suite pins the same behaviour through each adapter end to end.
 */
import { describe, expect, it } from "vitest";
import {
  assertDeleteExpectedVersion,
  assertSetExpectedVersion,
  resourceStateConflict,
  type VersionedRow
} from "../src/helpers/write-version";

const numericMessage = (received: string): string =>
  `expectedVersion must be a non-negative integer or "any", received ${received}`;

// Every value `ExpectedVersion` admits statically that cannot name a version.
// `-1` matters most: both SQL stores use it as an in-band "any" marker.
const notVersions: Array<[number, string]> = [
  [-1, "-1"],
  [1.5, "1.5"],
  [Number.NaN, "NaN"],
  [Number.POSITIVE_INFINITY, "Infinity"],
  [Number.NEGATIVE_INFINITY, "-Infinity"]
];

describe("assertSetExpectedVersion", () => {
  it('accepts "any", "absent", 0 and positive whole numbers', () => {
    for (const ok of ["any", "absent", 0, 1, 42] as const) {
      expect(() => assertSetExpectedVersion(ok)).not.toThrow();
    }
  });

  it("refuses a number that cannot name a version with a TypeError, never a conflict", () => {
    for (const [invalid, received] of notVersions) {
      expect(() => assertSetExpectedVersion(invalid)).toThrow(new TypeError(numericMessage(received)));
    }
  });

  it("refuses a value outside the union rather than narrowing it away", () => {
    expect(() => assertSetExpectedVersion("latest" as never)).toThrow(TypeError);
  });
});

describe("assertDeleteExpectedVersion", () => {
  it('accepts "any", 0 and positive whole numbers', () => {
    for (const ok of ["any", 0, 1, 42] as const) {
      expect(() => assertDeleteExpectedVersion(ok)).not.toThrow();
    }
  });

  it('refuses "absent" with a message that points the caller at 0', () => {
    expect(() => assertDeleteExpectedVersion("absent")).toThrow(
      new TypeError(
        'expectedVersion "absent" is not supported by ResourceStateStore.delete; use 0, which means "no live row" here'
      )
    );
  });

  it("refuses the same numbers set refuses, with the same message", () => {
    for (const [invalid, received] of notVersions) {
      expect(() => assertDeleteExpectedVersion(invalid)).toThrow(new TypeError(numericMessage(received)));
    }
  });
});

describe("resourceStateConflict", () => {
  it("reports a live row's value and version", () => {
    const row: VersionedRow<{ n: number }> = { state: { n: 1 }, version: 3, lifecycle: "live" };
    expect(resourceStateConflict(row)).toEqual({
      ok: false,
      conflict: { currentValue: { n: 1 }, currentVersion: 3 }
    });
  });

  it("reports no value for a tombstone, but keeps its version, so a deleted resource reads as terminal", () => {
    const row: VersionedRow<{ n: number }> = { state: { n: 1 }, version: 4, lifecycle: "deleted" };
    expect(resourceStateConflict(row)).toEqual({
      ok: false,
      conflict: { currentValue: undefined, currentVersion: 4 }
    });
  });

  it("reports no value and version 0 when there is no row", () => {
    expect(resourceStateConflict(undefined)).toEqual({
      ok: false,
      conflict: { currentValue: undefined, currentVersion: 0 }
    });
  });

  it("copies the value, so the losing writer cannot mutate the stored row through it", () => {
    const row: VersionedRow<{ nested: { n: number } }> = {
      state: { nested: { n: 1 } },
      version: 1,
      lifecycle: "live"
    };
    const result = resourceStateConflict(row);
    result.conflict.currentValue!.nested.n = 99;
    expect(row.state.nested.n).toBe(1);
  });
});
