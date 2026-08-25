/**
 * FIX-1009 unit coverage for the parentage list-filter predicate in
 * `stores/scope-keys.ts`. This is the single definition the memory and
 * filesystem stores import and the two SQL adapters mirror in their `WHERE`
 * builders, so these cases are the cross-adapter contract.
 *
 * The invariant that is easy to state wrongly: the default is *top-level*,
 * not "no parentage filtering". Every case that seeds a parented row exists
 * so the test can fail if the default ever reverts to unrestricted.
 */
import { describe, expect, it } from "vitest";
import { matchesParentageFilter } from "../src/stores/scope-keys";

describe("matchesParentageFilter", () => {
  describe("the default — absence narrows", () => {
    it("hides a parented record when options are absent entirely", () => {
      expect(matchesParentageFilter(undefined, "sess_parent")).toBe(false);
    });

    it("keeps a top-level record when options are absent entirely", () => {
      expect(matchesParentageFilter(undefined, undefined)).toBe(true);
    });

    it("hides a parented record when the parentage key is absent", () => {
      expect(matchesParentageFilter({ userId: "u" }, "sess_parent")).toBe(false);
    });

    it("keeps a top-level record when the parentage key is absent", () => {
      expect(matchesParentageFilter({ userId: "u" }, undefined)).toBe(true);
    });
  });

  describe("absent and explicit \"top-level\" are the same mode", () => {
    // Decision 2 accepts two spellings for one mode. Their equivalence is
    // asserted once, here, rather than duplicated per adapter.
    it("agrees with absence on every record shape", () => {
      for (const recordParent of [undefined, null, "sess_parent"] as const) {
        expect(matchesParentageFilter({ parentage: "top-level" }, recordParent ?? undefined)).toBe(
          matchesParentageFilter({}, recordParent ?? undefined)
        );
      }
    });

    it("treats an explicitly undefined parentage as top-level", () => {
      expect(matchesParentageFilter({ parentage: undefined }, "sess_parent")).toBe(false);
      expect(matchesParentageFilter({ parentage: undefined }, undefined)).toBe(true);
    });
  });

  describe("BP-030 — a record persisted before the field existed", () => {
    it("reads an absent parent as top-level", () => {
      expect(matchesParentageFilter({ parentage: "top-level" }, undefined)).toBe(true);
    });

    it("reads a JSON null parent as top-level (the guard is `== null`)", () => {
      // A store that nulls absent keys on round-trip hands back null, not
      // undefined. `=== undefined` would wrongly classify this as a child.
      expect(
        matchesParentageFilter({ parentage: "top-level" }, null as unknown as undefined)
      ).toBe(true);
    });
  });

  describe("\"all\" — today's unrestricted behaviour, on purpose", () => {
    it("returns every record regardless of parentage", () => {
      expect(matchesParentageFilter({ parentage: "all" }, undefined)).toBe(true);
      expect(matchesParentageFilter({ parentage: "all" }, "sess_parent")).toBe(true);
      expect(matchesParentageFilter({ parentage: "all" }, null as unknown as undefined)).toBe(true);
    });
  });

  describe("{ parentOf } — one parent's children", () => {
    it("matches only that parent's children", () => {
      expect(matchesParentageFilter({ parentage: { parentOf: "sess_a" } }, "sess_a")).toBe(true);
      expect(matchesParentageFilter({ parentage: { parentOf: "sess_a" } }, "sess_b")).toBe(false);
    });

    it("excludes top-level records", () => {
      expect(matchesParentageFilter({ parentage: { parentOf: "sess_a" } }, undefined)).toBe(false);
      expect(
        matchesParentageFilter({ parentage: { parentOf: "sess_a" } }, null as unknown as undefined)
      ).toBe(false);
    });

    it("does not coerce an empty parentOf into top-level", () => {
      // §9: an empty id is a sentinel by accident if it widens. It must match
      // nothing, not fall back to the default mode.
      expect(matchesParentageFilter({ parentage: { parentOf: "" } }, undefined)).toBe(false);
      expect(matchesParentageFilter({ parentage: { parentOf: "" } }, "sess_a")).toBe(false);
    });
  });
});
