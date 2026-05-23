/**
 * `defineMemoWriter` — per-phase factory for the three memo state-transition
 * blocks every phase repeats: `markWriting`, `markError`, and one or more
 * `commit*` handlers.
 *
 * Each phase calls `defineMemoWriter({ phaseId, agentTeam, keys, ... })`
 * once and gets back:
 *
 *   - `markWriting(shortName)` — pre-marks a memo `writing`, stamps
 *     `startedAt`, creates the resource scaffold on first touch.
 *   - `markError(shortName)` — flips a memo to `error`, records
 *     `errorMessage`, returns the rescue output (`{ status }` by default,
 *     `{ status, text }` if `errorTextPlaceholder` is configured).
 *   - `defineCommit({ shortName, inputSchema, project, afterCommit })` —
 *     publishes a memo with the projected patch + standard
 *     `status / completedAt / errorMessage` fields, then optionally runs
 *     `afterCommit` for phase-terminal session-state work (e.g. setting
 *     `runComplete` on Phase 5).
 *
 * All three blocks dual-write: they patch the memo resource AND mirror
 * the new status onto `session.memoStatus[shortName]` via
 * `setStateRecord` (atomic per-key, safe under parallel writers). The
 * navigator reads the session mirror live; the renderer reads memo
 * state. See `resources.ts` for the canonical `memoStateSchema`.
 */
import { handler, type SessionScopeHandle } from "@flow-state-dev/core";
import { z } from "zod";
import type { AgentName, AgentTeam } from "../agents";
import { memoResources, type MemoState } from "../resources";
import { sessionStateSchema, type SessionState } from "../state";

/**
 * Ctx shape exposed to commit `project` and `afterCommit` callbacks.
 *
 * `session` uses the framework's `SessionScopeHandle<SessionState>`, so
 * `ctx.session.state` is typed `Readonly<SessionState>` and
 * `ctx.session.patchState(...)` accepts `Partial<SessionState>`.
 *
 * `resources` is kept permissive because different commits read different
 * resource subsets — Phase 5 reads the trader memo to compute
 * `agreesWithTrader`, most commits read nothing extra. Per-phase commits
 * narrow at the call site if they need a specific resource shape.
 *
 * (We don't use the full `BlockContext` here because its `TResources`
 * generic constrains too tightly: the handler infers a narrow
 * `ResourceRegistry<{memos: ...}>` from `resources: memoResources`, which
 * isn't assignable to the wider `BlockContext` resources slot. The
 * `SessionScopeHandle` + permissive resources split is what every
 * commit projection actually uses.)
 */
type CommitCtx = {
  session: SessionScopeHandle<SessionState>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resources: any;
};

/** A row of the phase's memo-key registry (shape of every value in
 *  `PHASE_N_MEMO_KEYS`). */
type KeyEntry = { agentName: AgentName; collectionKey: string };

/** The patch a `defineCommit` projection returns. Status / completedAt /
 *  errorMessage are managed by the factory; everything else is the
 *  caller's responsibility. */
export type CommitPatch = Omit<
  Partial<MemoState>,
  "status" | "completedAt" | "errorMessage"
>;

/** Per-commit options. */
export interface CommitOptions<I> {
  /** Runs after the memo has been patched and `session.memoStatus` flipped.
   *  Used for any phase-terminal session-state work (Phase 5 sets
   *  `runComplete: true` here). */
  afterCommit?: (input: I, ctx: CommitCtx) => Promise<void> | void;
}

/** Memo-writer factory config. */
export interface MemoWriterConfig<Keys extends Record<string, KeyEntry>> {
  /** Phase id stamped onto new memo scaffolds (e.g. `"p1"`, `"p2"`). */
  phaseId: string;
  /** Agent team stamped onto new memo scaffolds. Drives the badge color
   *  group in the navigator sidebar. */
  agentTeam: AgentTeam;
  /** The phase's memo-key registry — resolves `collectionKey` and
   *  `agentName` from short-names. */
  keys: Keys;
  /** Fallback error message when the rescued payload has no readable
   *  error text (e.g. a thrown non-Error value). */
  errorMessageFallback: string;
  /** When set, the `markError` block returns `{ status, text }` instead of
   *  `{ status }`. The text comes from this template, called with the
   *  failing agent's name. Phase 4 personas use this so the rescue output
   *  has a typed non-empty shape. */
  errorTextPlaceholder?: (agentName: AgentName) => string;
}

/**
 * Build the three memo state-transition block factories for a phase.
 * Destructure the return into top-level exports so call sites read
 * `markWriting("bull")` without a per-call prefix.
 */
export function defineMemoWriter<Keys extends Record<string, KeyEntry>>(
  config: MemoWriterConfig<Keys>,
) {
  type ShortName = keyof Keys & string;
  const { phaseId, agentTeam, keys, errorMessageFallback, errorTextPlaceholder } = config;

  /** Pre-mark a memo as `writing` and stamp `startedAt`. Used as a `.tap`. */
  function markWriting(shortName: ShortName) {
    const { collectionKey, agentName } = keys[shortName];
    return handler({
      name: `mark-writing-${phaseId}-${shortName}`,
      inputSchema: z.unknown(),
      outputSchema: z.void(),
      sessionStateSchema,
      resources: memoResources,
      execute: async (_input, ctx) => {
        const ref = ctx.resources.memos.getOptional(collectionKey);
        const startedAt = new Date().toISOString();
        if (ref !== undefined) {
          await ref.patchState({ status: "writing", startedAt, agentName });
        } else {
          // Framework parses against memoStateSchema and applies
          // `.default(null)` to every nullable field — only the scaffold
          // needs to be supplied here.
          await ctx.resources.memos.create(collectionKey, {
            status: "writing",
            startedAt,
            agentName,
            agentTeam,
            phaseId,
            ticker: ctx.session.state.ticker,
            date: ctx.session.state.date,
          });
        }
        if (ctx.session.state.memoStatus[shortName] !== "writing") {
          await ctx.session.setStateRecord("memoStatus", shortName, "writing");
        }
      },
    });
  }

  /** Flip a memo to `error` with the rescued error's message. Returns
   *  `{ status, text }` — `text` is populated from `errorTextPlaceholder`
   *  when configured (Phase 4 uses this so the rescue output has a typed
   *  non-empty shape), otherwise an empty string. The unified output shape
   *  keeps the inferred type stable across phases. */
  function markError(shortName: ShortName) {
    const { collectionKey, agentName } = keys[shortName];
    return handler({
      name: `mark-error-${phaseId}-${shortName}`,
      inputSchema: z.object({ error: z.unknown() }).passthrough(),
      outputSchema: z.object({ status: z.literal("error"), text: z.string() }),
      sessionStateSchema,
      resources: memoResources,
      execute: async (input, ctx) => {
        const error = (input as { error?: unknown }).error;
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : errorMessageFallback;
        const ref = ctx.resources.memos.getOptional(collectionKey);
        if (ref !== undefined) {
          await ref.patchState({
            status: "error",
            errorMessage: message,
            completedAt: new Date().toISOString(),
          });
        }
        if (ctx.session.state.memoStatus[shortName] !== "error") {
          await ctx.session.setStateRecord("memoStatus", shortName, "error");
        }
        return {
          status: "error" as const,
          text: errorTextPlaceholder ? errorTextPlaceholder(agentName) : "",
        };
      },
    });
  }

  /** Build a commit handler that publishes a memo with the projected
   *  patch + standard fields, and optionally runs `afterCommit` for
   *  phase-terminal session-state work. The commit uses `.get()` (throws)
   *  rather than `.getOptional()`: by commit time setup + markWriting have
   *  run, and a missing ref is a real bug we want surfaced into the per-step
   *  rescue. */
  function defineCommit<S extends z.ZodTypeAny>(opts: {
    shortName: ShortName;
    inputSchema: S;
    project: (input: z.infer<S>, ctx: CommitCtx) => Promise<CommitPatch> | CommitPatch;
    afterCommit?: CommitOptions<z.infer<S>>["afterCommit"];
  }) {
    const { shortName, inputSchema, project, afterCommit } = opts;
    const { collectionKey } = keys[shortName];
    return handler({
      name: `commit-memo-${phaseId}-${shortName}`,
      inputSchema,
      outputSchema: z.void(),
      sessionStateSchema,
      resources: memoResources,
      execute: async (input, ctx) => {
        const ref = ctx.resources.memos.get(collectionKey);
        const patch = await project(input as z.infer<S>, ctx as CommitCtx);
        await ref.patchState({
          ...patch,
          status: "published",
          completedAt: new Date().toISOString(),
          errorMessage: null,
        });
        if (ctx.session.state.memoStatus[shortName] !== "published") {
          await ctx.session.setStateRecord("memoStatus", shortName, "published");
        }
        if (afterCommit) {
          await afterCommit(input as z.infer<S>, ctx as CommitCtx);
        }
      },
    });
  }

  return { markWriting, markError, defineCommit };
}
