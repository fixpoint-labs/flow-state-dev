/**
 * A coordinator's configuration: what its `WORKER.md` (or a user's row) may
 * set on top of the settings of the turn it runs (the built-in agent's: its
 * model, tools, skills and capabilities).
 *
 * - `delegates`: the defaults each conversation starts from. Copied into the
 *   conversation the first time its delegates are read or changed; never
 *   written back.
 * - `routing`: how a post finds its delegates. `judgment` (the default) is the
 *   coordinator's own turn deciding; `best-fit` is one evaluator call.
 * - `fallback`: the delegate a post best fit can't place goes to. One of
 *   `delegates`.
 * - `rounds`: how many times an answer goes back out. Zero by default, at most
 *   {@link MAX_ROUNDS}. Only zero is accepted for now: a coordinator doesn't
 *   send answers back out yet, so a higher value is refused rather than
 *   accepted and ignored.
 * - `model`, `tools`, `skills` and the rest: the agent turn's own, read the
 *   same way an `agent` worker's are.
 */
import { z } from "zod";
import { workerConfigSchema } from "../worker-config";
import { MAX_DELEGATES, MAX_ROUNDS } from "./coordinator-keys";

/** The routing policies a coordinator can name. */
export const COORDINATOR_ROUTING = ["judgment", "best-fit"] as const;

export type CoordinatorRouting = (typeof COORDINATOR_ROUTING)[number];

/**
 * A coordinator's configuration schema: the settings of the turn it runs plus
 * its own. On the `coordinator` flow the base is the built-in agent's settings
 * (its model, tools, skills and capabilities), since its judgment is the
 * agent's turn; with no base, the worker contract and a `model`.
 */
export function coordinatorConfigSchema<TBase extends z.AnyZodObject>(base?: TBase) {
  return (base ?? workerConfigSchema().extend({ model: z.string().min(1).optional() })).extend(coordinatorShape());
}

/** The keys a coordinator adds to its turn's settings. */
function coordinatorShape() {
  return {
    delegates: z.array(z.string().min(1)).max(MAX_DELEGATES).default([]),
    routing: z.enum(COORDINATOR_ROUTING).default("judgment"),
    fallback: z.string().min(1).optional(),
    rounds: z
      .number()
      .int()
      .min(0)
      .max(MAX_ROUNDS, { message: `rounds can be at most ${MAX_ROUNDS}` })
      .refine((rounds) => rounds === 0, { message: "rounds above 0 aren't supported yet" })
      .default(0)
  };
}

/** The keys every coordinator configuration carries, whatever its base. */
export type CoordinatorConfig = z.infer<z.ZodObject<ReturnType<typeof coordinatorShape>>> & {
  model?: string;
  instructions?: string;
};

/**
 * What a configuration's schema can't check across keys: the fallback must be
 * one of the defaults, and no default is named twice.
 *
 * @returns Each problem; empty when there is none.
 */
export function coordinatorConfigProblems(config: Pick<CoordinatorConfig, "delegates" | "fallback">): string[] {
  const problems: string[] = [];
  const twice = config.delegates.filter((name, index) => config.delegates.indexOf(name) !== index);
  if (twice.length > 0) {
    problems.push(`names ${[...new Set(twice)].map((name) => `"${name}"`).join(", ")} twice in \`delegates:\``);
  }
  if (config.fallback !== undefined && !config.delegates.includes(config.fallback)) {
    problems.push(`names "${config.fallback}" as \`fallback:\`, which isn't one of its \`delegates:\``);
  }
  return problems;
}
