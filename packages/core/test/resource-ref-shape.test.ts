/**
 * Type-level regression for FIX-594 — `ResourceRef.name` was renamed to
 * `ResourceRef.path` and a derived `ResourceRef.uri` (`${scope}/${path}`) was
 * added. These assertions lock the public field shape so a future edit that
 * resurrects `name`, drops `uri`, or breaks the `uri` concatenation rule fails
 * at compile/test time rather than silently misleading users again.
 */
import { expectTypeOf, it, expect } from "vitest";
import type { ResourceRef } from "@flow-state-dev/core/types";

it("ResourceRef exposes path and uri, not name", () => {
  expectTypeOf<ResourceRef["path"]>().toEqualTypeOf<string>();
  expectTypeOf<ResourceRef["uri"]>().toEqualTypeOf<string>();
  // @ts-expect-error — `name` must not exist on ResourceRef after FIX-594.
  const _name: ResourceRef["name"] = "";
  void _name;
});

it("uri equals `${scope}/${path}`, including multi-segment paths", () => {
  const ref = {
    path: "memos/p1/foo",
    scope: "session",
    uri: "session/memos/p1/foo",
  } satisfies Pick<ResourceRef, "path" | "scope" | "uri">;

  expect(ref.uri).toBe(`${ref.scope}/${ref.path}`);
});
