/**
 * Type-level regression for FIX-507 — `StateChangeItem` and `ResourceChangeItem`
 * now derive from a shared `InvalidationItem` base. TypeScript intersection types
 * narrow, never widen, so the base must carry the loosest shape (widest `scope`
 * union, optional `version`) and each leaf re-declares the field(s) where its
 * contract is narrower. These assertions lock the two load-bearing re-declarations:
 * if a future edit drops `StateChangeItem`'s required `version` or
 * `ResourceChangeItem`'s `block_instance`-excluding `scope`, type checking fails
 * here rather than silently changing an observable item contract.
 */
import { expectTypeOf, it } from "vitest";
import type {
  InvalidationItem,
  ResourceChangeItem,
  StateChangeItem
} from "@flow-state-dev/core/items";

it("both leaves are assignable to the shared InvalidationItem base", () => {
  expectTypeOf<StateChangeItem>().toMatchTypeOf<InvalidationItem>();
  expectTypeOf<ResourceChangeItem>().toMatchTypeOf<InvalidationItem>();
});

it("StateChangeItem.version stays required (not number | undefined)", () => {
  expectTypeOf<StateChangeItem["version"]>().toEqualTypeOf<number>();
});

it("StateChangeItem.scope still includes block_instance", () => {
  expectTypeOf<StateChangeItem["scope"]>().toEqualTypeOf<
    "request" | "session" | "user" | "org" | "block_instance"
  >();
});

it("ResourceChangeItem.scope excludes block_instance", () => {
  expectTypeOf<ResourceChangeItem["scope"]>().toEqualTypeOf<
    "request" | "session" | "user" | "org"
  >();
  // @ts-expect-error — resource_change never carries block_instance scope.
  const _scope: ResourceChangeItem["scope"] = "block_instance";
  void _scope;
});
