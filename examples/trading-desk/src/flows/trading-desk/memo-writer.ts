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
} from "./blocks/thesis-schema";
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
      const memoStatus = {
        ...ctx.session.state.memoStatus,
        [shortName]: "writing" as const,
      };
      await ctx.session.patchState({ memoStatus });
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
      const ref = ctx.resources.memos.getOptional(collectionKey);
      const completedAt = new Date().toISOString();
      const patch = {
        status: "published" as const,
        label: thesis.label,
        headline: thesis.headline,
        rating: thesis.rating,
        body: thesis.body,
        metrics: thesis.metrics,
        completedAt,
        errorMessage: null,
      };
      if (ref !== undefined) {
        await ref.patchState(patch);
      }
      const memoStatus = {
        ...ctx.session.state.memoStatus,
        [shortName]: "published" as const,
      };
      await ctx.session.patchState({ memoStatus });
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
      const memoStatus = {
        ...ctx.session.state.memoStatus,
        [shortName]: "error" as const,
      };
      await ctx.session.patchState({ memoStatus });
      return { status: "error" as const };
    },
  });
}

