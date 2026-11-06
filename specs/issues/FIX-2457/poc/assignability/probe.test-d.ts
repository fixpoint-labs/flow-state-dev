/**
 * Throwaway probe, retained as spec evidence. Copy into packages/core/test/
 * and run `npx tsc -p tsconfig.test-d.json` from packages/core. Each case
 * hands a block's own ctx to a helper typed `(ctx: BlockContext) => void`,
 * the shape of orchestration's `payBoardDebts`.
 */
import { z } from "zod";
import { handler, defineCapability, defineResource } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core";

declare function readsAnyCtx(ctx: BlockContext): void;
const S = z.object({ count: z.number().default(0) });
const io = { inputSchema: z.string(), outputSchema: z.string() };

// Scope state schemas: the issue's suspected cause.
handler({ name: "p1", ...io, requestStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "p2", ...io, sessionStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "p3", ...io, userStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "p4", ...io, stateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "p7", ...io, parentStateSchema: S, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });

// The capability path.
const capPlain = defineCapability({ name: "plain" });
const capState = defineCapability({ name: "st", sessionStateSchema: S });
handler({ name: "u1", ...io, uses: [capPlain], execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
handler({ name: "u4", ...io, uses: [capState, capPlain], sessionStateSchema: S, requestStateSchema: S,
  resources: { n: defineResource({ scope: "session", stateSchema: S }) },
  execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
defineCapability({ name: "pre", sessionStateSchema: S,
  presets: { p: { tools: (ctx) => { readsAnyCtx(ctx); return []; } } } });

// Declared targets.
handler({ name: "t1", ...io, targetStateSchemas: { other: S }, execute: (i, ctx) => { readsAnyCtx(ctx); return i; } });
