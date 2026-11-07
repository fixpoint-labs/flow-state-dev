/**
 * Compile-time assertions that every way a block's `ctx` is typed still passes
 * where a plain `BlockContext` is expected.
 *
 * Exported helpers take `(ctx: BlockContext)`: `resolveResourceCollection`,
 * `cancelAndResume`, `waitOnTask`. A block author hands them the block's own
 * `ctx`, however the block was declared, with no cast. Each case below hands a
 * ctx to such a helper; a case that stops compiling is a cast an author would
 * have to write. The precision checks keep the fix honest: a slot is not
 * widened to `any` so that everything fits.
 *
 * `tsconfig.test-d.json` compiles every `.test-d.ts` file in this package's
 * `test` directory, so a regression here fails `pnpm typecheck`.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";
import { defineCapability, defineResource, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core";
import type { StateRef } from "@flow-state-dev/core/types";

/** The shape of an exported helper: it takes any block's ctx. */
declare function readsAnyCtx(ctx: BlockContext): void;

const S = z.object({ count: z.number().default(0) });
const io = { inputSchema: z.string(), outputSchema: z.string() };

// ---------------------------------------------------------------------------
// Scope and own state schemas
// ---------------------------------------------------------------------------

handler({ name: "request-state", ...io, requestStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "session-state", ...io, sessionStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "user-state", ...io, userStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "own-state", ...io, stateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "parent-state", ...io, parentStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });

// ---------------------------------------------------------------------------
// Capabilities in `uses`
// ---------------------------------------------------------------------------

const capPlain = defineCapability({ name: "plain" });
const capState = defineCapability({ name: "st", sessionStateSchema: S });

handler({
  name: "uses-plain-capability",
  ...io,
  uses: [capPlain],
  execute: (i, ctx) => {
    readsAnyCtx(ctx);
    // A capability that declares no targets contributes none: the block's
    // `ctx.targets` stays closed, so a typo is an error rather than a handle.
    expectTypeOf(ctx.targets).toEqualTypeOf<Record<string, never>>();
    // @ts-expect-error no target is declared under this name.
    void ctx.targets.typo?.state;
    return i;
  },
});

handler({
  name: "uses-capabilities-and-declares",
  ...io,
  uses: [capState, capPlain],
  sessionStateSchema: S,
  requestStateSchema: S,
  resources: { n: defineResource({ scope: "session", stateSchema: S }) },
  execute: (i, ctx) => {
    readsAnyCtx(ctx);
    expectTypeOf(ctx.session.state.count).toEqualTypeOf<number>();
    return i;
  },
});

// ---------------------------------------------------------------------------
// Capability preset callbacks
// ---------------------------------------------------------------------------

/**
 * A preset callback runs with the block's full context, so its `ctx` is a
 * `BlockContext` whose session state is the capability's own. A helper typed
 * `BlockContext` takes it; a key `BlockContext` lacks is an error, not `any`.
 */
defineCapability({
  name: "preset-ctx",
  sessionStateSchema: S,
  presets: {
    p: {
      tools: (ctx) => {
        readsAnyCtx(ctx);
        expectTypeOf(ctx.session.state.count).toEqualTypeOf<number>();
        expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignal>();
        // @ts-expect-error not a member of `BlockContext`.
        void ctx.notAMember;
        return [];
      },
      context: (_input, ctx) => {
        readsAnyCtx(ctx);
        expectTypeOf(ctx.session.state.count).toEqualTypeOf<number>();
        return "";
      },
    },
  },
});

/**
 * A capability with no `sessionStateSchema` leaves the shape to the block that
 * uses it, so its preset callback reads session state as `any`, and the rest of
 * its ctx stays a typed `BlockContext`.
 */
defineCapability({
  name: "preset-ctx-no-schema",
  presets: {
    p: {
      tools: (ctx) => {
        readsAnyCtx(ctx);
        expectTypeOf(ctx.session.state.anyField).toBeAny();
        expectTypeOf(ctx.signal).toEqualTypeOf<AbortSignal>();
        // @ts-expect-error not a member of `BlockContext`.
        void ctx.notAMember;
        return [];
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Declared targets
// ---------------------------------------------------------------------------

/**
 * A block that declares `targetStateSchemas` passes as `BlockContext` too, and
 * its own `ctx.targets` keeps exactly what it declared.
 */
handler({
  name: "declares-targets",
  ...io,
  targetStateSchemas: { other: S },
  execute: (i, ctx) => {
    readsAnyCtx(ctx);
    expectTypeOf(ctx.targets.other).toEqualTypeOf<StateRef<{ count: number }> | undefined>();
    // @ts-expect-error no target is declared under this name.
    void ctx.targets.typo?.state;
    return i;
  },
});

/** A block that declares no targets reads a closed `ctx.targets`. */
handler({
  name: "no-targets",
  ...io,
  execute: (i, ctx) => {
    expectTypeOf(ctx.targets).toEqualTypeOf<Record<string, never>>();
    // @ts-expect-error no target is declared under this name.
    void ctx.targets.typo?.state;
    return i;
  },
});
