/**
 * Host resolvers for the Cursor door.
 *
 * `cwd` and `resume` are trusted host answers. They never read action input.
 * `onSession` writes the Cursor agent id back onto session state (and an
 * optional sidecar file so a later CLI process can resume).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CursorAgentOptions } from "@flow-state-dev/cursor";
import type { HarnessCallbackContext } from "@flow-state-dev/core/types";

export interface HostResolverOptions {
  /** Directory the Cursor run writes in. Closed over — not taken from input. */
  cwd: string;
  /**
   * Optional JSON map of FSD session id → Cursor agent id, so `--session`
   * survives a process restart. Tests omit this and use session state only.
   */
  sessionFile?: string;
}

function readStateId(ctx: HarnessCallbackContext): string | null {
  const state = ctx.session.state as { cursorAgentId?: string | null } | undefined;
  const id = state?.cursorAgentId;
  return typeof id === "string" && id !== "" ? id : null;
}

function readSidecar(path: string, sessionId: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const id = raw[sessionId];
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

function writeSidecar(path: string, sessionId: string, agentId: string): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  current[sessionId] = agentId;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
}

/**
 * Build the three Cursor feeds from host configuration.
 *
 * The resolvers close over `cwd` / the sidecar path and read session identity
 * from `ctx`. They are never handed the prompt.
 */
export function createHostResolvers(
  options: HostResolverOptions,
): Pick<CursorAgentOptions, "cwd" | "resume" | "onSession"> {
  return {
    cwd: () => options.cwd,
    resume: (ctx) => {
      const fromState = readStateId(ctx);
      if (fromState !== null) return fromState;
      if (options.sessionFile === undefined) return null;
      return readSidecar(options.sessionFile, ctx.session.identity.id);
    },
    onSession: async (id, ctx) => {
      await ctx.session.patchState({ cursorAgentId: id });
      if (options.sessionFile !== undefined) {
        writeSidecar(options.sessionFile, ctx.session.identity.id, id);
      }
    },
  };
}
