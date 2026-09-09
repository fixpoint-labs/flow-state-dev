/**
 * Host-owned directory and adapter session persistence.
 *
 * `cwd` and `resume` are trusted host answers. They never read action input.
 * `onSession` writes confirmed ids onto session state so a later `fsdev run
 * --session` on filesystemStores can resume.
 */
import type { CursorAgentOptions } from "@flow-state-dev/cursor";
import type { HarnessCallbackContext } from "@flow-state-dev/core/types";
import type { z } from "zod";
import type { sessionStateSchema } from "./schemas";

export type HostHarness = "codex" | "cursor";

export interface HostResolverOptions {
  /** Host-selected adapter. Omitted means Cursor. */
  harness?: HostHarness;
  /** Directory the harness works in. Closed over — not taken from input. */
  cwd: string;
}

function readStateId(ctx: HarnessCallbackContext, harness: HostHarness): string | null {
  const state = ctx.session.state as Partial<z.infer<typeof sessionStateSchema>> | undefined;
  const id = state?.harnessSessions?.[harness];
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Build the three shared adapter feeds from host configuration.
 *
 * The resolvers close over `cwd` and read session identity from `ctx`.
 * They are never handed the prompt.
 */
export function createHostResolvers(
  options: HostResolverOptions,
): Pick<CursorAgentOptions, "cwd" | "resume" | "onSession"> {
  const harness = options.harness ?? "cursor";
  return {
    cwd: () => options.cwd,
    resume: (ctx) => readStateId(ctx, harness),
    onSession: async (id, ctx) => {
      await ctx.session.atomicState((state: z.infer<typeof sessionStateSchema>) => ({
        ...state,
        harnessSessions: { ...state.harnessSessions, [harness]: id },
      }));
    },
  };
}
