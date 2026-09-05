// (a) LAB-152 — the neutral harness contract, as spec/LAB-152.md §7 specifies it.
// Would live in @flow-state-dev/core. Sketch: shapes only, no doc polish.
import { z } from "zod";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";

/** What a manager hands a harness per run: the prompt. Nothing else (decision 2). */
export const harnessRunInputSchema = z.object({ prompt: z.string() });

/** What a harness hands back — every field any harness can honestly fill. */
export const harnessRunHandleSchema = z.object({
  source: z.string(), // "<package>/<door>", widened from Claude's enum
  status: z.enum(["dispatched", "running", "completed", "errored"]),
  sessionId: z.string().nullable(),
  url: z.string().nullable(),
  dispatchedAt: z.number(),
  outcome: z.enum(["finished", "stopped-at-limit", "failed"]).nullable(),
  finalMessage: z.string().nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  cost: z.object({ usd: z.number(), basis: z.enum(["reported", "estimated"]) }).nullable(),
});
export type HarnessRunInput = z.infer<typeof harnessRunInputSchema>;
export type HarnessRunHandle = z.infer<typeof harnessRunHandleSchema>;

/**
 * Conformance alias — LAB-152 §7 says "a block whose input and output are the neutral
 * schemas". Two candidate spellings; `run.ts` type-asserts which one an EXTENDED handle
 * (Claude's, with `resultSubtype` etc.) actually fits. `TaskWorker` in orchestration is
 * the precedent for the second spelling.
 */
export type HarnessBlockBySchema = BlockDefinition<typeof harnessRunInputSchema, typeof harnessRunHandleSchema>;
export type HarnessBlock = BlockDefinition<any, any, HarnessRunInput, HarnessRunHandle>;

/**
 * NOT in LAB-152's contract. The per-run resolver + hook signatures every harness must
 * accept for a manager to feed it. LAB-153 §7 and LAB-154 §7 each declare this shape in
 * their own package; nothing shared says they agree. Declared here once so the two
 * harness sketches can import it — which is the shape the POC argues for.
 */
export type HarnessResolver<T> = (input: HarnessRunInput, ctx: BlockContext) => T | Promise<T>;
export type HarnessSessionHook = (sessionId: string, ctx: BlockContext) => void | Promise<void>;
