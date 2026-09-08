/**
 * Host-owned directory and provider-specific session persistence.
 *
 * `cwd` and `resume` are trusted host answers. They never read action input.
 * `onSession` writes confirmed ids back onto session state (and an
 * optional sidecar file so a later CLI process can resume).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CursorAgentOptions } from "@flow-state-dev/cursor";
import type { HarnessCallbackContext } from "@flow-state-dev/core/types";
import type { z } from "zod";
import type { sessionStateSchema } from "./schemas";

type Harness = NonNullable<HostResolverOptions["harness"]>;
type Sessions = Partial<Record<Harness, string>>;

export interface HostResolverOptions {
  /** Host-selected adapter. Omitted means Cursor for existing callers. */
  harness?: "codex" | "cursor";
  /** Directory the harness works in. Closed over — not taken from input. */
  cwd: string;
  /**
   * Optional JSON map of owner+checkout+session → { cursor?, codex? } ids.
   * Legacy bare session-id keys and string values belong only to Cursor.
   * Omit for session state only.
   */
  sessionFile?: string;
}

export interface SidecarEntryOwner {
  sessionId: string;
  userId: string;
  cwd: string;
  tenantId?: string;
}

/**
 * Stable sidecar map key for one trusted identity + checkout + FSD session.
 */
export function sidecarEntryKey(owner: SidecarEntryOwner): string {
  return JSON.stringify({
    tenantId: owner.tenantId ?? "",
    userId: owner.userId,
    cwd: owner.cwd,
    sessionId: owner.sessionId,
  });
}

function ownerFrom(ctx: HarnessCallbackContext, cwd: string): SidecarEntryOwner {
  const identity = ctx.session.identity;
  return {
    sessionId: identity.id,
    userId: typeof identity.userId === "string" ? identity.userId : "",
    cwd,
    ...(typeof identity.tenantId === "string" && identity.tenantId !== ""
      ? { tenantId: identity.tenantId }
      : {}),
  };
}

function readStateId(ctx: HarnessCallbackContext, harness: Harness): string | null {
  const state = ctx.session.state as Partial<z.infer<typeof sessionStateSchema>> | undefined;
  const id = state?.harnessSessions?.[harness] ?? (harness === "cursor" ? state?.cursorAgentId : null);
  return typeof id === "string" && id !== "" ? id : null;
}

function readSidecar(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

/** Upgrade legacy entries only when a provider confirms its session. */
function sessionsFrom(value: unknown): Sessions {
  if (typeof value === "string") return { cursor: value };
  if (value === null || typeof value !== "object") return {};
  const entry = value as Sessions;
  return {
    ...(typeof entry.cursor === "string" ? { cursor: entry.cursor } : {}),
    ...(typeof entry.codex === "string" ? { codex: entry.codex } : {}),
  };
}

function readSidecarSessions(
  raw: Record<string, unknown>,
  owner: SidecarEntryOwner,
): Sessions {
  const keyed = sessionsFrom(raw[sidecarEntryKey(owner)]);
  if (keyed.cursor !== undefined || keyed.codex !== undefined) return keyed;
  return sessionsFrom(raw[owner.sessionId]);
}

function writeSidecar(
  path: string,
  owner: SidecarEntryOwner,
  harness: Harness,
  agentId: string,
): void {
  const current = readSidecar(path);
  const key = sidecarEntryKey(owner);
  current[key] = { ...readSidecarSessions(current, owner), [harness]: agentId };
  if (key !== owner.sessionId) delete current[owner.sessionId];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
}

/**
 * Build the three shared adapter feeds from host configuration.
 *
 * The resolvers close over `cwd` / the sidecar path and read session identity
 * from `ctx`. They are never handed the prompt.
 */
export function createHostResolvers(
  options: HostResolverOptions,
): Pick<CursorAgentOptions, "cwd" | "resume" | "onSession"> {
  const harness = options.harness ?? "cursor";
  return {
    cwd: () => options.cwd,
    resume: (ctx) => {
      const fromState = readStateId(ctx, harness);
      if (fromState !== null) return fromState;
      if (options.sessionFile === undefined) return null;
      const owner = ownerFrom(ctx, options.cwd);
      return readSidecarSessions(readSidecar(options.sessionFile), owner)[harness] || null;
    },
    onSession: async (id, ctx) => {
      await ctx.session.atomicState((state: z.infer<typeof sessionStateSchema>) => ({
        ...state,
        harnessSessions: { ...state.harnessSessions, [harness]: id },
      }));
      if (options.sessionFile !== undefined) {
        writeSidecar(options.sessionFile, ownerFrom(ctx, options.cwd), harness, id);
      }
    },
  };
}
