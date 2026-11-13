// FIX-2498; the section shape is epic FIX-2490's ER-1, the placement FIX-2498 D1.
/**
 * `workerDefaultLayer`: the sections every worker on the built-in worker flow
 * is told after its own text, and the one place their order, their opt-outs
 * and their length ceiling live.
 *
 * Two sections, each on by default, each with an opt-out in the worker's
 * `defaults` key:
 *
 * - **`date`** — today's date with its weekday, read from the server's clock
 *   on every turn, and the server's time zone named, so the worker and the
 *   user can see which day it means. Rendered under the `date` context key, so
 *   a capability an app composes adds its own line to the same block (the
 *   user's time zone, say). The block holds nothing else: no clock time, no
 *   user, no session.
 * - **`skillsIndex`** — the list of skills the worker can load, the load tool,
 *   and one line telling it to load a skill that fits before it answers. The
 *   list and the tool are the skills library's (`skills.activateTool`); this
 *   module only decides that an unset `activateTool` follows `defaults`, and
 *   adds the line, under the same `skills` key, only when the list prints. A
 *   worker that holds no skill it can load pays nothing.
 *
 * Both render as tagged context after the prompt rather than inside it: the
 * date changes every day, and at the front it would change the start of every
 * worker's prompt. The identity layer
 * (`messages/worker-identity`) stays the prompt's first entry and is not under
 * `defaults`.
 *
 * Fixed text. An app that wants other words registers its own `agent` worker
 * flow; an app that wants another date fact writes it under `date`.
 */
import { z } from "zod";
import type { BlockContext } from "@flow-state-dev/core/types";

/** The sections, in the order they render. */
export const WORKER_DEFAULT_SECTIONS = ["skillsIndex", "date"] as const;

/** One section of the default layer, by its key in `defaults`. */
export type WorkerDefaultSection = (typeof WORKER_DEFAULT_SECTIONS)[number];

/**
 * The most characters the layer's fixed text may take, with its longest
 * values: about 400 tokens. An app's `date` line and each skill's entry
 * in the list are outside it.
 */
export const WORKER_DEFAULT_LAYER_CEILING = 1600;

/**
 * A worker's `defaults` key: `false` turns every section off; an object turns
 * off the sections it sets to `false`. Absent, every section is on. A section
 * it does not know is refused by name at the mint.
 */
export const workerDefaultsSchema = z
  .union([
    z.literal(false),
    z
      .object({
        /** `false`: no date block for this worker. */
        date: z.boolean().optional(),
        /** `false`: no skills list, no load tool, no load line (unless `skills.activateTool` says otherwise). */
        skillsIndex: z.boolean().optional()
      })
      .strict()
  ])
  .optional();

/** The parsed `defaults` key. */
export type WorkerDefaults = z.infer<typeof workerDefaultsSchema>;

/** Whether `section` is on for a worker whose `defaults` key is `defaults`. */
export function defaultSectionOn(defaults: WorkerDefaults, section: WorkerDefaultSection): boolean {
  if (defaults === false) return false;
  return defaults?.[section] !== false;
}

// BP-030: a value written before the default flipped keeps its meaning.
/**
 * Whether this worker gets the skill loader and its list: the worker's own
 * `skills.activateTool` when it set one, which always wins, and
 * otherwise its `skillsIndex` section, for a worker that holds a skill. A
 * worker that holds none gets no loader by default, so it pays nothing.
 */
export function skillLoaderOn(
  config: { defaults?: WorkerDefaults; skills?: { activateTool?: boolean } },
  holdsSkill: boolean
): boolean {
  const set = config.skills?.activateTool;
  return set ?? (holdsSkill && defaultSectionOn(config.defaults, "skillsIndex"));
}

/** The line the skills section adds under the list, telling the worker to use it. */
export const SKILLS_INDEX_LINE =
  "Before you answer, check the skills listed here. If one fits the request, even in part, load it with `loadSkill` first, then answer.";

/** The server's time zone, by its IANA name. */
function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

/**
 * The date block's text for `now`, as the day falls in `timeZone`: the
 * weekday and date in words, the ISO date, and the zone named.
 */
export function formatWorkerDate(now: Date, timeZone: string): string {
  const spoken = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(now);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `Today is ${spoken} (${iso}), by the server's clock in the ${timeZone} time zone.`;
}

/**
 * Today's date block, read from the server's clock each time it is called.
 *
 * A generator context value: put it under the `date` key, as the built-in
 * worker flow does, and every call renders the day of that turn, not the day
 * the server started. A standalone generator composes the same block:
 *
 * ```ts
 * generator({ ..., context: { date: workerDate } })
 * ```
 */
export function workerDate(): string {
  return formatWorkerDate(new Date(), serverTimeZone());
}

/** What the layer reads off the turn's worker. */
interface LayerConfig {
  defaults?: WorkerDefaults;
  skills?: { activateTool?: boolean };
}

/**
 * The layer's context entries for a worker flow's answer generator.
 *
 * @param options.configOf The turn's worker settings.
 * @param options.skillsListing The skills library's own list of what this
 *   worker can load, or `null` when it lists nothing: the line prints only
 *   beside it.
 * @returns An object-form context value, keyed `skills` then `date`.
 */
export function workerDefaultLayer(options: {
  configOf: (ctx: BlockContext) => LayerConfig;
  /** Whether the turn's worker gets the skill loader: the worker flow's own read of {@link skillLoaderOn}. */
  loaderOn: (ctx: BlockContext) => boolean;
  skillsListing: (input: unknown, ctx: BlockContext) => Promise<string | null>;
}) {
  return {
    skills: async (input: unknown, ctx: BlockContext): Promise<string | null> => {
      if (!defaultSectionOn(options.configOf(ctx).defaults, "skillsIndex") || !options.loaderOn(ctx)) return null;
      return (await options.skillsListing(input, ctx)) === null ? null : SKILLS_INDEX_LINE;
    },
    date: (_input: unknown, ctx: BlockContext): string | null =>
      defaultSectionOn(options.configOf(ctx).defaults, "date") ? workerDate() : null
  };
}
