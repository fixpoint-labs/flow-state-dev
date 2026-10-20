/**
 * Compile-time assertions that a block which declares `resources` hands its
 * `execute` a ctx that is still a `BlockContext`.
 *
 * Shared helpers take `(ctx: BlockContext)` and read a resource by name. A
 * handler that declares a `resources` map must be able to pass its own ctx to
 * one, exactly as a handler that declares nothing can; otherwise the only way
 * to call the helper is a cast or a `@ts-expect-error`. The fix must not cost
 * precision either: inside the block each declared ref keeps the type its
 * declaration gave it, `get` accepts only a declared name, and the open
 * registry a plain `BlockContext` sees still reads any name.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file in this package's
 * `test` directory, so a regression here fails `pnpm typecheck`.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core";
import type { AnyResourceRef, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";

const notes = defineResource({ scope: "session", stateSchema: z.object({ count: z.number() }) });
const skills = defineResourceCollection({
  pattern: "skills/*",
  scope: "session",
  stateSchema: z.object({ name: z.string() }),
});

/** A helper of the shape orchestration exports: it takes any block's ctx. */
declare function readsAnyCtx(ctx: BlockContext): void;

/**
 * A helper typed against the registry's spelled-out shape rather than the
 * `ResourceRegistry` alias, so the check is structural all the way down.
 */
declare function readsOpenRegistry(
  resources: Record<string, AnyResourceRef> & {
    get(name: string): AnyResourceRef;
    list(): AnyResourceRef[];
  },
): void;

/** Control: a block that declares no resources has always passed. */
handler({
  name: "no-resources",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input, ctx) => {
    readsAnyCtx(ctx);
    return input;
  },
});

/** A plain `defineResource` declaration. */
handler({
  name: "declares-resource",
  inputSchema: z.string(),
  outputSchema: z.string(),
  resources: { notes },
  execute: (input, ctx) => {
    readsAnyCtx(ctx);
    const asBase: BlockContext = ctx;
    void asBase;
    readsOpenRegistry(ctx.resources);

    // The declared ref keeps its own type, by property and through `get`;
    // it is not widened to the `AnyResourceRef` union.
    expectTypeOf(ctx.resources.notes).toEqualTypeOf<ResourceRef<any>>();
    expectTypeOf(ctx.resources.get("notes")).toEqualTypeOf<ResourceRef<any>>();
    // @ts-expect-error `get` accepts only a declared name.
    ctx.resources.get("missing");
    // @ts-expect-error an undeclared name is a missing property.
    void ctx.resources.missing;
    // A key typed only as `string` doesn't index it either: the declared refs
    // are reachable by literal name or `get`, not by an arbitrary string.
    const k: string = "notes";
    // @ts-expect-error no string index on a declared registry.
    void ctx.resources[k];
    return input;
  },
});

/**
 * An undeclared name is `undefined` at runtime, so handing it on must not
 * compile: not as an argument, not in an assignment, not as a return value.
 * Each is a place a typo would otherwise slip through to a runtime crash.
 */
declare function consumeRef(ref: ResourceRef<any>): void;
declare function consumeAnyRef(ref: AnyResourceRef): void;
handler({
  name: "uses-undeclared",
  inputSchema: z.string(),
  outputSchema: z.string(),
  resources: { notes },
  execute: (input, ctx) => {
    consumeRef(ctx.resources.notes);
    // @ts-expect-error passing an undeclared name as an argument.
    consumeRef(ctx.resources.missing);
    // @ts-expect-error passing an undeclared name where any ref is accepted.
    consumeAnyRef(ctx.resources.missing);
    // @ts-expect-error assigning an undeclared name to a ref.
    const assigned: ResourceRef<any> = ctx.resources.missing;
    void assigned;
    const returnsRef = (): ResourceRef<any> =>
      // @ts-expect-error returning an undeclared name as a ref.
      ctx.resources.missing;
    void returnsRef;
    return input;
  },
});

/** A collection declaration — the shape `resolveSkillsCollection` reads. */
handler({
  name: "declares-collection",
  inputSchema: z.string(),
  outputSchema: z.string(),
  resources: { notes, skills },
  execute: (input, ctx) => {
    readsAnyCtx(ctx);
    readsOpenRegistry(ctx.resources);
    expectTypeOf(ctx.resources.skills).toEqualTypeOf<ResourceCollectionRef<any>>();
    expectTypeOf(ctx.resources.list()).toEqualTypeOf<
      Array<ResourceRef<any> | ResourceCollectionRef<any>>
    >();
    return input;
  },
});

/** An empty `resources` map is a declaration too, and passes the same way. */
handler({
  name: "declares-empty",
  inputSchema: z.string(),
  outputSchema: z.string(),
  resources: {},
  execute: (input, ctx) => {
    readsAnyCtx(ctx);
    readsOpenRegistry(ctx.resources);
    expectTypeOf(ctx.resources.list()).toEqualTypeOf<never[]>();
    return input;
  },
});

/** The open registry a plain `BlockContext` sees reads any name, as before. */
declare const base: BlockContext;
expectTypeOf(base.resources.anything).toEqualTypeOf<AnyResourceRef>();
expectTypeOf(base.resources["any/key"]).toEqualTypeOf<AnyResourceRef>();
expectTypeOf(base.resources.get("anything")).toEqualTypeOf<AnyResourceRef>();
expectTypeOf(base.resources.list()).toEqualTypeOf<AnyResourceRef[]>();
