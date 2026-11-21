/**
 * The history summary's session resource: its state schema and its
 * definition, apart from the capability and fold that write it
 * (`history-summary.ts`), so a browser screen can import the definition it
 * reads without the blocks. A leaf: it imports zod and the resource builder
 * only. `historySummaryResource` is exported from `@flow-state-dev/core/types`
 * alone, a browser-safe path; workforce's browser entry re-exports it for the
 * screens on workforce.
 */
import { z } from "zod";
import { defineResource } from "../types/resource";

/** The session resource a history summary keeps. */
export const historySummaryStateSchema = z.object({
  /** The running summary. */
  summary: z.string().nullable().default(null),
  /** The high-water mark: the newest turn folded, or moved past and kept pending. */
  throughRequestId: z.string().nullable().default(null),
  throughStartedAtMs: z.number().nullable().default(null),
  /** The oldest turn after the mark at the last fold. Gone unfolded later means turns were lost. */
  nextRequestId: z.string().nullable().default(null),
  /**
   * The oldest settled turn after the mark at the last fold. Tracked apart
   * from `nextRequestId`, which an older waiting turn can hold for as long as
   * it waits while settled turns behind it leave the window.
   */
  nextSettledRequestId: z.string().nullable().default(null),
  /** Turns behind the mark that had not settled, by request id; folded once they do. */
  pending: z.array(z.string()).default([]),
  /** A turn left the window unsummarized. Stays set: the summary has a hole. */
  gap: z.boolean().default(false),
  /** Every turn before the mark is in the summary: no gap and nothing pending. */
  complete: z.boolean().default(true),
  /** Folds written. */
  folds: z.number().int().default(0),
  /** Folds tried, written or failed. A turn out of view with none tried: the fold step is missing. */
  attempts: z.number().int().default(0),
});

export type HistorySummaryState = z.infer<typeof historySummaryStateSchema>;

/** A summary's state before its first fold. */
export const HISTORY_SUMMARY_DEFAULT: HistorySummaryState = historySummaryStateSchema.parse({});

/** The name a history summary keeps its resource under unless told another. */
export const HISTORY_SUMMARY_NAME = "historySummary";

/**
 * The summary's session resource under `name`: one per conversation, however
 * many generators install the capability. Public, so a screen can label its
 * divider "earlier turns summarized".
 */
export const historySummaryResourceNamed = (name: string) =>
  defineResource({
    ref: name,
    scope: "session",
    stateSchema: historySummaryStateSchema,
    default: HISTORY_SUMMARY_DEFAULT,
    writable: true,
    client: { expose: ["throughRequestId", "complete", "folds"] },
  });

/**
 * The history summary's session resource at its default name: the definition
 * every `historySummary(...)` without a `name` installs, so a screen reads the
 * same one (`useResource(historySummaryResource, { sessionId })`). Its public
 * face is the mark (`throughRequestId`), whether the summary is whole
 * (`complete`) and how many folds it took; never the summary's words.
 */
export const historySummaryResource = historySummaryResourceNamed(HISTORY_SUMMARY_NAME);
