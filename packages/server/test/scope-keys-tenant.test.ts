/**
 * FIX-682 unit coverage for the tenant key helpers in `stores/scope-keys.ts`:
 * session-key namespacing, its inverse, and the list-filter predicate's
 * present-vs-absent semantics. These encode the contract the stores and routes
 * depend on for tenant isolation.
 */
import { describe, expect, it } from "vitest";
import {
  matchesTenantFilter,
  resolveSessionStorageKey,
  toBareSessionId
} from "../src/stores/scope-keys";

describe("resolveSessionStorageKey", () => {
  it("returns the bare session id when no tenant is present", () => {
    expect(resolveSessionStorageKey("sess_1", undefined)).toBe("sess_1");
  });

  it("treats an empty tenant as single-tenant (bare key)", () => {
    expect(resolveSessionStorageKey("sess_1", "")).toBe("sess_1");
  });

  it("namespaces by tenant when present", () => {
    expect(resolveSessionStorageKey("sess_1", "acme")).toBe("acme:sess_1");
  });
});

describe("toBareSessionId", () => {
  it("round-trips a namespaced key back to the bare id", () => {
    const key = resolveSessionStorageKey("sess_1", "acme");
    expect(toBareSessionId(key, "acme")).toBe("sess_1");
  });

  it("is a no-op without a tenant", () => {
    expect(toBareSessionId("sess_1", undefined)).toBe("sess_1");
  });

  it("leaves an unprefixed key unchanged", () => {
    expect(toBareSessionId("sess_1", "acme")).toBe("sess_1");
  });
});

describe("matchesTenantFilter", () => {
  it("passes every record when the tenantId key is absent", () => {
    expect(matchesTenantFilter({ userId: "u" }, "acme")).toBe(true);
    expect(matchesTenantFilter({ userId: "u" }, undefined)).toBe(true);
    expect(matchesTenantFilter(undefined, "acme")).toBe(true);
  });

  it("exact-matches when the tenantId key is present", () => {
    expect(matchesTenantFilter({ tenantId: "acme" }, "acme")).toBe(true);
    expect(matchesTenantFilter({ tenantId: "acme" }, "globex")).toBe(false);
  });

  it("matches only no-tenant records when present-but-undefined", () => {
    expect(matchesTenantFilter({ tenantId: undefined }, undefined)).toBe(true);
    expect(matchesTenantFilter({ tenantId: undefined }, "acme")).toBe(false);
  });
});
