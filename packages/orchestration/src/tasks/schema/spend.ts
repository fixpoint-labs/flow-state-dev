/**
 * `Task.spend` (FIX-2288): what a task's runs spent, as the row stores it.
 *
 * One entry per request admitted for the task: its settled part (what its
 * endings handed on, summed) and its live part (what it has spent since its
 * last ending, while it runs), each as tokens per source, the one conversion
 * a worker's usage counts by too (core's `requestSpendSources`). Each entry
 * also keeps the harness and model its request last reported. The fold a
 * reader shows is `taskSpendView` (`../spend.ts`).
 *
 * Every field defaults, so a partial or older row parses (BP-023, BP-030).
 */
import { z } from "zod";

/** One source of a request's spend: a model, or a harness billed one way. */
const taskSpendSourceSchema = z.object({
  source: z.string(),
  kind: z.enum(["model", "harness"]),
  billing: z.enum(["api-key", "subscription"]).nullable().default(null),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().nullable().default(null),
  runs: z.number().default(0),
  unreported: z.number().default(0),
});

/** One request admitted for the task, and what it spent. */
const taskSpendRequestSchema = z.object({
  /** The request, by id. A resume keeps its request's id, and its entry. */
  requestId: z.string(),
  /** What the request's endings handed on, summed per source. */
  settled: z.array(taskSpendSourceSchema).default([]),
  /** What the request has spent since its last ending, while it runs; `null` once it has ended. */
  live: z.array(taskSpendSourceSchema).nullable().default(null),
  /** The harness the request last reported a run on, or `null` when none. */
  harness: z.string().nullable().default(null),
  /** The model that harness run named, or `null`. */
  harnessModel: z.string().nullable().default(null),
  /** The model the request last called, or `null` when it called none. */
  model: z.string().nullable().default(null),
});

/** `Task.spend`: the task's requests, in the order they were admitted. */
export const taskSpendSchema = z.object({
  requests: z.array(taskSpendRequestSchema).default([]),
});

export type TaskSpendSource = z.infer<typeof taskSpendSourceSchema>;
export type TaskSpendRequest = z.infer<typeof taskSpendRequestSchema>;
export type TaskSpend = z.infer<typeof taskSpendSchema>;

/** What a reader shows of a task's spend (`taskSpendView`): `listTasks` action rows carry it. */
export const taskSpendViewSchema = z.object({
  /** The harness of the latest harness run, or `null` when none ran. */
  harness: z.string().nullable(),
  /** That run's model; with no harness run, the latest model called; `null` when none is known. */
  model: z.string().nullable(),
  /** Input tokens, every request and attempt counted, or `null` while no source has reported any. */
  inputTokens: z.number().nullable(),
  /** Output tokens likewise. */
  outputTokens: z.number().nullable(),
  /** `true` while some source in the count hasn't reported its tokens. */
  unreported: z.boolean(),
  /** `true` while a request for the task is running; never on a terminal row. */
  live: z.boolean(),
});

export type TaskSpendView = z.infer<typeof taskSpendViewSchema>;
