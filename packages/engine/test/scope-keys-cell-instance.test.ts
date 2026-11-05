/**
 * `resourceCellInstance` reads back which instance a user or org resource cell
 * is isolated to. The index writer relies on it to run only the declarations
 * that own the cell being written, so it must invert `resolveResourceScopeId`
 * exactly, ids carrying the `:` delimiter and the `\` escape included.
 */
import { describe, expect, it } from "vitest";
import {
  resolveResourceScopeId,
  resourceCellInstance,
} from "../src/stores/scope-keys";

describe("resourceCellInstance", () => {
  const identities = [
    { userId: "alice", orgId: "acme" },
    { userId: "u:a", orgId: "acme" },
    { userId: "u\\x", orgId: "acme" },
  ];
  const flows = ["ledger", "a:b", "c\\d"];

  it("returns the isolated instance, or null for the shared cell, for every key resolveResourceScopeId builds", () => {
    for (const identity of identities) {
      for (const id of flows) {
        for (const scope of ["user", "org"] as const) {
          expect(
            resourceCellInstance(
              scope,
              resolveResourceScopeId(identity, { id }, scope, true),
            ),
          ).toBe(id);
          expect(
            resourceCellInstance(
              scope,
              resolveResourceScopeId(identity, { id }, scope, false),
            ),
          ).toBeNull();
        }
      }
    }
  });

  it("returns undefined for a scopeId of no shape the engine builds", () => {
    expect(resourceCellInstance("user", "alice")).toBeUndefined();
    expect(resourceCellInstance("user", "alice:~team:acme")).toBeUndefined();
    expect(resourceCellInstance("org", "acme:ledger:extra")).toBeUndefined();
  });
});
