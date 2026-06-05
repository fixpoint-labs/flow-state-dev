/**
 * Primitives for writing to the memos collection. Three pieces:
 *
 *   1. `defineMemoStep(body, { key, commit })` + the key-driven
 *      `markWriting(key)` / `markError(key)` pair — the ONE apparatus for
 *      placing a participant. `defineMemoStep` wraps a portable body in the
 *      standard memo lifecycle (pre-mark `writing` → body → commit →
 *      rescue to `error`); `markWriting` / `markError` are the two
 *      state-transition blocks it taps, resolving memo identity
 *      (`collectionKey` / `agentName` / `agentTeam` / `phaseId` /
 *      `errorMessageFallback` / `errorPlaceholder`) from `ALL_MEMO_KEYS[key]`
 *      — the single source of truth. The two recipes (`defineAnalyst`, the
 *      lens fan-out) are thin wrappers over `defineMemoStep`.
 *
 *   2. `publishMemo(ctx, shortName, collectionKey, patch)`
 *      — helper that performs the published-memo dual write (resource
 *      `patchState` + session `memoStatus` mirror) with the standard
 *      `status / completedAt / errorMessage` fields filled in. Called from
 *      a plain `handler({...})` execute body — each commit handler is just
 *      the projection-of-LLM-output into the patch shape.
 *
 *   3. `memoHandler` — a `handler.withDefaults(...)` instance with
 *      `sessionStateSchema`, `resources: memoResources`, and
 *      `outputSchema: z.void()` pre-applied. Commit handlers use this to
 *      skip restating the same scaffolding three lines per file.
 *
 * Note: there is no `defineCommit` factory. Commit handlers vary by
 * projection (each phase maps LLM output to memo fields differently), so a
 * factory taking the body as a callback would just be a helper in disguise
 * — with extra generic plumbing to thread the input schema and ctx type
 * back to the call site. Plain handlers + `publishMemo` is the cleaner
 * shape. See `docs/contributing/best-practices.md` (BP-024).
 */
import {
  handler,
  sequencer,
  type BlockDefinition,
  type LooseBlockContext,
} from "@flow-state-dev/core";
import { z } from "zod";
import {
  ALL_MEMO_KEYS,
  type AnyMemoShortName,
  type MemoKeyEntry,
} from "../../registry";
import { memoResources, type MemoState } from "../../resources";
import { sessionStateSchema, type SessionState } from "../../state";

// ---------------------------------------------------------------------------
// 1. `defineMemoStep` + key-driven `markWriting` / `markError`
// ---------------------------------------------------------------------------
//
// The unified apparatus for placing a participant: one key-driven
// `markWriting` / `markError` pair, and a `defineMemoStep` factory that wraps
// a portable participant body in the standard memo lifecycle. Memo identity
// (`collectionKey` / `agentName` / `agentTeam` / `phaseId` /
// `errorMessageFallback` / `errorPlaceholder`) is resolved from
// `ALL_MEMO_KEYS[key]` — the single source of truth.

/**
 * Pre-mark a memo as `writing` and stamp `startedAt`, resolving identity from
 * `ALL_MEMO_KEYS[key]`. Used as a `.tap`. `collection.upsert` patches the small
 * delta on exists (the common path, after setup) and supplies the phase
 * scaffold (`agentTeam` / `phaseId` / ticker / date) on the defensive
 * create-on-missing branch.
 */
export function markWriting(key: AnyMemoShortName): BlockDefinition {
  const { collectionKey, agentName, agentTeam, phaseId }: MemoKeyEntry =
    ALL_MEMO_KEYS[key];
  return memoHandler({
    name: `mark-writing-${key}`,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const startedAt = new Date().toISOString();
      await ctx.resources.memos.upsert(
        collectionKey,
        { status: "writing", startedAt, agentName },
        {
          agentTeam,
          phaseId,
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
        },
      );
      if (ctx.session.state.memoStatus[key] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", key, "writing");
      }
    },
  });
}

/**
 * Flip a memo to `error` with the rescued error's message, resolving identity
 * from `ALL_MEMO_KEYS[key]`. Always returns `{ status, text }` — `text` is
 * populated from the entry's `errorPlaceholder` when configured (Phase 4
 * personas), empty string otherwise.
 */
export function markError(key: AnyMemoShortName): BlockDefinition {
  const {
    collectionKey,
    agentName,
    errorMessageFallback,
    errorPlaceholder,
  }: MemoKeyEntry = ALL_MEMO_KEYS[key];
  return memoHandler({
    name: `mark-error-${key}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: z.object({ status: z.literal("error"), text: z.string() }),
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : errorMessageFallback;
      const ref = await ctx.resources.memos.getOptional(collectionKey);
      if (ref !== undefined) {
        await ref.patchState({
          status: "error",
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
      }
      if (ctx.session.state.memoStatus[key] !== "error") {
        await ctx.session.setStateRecord("memoStatus", key, "error");
      }
      return {
        status: "error" as const,
        text: errorPlaceholder ? errorPlaceholder(agentName) : "",
      };
    },
  });
}

/** Keys placed via `defineMemoStep` — the coverage-guard backstop. A
 *  participant registered but never placed (or placed under a stale key)
 *  fails the coverage guard test loudly. */
const placedKeys = new Set<AnyMemoShortName>();

/** The set of memo keys placed via `defineMemoStep`. Read by the coverage
 *  guard, which asserts it equals the registered keys in `ALL_MEMO_KEYS`. */
export function placedMemoKeys(): ReadonlySet<AnyMemoShortName> {
  return placedKeys;
}

/**
 * Wrap a portable participant `body` in the standard memo lifecycle: pre-mark
 * `writing`, run the body, commit, and rescue to `error`. The ONE apparatus
 * for placing a participant — the two recipes (`defineAnalyst`, lens) become
 * thin wrappers over it.
 *
 * - `body` — the participant's pre-commit work (a bare generator or a composed
 *   sub-sequencer); no memo writes.
 * - `key` — a typed memo short-name (`AnyMemoShortName`); drives
 *   `markWriting` / `markError` and the memo identity.
 * - `commit` — the per-participant commit handler (stays in
 *   `agents/<group>/writer.ts`).
 *
 * Records the placement in `placedMemoKeys()` for the coverage guard. Produces
 * `sequencer().tap(markWriting(key)).step(body).tap(commit).rescue([{ block:
 * markError(key) }])` — identical to the inline per-step assembly it replaces.
 */
export function defineMemoStep(
  body: BlockDefinition,
  opts: { key: AnyMemoShortName; commit: BlockDefinition },
): BlockDefinition {
  placedKeys.add(opts.key);
  return sequencer({ name: `memo-step-${opts.key}` })
    .tap(markWriting(opts.key))
    .step(body)
    .tap(opts.commit)
    .rescue([{ block: markError(opts.key) }]);
}

// ---------------------------------------------------------------------------
// 2. `publishMemo` helper + `CommitPatch` type
// ---------------------------------------------------------------------------

/** The patch a commit handler hands to `publishMemo`. Status / completedAt /
 *  errorMessage are managed by the helper; everything else is the caller's
 *  responsibility. */
export type CommitPatch = Omit<
  Partial<MemoState>,
  "status" | "completedAt" | "errorMessage"
>;

/**
 * Perform the published-memo dual write: patch the memo resource (with the
 * standard `status: "published" / completedAt / errorMessage: null` fields
 * merged onto the caller's `patch`), then mirror the new status onto
 * `session.memoStatus[shortName]` via `setStateRecord` (atomic per-key,
 * safe under parallel writers).
 *
 * Uses `.get()` (throws) rather than `.getOptional()`: by commit time
 * setup + markWriting have created/patched the resource, and a missing
 * ref is a real bug we want surfaced into the per-step rescue.
 *
 * `ctx` is typed as `LooseBlockContext<SessionState>` — typed on session
 * state (so `setStateRecord("memoStatus", ...)` is type-checked) and
 * permissive on resources (so any caller's narrower inferred ctx assigns
 * in). The framework's full `BlockContext` doesn't work here because its
 * `TResources` generic is invariant on `ResourceRegistry`.
 */
export async function publishMemo(
  ctx: LooseBlockContext<SessionState>,
  shortName: string,
  collectionKey: string,
  patch: CommitPatch,
): Promise<void> {
  const ref = await ctx.resources.memos.get(collectionKey);
  await ref.patchState({
    ...patch,
    status: "published" as const,
    completedAt: new Date().toISOString(),
    errorMessage: null,
  });
  if (ctx.session.state.memoStatus[shortName] !== "published") {
    await ctx.session.setStateRecord("memoStatus", shortName, "published");
  }
}

// ---------------------------------------------------------------------------
// 3. `memoHandler` — `handler.withDefaults(...)` for the shared scaffolding
// ---------------------------------------------------------------------------

/**
 * `handler()` pre-configured with the three fields every memo-touching
 * handler in this flow shares: `sessionStateSchema`, `resources:
 * memoResources`, and `outputSchema: z.void()`. Used by commit handlers,
 * by the key-driven `markWriting` / `markError`, and by `defineMemoSetup`.
 *
 * Per-call overrides are supported — `markError` passes a non-void
 * `outputSchema: z.object({ status, text })` here, and the override wins.
 */
export const memoHandler = handler.withDefaults({
  sessionStateSchema,
  resources: memoResources,
  outputSchema: z.void(),
});
