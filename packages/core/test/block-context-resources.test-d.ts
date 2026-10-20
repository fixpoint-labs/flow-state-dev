/** A resource-declaring block's `ctx` is a `BlockContext`. `tsconfig.test-d.json` compiles this file. */
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

/** Same shape as `resolveSkillsCollection`: any block's ctx. */
declare function readsAnyCtx(ctx: BlockContext): void;

/** Spelled out, so the check does not go through the `ResourceRegistry` alias. */
declare function readsOpenRegistry(
  resources: Record<string, AnyResourceRef> & {
    get(name: string): AnyResourceRef;
    list(): AnyResourceRef[];
  },
): void;

handler({
  name: "no-resources",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input, ctx) => {
    readsAnyCtx(ctx);
    return input;
  },
});

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

    expectTypeOf(ctx.resources.notes).toEqualTypeOf<ResourceRef<any>>();
    expectTypeOf(ctx.resources.get("notes")).toEqualTypeOf<ResourceRef<any>>();
    // @ts-expect-error `get` accepts only a declared name.
    ctx.resources.get("missing");
    expectTypeOf(ctx.resources.missing).toBeNever();
    // @ts-expect-error reading through an undeclared name.
    void ctx.resources.missing.state;
    return input;
  },
});

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

declare const base: BlockContext;
expectTypeOf(base.resources.anything).toEqualTypeOf<AnyResourceRef>();
expectTypeOf(base.resources["any/key"]).toEqualTypeOf<AnyResourceRef>();
expectTypeOf(base.resources.get("anything")).toEqualTypeOf<AnyResourceRef>();
expectTypeOf(base.resources.list()).toEqualTypeOf<AnyResourceRef[]>();
