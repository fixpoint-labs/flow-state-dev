// FIX-2498; the section shape is epic FIX-2490's ER-1, the placement FIX-2498 D1.
// FIX-2500: the history summary section.
/**
 * `workerDefaultLayer`: the sections every worker on the built-in worker flow
 * is told after its own text, and the one place their order, their opt-outs
 * and their length ceiling live.
 *
 * Three sections, each on by default, each with an opt-out in the worker's
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
 * - **`historySummary`** — a running summary of the turns about to leave the
 *   history window, folded before the worker answers and handed to it as an
 *   `<earlier-conversation>` context section, with history read from after the
 *   summary's mark. Core's `historySummary`, with the summarizer the Teammates
 *   lab proved, run on the worker's own model. A short conversation pays one
 *   store read per turn and no model call. An app that brings its own summary
 *   replaces this one ({@link workerDefaultLayer}'s `appSummary`).
 *
 * All three render as tagged context after the prompt rather than inside it: the
 * date changes every day, and at the front it would change the start of every
 * worker's prompt. The identity layer
 * (`messages/worker-identity`) stays the prompt's first entry and is not under
 * `defaults`.
 *
 * Fixed text. An app that wants other words registers its own `agent` worker
 * flow; an app that wants another date fact writes it under `date`.
 */
import { z } from "zod";
import { utility, type CapabilityRef } from "@flow-state-dev/core";
import { getBaseCapability } from "@flow-state-dev/core/capability";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { WorkerCapabilityCatalog } from "./worker-capabilities";

/** One section of the default layer, by its key in `defaults`. They render skills index first, then date. */
type WorkerDefaultSection = "skillsIndex" | "date" | "historySummary";

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
        skillsIndex: z.boolean().optional(),
        /** `false`: no summary of older turns; past the window they drop out. */
        historySummary: z.boolean().optional()
      })
      .strict()
  ])
  .optional();

/** The parsed `defaults` key. */
export type WorkerDefaults = z.infer<typeof workerDefaultsSchema>;

/** Whether `section` is on for a worker whose `defaults` key is `defaults`. */
function defaultSectionOn(defaults: WorkerDefaults, section: WorkerDefaultSection): boolean {
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

// Moved from the Teammates lab (FIX-2500 D1): the summarizer the fold ask passed on.
/** What the default summary is told to keep. Named, or a small model summarizes the newer turns alone and drops the summary so far. */
const HISTORY_SUMMARY_OBJECTIVES = [
  "The input's `summary` is the summary so far and `turns` are newer turns: write one summary of both, never of the turns alone.",
  "Your summary replaces the summary so far: everything it says must still be in yours, then add what the newer turns add.",
  "Keep every name, date, code and number the user or another worker stated, word for word. Small talk can shrink; those never go."
];

/**
 * The history summary section: core's `historySummary` with the default
 * summarizer, both halves behind one reader of the worker's `defaults`.
 *
 * The fold runs when `on` says so; the summary and the history mark reach the
 * answer through `uses`, a per-turn entry, so a worker that turned it off
 * reads the plain window. Gating one half alone breaks: core's summary refuses
 * to render once turns have left the window and no fold has run. The
 * resource is declared through `resources`, statically, since a per-turn
 * entry installs none.
 */
function historySummarySection(configOf: (ctx: BlockContext) => LayerConfig, modelOf: (ctx: BlockContext) => string) {
  const earlier = utility.historySummary({
    summarize: utility.summarizer({
      name: "earlier-turns",
      // The model the worker answers with.
      model: (_input: unknown, ctx: BlockContext) => modelOf(ctx),
      granularity: "detailed",
      objectives: HISTORY_SUMMARY_OBJECTIVES
    })
  });
  const on = (ctx: BlockContext): boolean => defaultSectionOn(configOf(ctx).defaults, "historySummary");
  return {
    /** Whether this turn's worker folds and reads the summary. */
    on,
    /** The fold step, run before the answer when {@link on}. */
    fold: earlier.fold,
    /** The answer's per-turn `uses` entry: the summary's context and history mark, when {@link on}. */
    uses: (ctx: BlockContext): CapabilityRef[] => (on(ctx) ? [earlier.capability] : []),
    /** The summary's session resource, `historySummary`, for the answer to declare. */
    resources: { historySummary: earlier.resource }
  };
}

/**
 * Whether the app brought its own history summary: a capability in the worker
 * flow's catalogue (its top-level static `uses`) that declares a resource on
 * core's `historySummaryStateSchema`. Matched on the schema, by reference, not
 * by name: another name would double, the same name would refuse to build. A
 * summary passed as a dynamic entry, or not built from core's piece, is not
 * seen.
 */
export function bringsHistorySummary(catalog: WorkerCapabilityCatalog): boolean {
  for (const { ref } of catalog.values()) {
    const resources = Object.values(getBaseCapability(ref).resources ?? {});
    if (resources.some((entry) => (entry as { stateSchema?: unknown }).stateSchema === utility.historySummaryStateSchema)) {
      return true;
    }
  }
  return false;
}

/**
 * The layer's context entries for a worker flow's answer generator.
 *
 * @param options.configOf The turn's worker settings.
 * @param options.skillsListing The skills library's own list of what this
 *   worker can load, or `null` when it lists nothing: the line prints only
 *   beside it.
 * @param options.modelOf The model the turn's worker answers with.
 * @param options.appSummary Whether the app brought its own history summary
 *   ({@link bringsHistorySummary}): then the layer has no summary section.
 * @returns `context`, an object-form context value keyed `skills` then
 *   `date`; and `historySummary`, the summary section's fold, per-turn `uses`
 *   entry and resource, absent when the app brought its own.
 */
export function workerDefaultLayer(options: {
  configOf: (ctx: BlockContext) => LayerConfig;
  /** Whether the turn's worker gets the skill loader: the worker flow's own read of {@link skillLoaderOn}. */
  loaderOn: (ctx: BlockContext) => boolean;
  skillsListing: (input: unknown, ctx: BlockContext) => Promise<string | null>;
  /** The model the turn's worker answers with, which its summary folds on. */
  modelOf: (ctx: BlockContext) => string;
  appSummary: boolean;
}) {
  return {
    context: {
      skills: async (input: unknown, ctx: BlockContext): Promise<string | null> => {
        if (!defaultSectionOn(options.configOf(ctx).defaults, "skillsIndex") || !options.loaderOn(ctx)) return null;
        return (await options.skillsListing(input, ctx)) === null ? null : SKILLS_INDEX_LINE;
      },
      date: (_input: unknown, ctx: BlockContext): string | null =>
        defaultSectionOn(options.configOf(ctx).defaults, "date") ? workerDate() : null
    },
    historySummary: options.appSummary ? undefined : historySummarySection(options.configOf, options.modelOf)
  };
}
