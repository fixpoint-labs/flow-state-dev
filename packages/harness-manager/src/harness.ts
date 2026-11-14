/**
 * `Harness`: one coding harness, as a plain value.
 *
 * A harness package (Claude Code, Codex, Cursor, a third party) exports one,
 * and an app puts it in the harness kit's `harnesses` slot. It carries what a
 * host used to assemble by hand from five exports: the agent a coding run
 * runs, the check that says whether this machine can run it, the environment
 * names a run is given (`pass`), and, when the harness has them, its usage
 * reader and model list.
 *
 * A stub is a harness value too: the same `id` with a scripted `agent` (the
 * scripted harness's `slot`), so a goal check's run takes the same slot,
 * coding worker flow and views as the real one.
 */
import type { HarnessBlock, HarnessModelList, HarnessReadinessCheck, HarnessUsageReader } from "@flow-state-dev/core/harness";
import { z } from "zod";
import type { HarnessFeeds } from "./manager";

/** One coding harness: the value a harness package exports and the `harnesses` slot holds. */
export interface Harness {
  /** The harness's key: what a worker's `harness:` line names, and what readiness rows are keyed by. */
  readonly id: string;
  /** The name a person sees (`Codex`). Defaults to {@link id}. */
  readonly label?: string;
  /** The block one coding run runs, built from the feeds its manager hands it. */
  readonly agent: (feeds: HarnessFeeds) => HarnessBlock;
  /** Whether this machine can run it, over the environment its runs get. */
  readonly readiness: HarnessReadinessCheck;
  /** The environment variable names a run of it is given, beside the base ones. */
  readonly pass: readonly string[];
  /** How much of its subscription the machine has used, when the harness reports it. */
  readonly usage?: HarnessUsageReader;
  /** The models it offers, when it can list them. */
  readonly models?: (options?: { signal?: AbortSignal }) => Promise<HarnessModelList>;
}

const fn = (message: string) => z.custom<(...args: never[]) => unknown>((value) => typeof value === "function", { message });

/** What the `harnesses` slot checks each entry against. */
export const harnessSchema: z.ZodType<Harness, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    agent: fn("a harness's `agent` builds the block a run runs"),
    readiness: fn("a harness's `readiness` checks whether this machine can run it"),
    pass: z.array(z.string()).readonly(),
    usage: fn("a harness's `usage` reads its subscription usage").optional(),
    models: fn("a harness's `models` lists its models").optional(),
  })
  .passthrough() as never;
