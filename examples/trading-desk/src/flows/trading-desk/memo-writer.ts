/**
 * Memo state-transition taps — `markWriting`, `commitMemo`, `markError`.
 *
 * Each tap performs a dual write:
 *   - Patches the memo resource state (status, body, metrics, timestamps).
 *     Body content is read terminally via `useResourceCollection`.
 *   - Patches `session.memoStatus[shortName]` so the navigator reads the
 *     status live mid-stream via `useClientData` (`expose` keys).
 *
 * The dual write is intentional: resource snapshots batch to terminal status,
 * but the session state-change items propagate immediately so the sidebar
 * can flicker `pending → writing → published` during a run.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  PHASE_1_MEMO_KEYS,
  type Phase1MemoShortName,
} from "./agents";
import {
  thesisOutputSchema,
  type ThesisOutput,
} from "./phase-1/thesis-schema";
import { memoResources } from "./resources";
import { sessionStateSchema } from "./state";

/**
 * Pre-mark a memo as `writing` and stamp `startedAt`. Used as a `.tap` —
 * mutates resource + session state and returns void per BP-014.
 */
export function markWriting(shortName: Phase1MemoShortName) {
  const { collectionKey, agentName } = PHASE_1_MEMO_KEYS[shortName];
  return handler({
    name: `mark-writing-${shortName}`,
    inputSchema: z.unknown(),
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (_input, ctx) => {
      const ref = ctx.resources.memos.getOptional(collectionKey);
      const startedAt = new Date().toISOString();
      const patch = {
        status: "writing" as const,
        startedAt,
        agentName,
      };
      if (ref !== undefined) {
        await ref.patchState(patch);
      } else {
        await ctx.resources.memos.create(collectionKey, {
          ...patch,
          agentTeam: "analyst",
          phaseId: "p1",
          ticker: ctx.session.state.ticker,
          date: ctx.session.state.date,
          label: null,
          headline: null,
          rating: null,
          body: null,
          metrics: null,
          completedAt: null,
          errorMessage: null,
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      // `setStateRecord` is atomic on the per-key write — required because the
      // four analysts run in parallel and a `{...prev, [name]: ...}` pattern
      // would race on shared `memoStatus`. `patchState` is still safe for
      // setup-time bulk seeding (single writer).
      if (memoStatus[shortName] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", shortName, "writing");
      }
    },
  });
}

/**
 * Commit a generator's structured `Thesis` output to the memo resource and
 * flip status to `published`. Used as a `.tap` after the analyst generator
 * — the generator's thesis output passes through to the parallel
 * aggregator unchanged.
 */
export function commitMemo(shortName: Phase1MemoShortName) {
  const { collectionKey } = PHASE_1_MEMO_KEYS[shortName];
  return handler({
    name: `commit-memo-${shortName}`,
    inputSchema: thesisOutputSchema,
    outputSchema: z.void(),
    sessionStateSchema,
    resources: memoResources,
    execute: async (thesis: ThesisOutput, ctx) => {
      // Use `get()` (throws) rather than `getOptional()` — by the time
      // commitMemo runs, `setupPhase1Memos` has pre-created the memo and
      // `markWriting` has flipped it to `writing`. If the ref isn't here,
      // that's a real upstream bug worth surfacing (was a silent no-op).
      const ref = ctx.resources.memos.get(collectionKey);
      const completedAt = new Date().toISOString();
      await ref.patchState({
        status: "published" as const,
        label: thesis.label,
        headline: thesis.headline,
        rating: thesis.rating,
        body: thesis.body,
        // Flatten the array-of-pairs back into the stored `Record<string,string>`
        // shape. See thesis-schema.ts for why the wire format is an array.
        metrics: Object.fromEntries(thesis.metrics.map((m) => [m.key, m.value])),
        completedAt,
        errorMessage: null,
      });
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "published") {
        await ctx.session.setStateRecord("memoStatus", shortName, "published");
      }
    },
  });
}

/**
 * Mark a memo as `error` with the rescued error's message. Drives the
 * navigator's red dot and the document-area error treatment.
 */
export function markError(shortName: Phase1MemoShortName) {
  const { collectionKey } = PHASE_1_MEMO_KEYS[shortName];
  return handler({
    name: `mark-error-${shortName}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: z.object({ status: z.literal("error") }),
    sessionStateSchema,
    resources: memoResources,
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Analyst run failed.";
      const ref = ctx.resources.memos.getOptional(collectionKey);
      if (ref !== undefined) {
        await ref.patchState({
          status: "error",
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
      }
      const memoStatus = ctx.session.state.memoStatus;
      if (memoStatus[shortName] !== "error") {
        await ctx.session.setStateRecord("memoStatus", shortName, "error");
      }
      return { status: "error" as const };
    },
  });
}

