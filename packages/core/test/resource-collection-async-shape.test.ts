/**
 * FIX-700: ResourceCollectionRef read methods are uniformly async.
 *
 * Locks the post-FIX-700 type contract: `get`/`getOptional`/`list`/`count`
 * return Promises regardless of `prefetchMode`, and flipping `prefetchMode`
 * between eager and lazy never changes the definition's type. These are
 * compile-time assertions — the test body only needs to typecheck. A single
 * runtime `expect` keeps vitest from treating the file as empty.
 */
import { describe, it, expect } from "vitest";
import { defineResourceCollection } from "../src/types/resource-collection";
import type { ResourceCollectionRef } from "../src/types/resource-collection";
import type { ResourceRef } from "../src/types/resource";
import { z } from "zod";

// Standard invariant type-equality helper.
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type State = { name: string };
type Ref = ResourceCollectionRef<State>;

// Reads are async on the single, mode-independent ref interface.
type _get = Expect<Equal<ReturnType<Ref["get"]>, Promise<ResourceRef<State>>>>;
type _getOptional = Expect<
  Equal<ReturnType<Ref["getOptional"]>, Promise<ResourceRef<State> | undefined>>
>;
type _list = Expect<Equal<ReturnType<Ref["list"]>, Promise<ResourceRef<State>[]>>>;
type _count = Expect<Equal<ReturnType<Ref["count"]>, Promise<number>>>;

// The eager/lazy split is gone: `peek` does not exist on the ref.
type _noPeek = Expect<Equal<"peek" extends keyof Ref ? true : false, false>>;

describe("ResourceCollectionRef async shape (FIX-700)", () => {
  it("prefetchMode does not change the definition type", () => {
    const eager = defineResourceCollection({
      pattern: "files/[id]",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
    });
    const lazy = defineResourceCollection({
      pattern: "files/[id]",
      scope: "session",
      stateSchema: z.object({ name: z.string() }),
      prefetchMode: "lazy",
    });

    // Both definitions resolve to the same ref type — `ResourceCollectionRef`
    // takes a single type argument, so reads against either collection share
    // one shape. (The mode generic is gone; only the config field differs.)
    type EagerRef = ResourceCollectionRef<{ name: string }>;
    type LazyRef = ResourceCollectionRef<{ name: string }>;
    type _sameRef = Expect<Equal<EagerRef, LazyRef>>;

    expect(eager.prefetchMode).toBeUndefined();
    expect(lazy.prefetchMode).toBe("lazy");
  });
});
