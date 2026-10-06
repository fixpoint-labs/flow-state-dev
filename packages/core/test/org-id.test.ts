/**
 * `isValidOrgId`: what the framework accepts as an organization id at the
 * principal boundary.
 *
 * Drop the lone-surrogate check and the second case fails: `"\uD800"` would be
 * admitted, and anything that UTF-8-encodes the id (a storage key, a hired
 * seat's address) maps it onto the same bytes as `"�"`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, isValidOrgId } from "../src/types/auth";

describe("isValidOrgId", () => {
  it("accepts any well-formed nonempty id, including the default org and emoji", () => {
    for (const id of ["acme", "org_pentest_lab", DEFAULT_ORG_ID, "acme.support", "�", "😀"]) {
      expect(isValidOrgId(id), id).toBe(true);
    }
  });

  it("refuses an id holding a lone surrogate, high or low", () => {
    for (const id of ["\uD800", "acme\uD800", "\uDC00acme", "a\uDC00\uD800b"]) {
      expect(isValidOrgId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it("refuses empty, whitespace-only and non-string values", () => {
    for (const value of ["", "   ", undefined, null, 7]) {
      expect(isValidOrgId(value)).toBe(false);
    }
  });
});
