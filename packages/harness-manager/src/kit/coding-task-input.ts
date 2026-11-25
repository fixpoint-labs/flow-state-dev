// FIX-2878; epic FIX-2876 ER-9, ER-10, ER-11; BP-030; BP-031.
/**
 * What a coding task takes: the coder flow's task-input declaration, on
 * workforce's filing check (`taskInputSchema`). Every write that files a task
 * for a coding worker, or moves one onto it, passes it: `createTask`, a batch,
 * an edit or a move, the conversation's sole-delegate fill, a workstream
 * target, a routed task and a judgment turn's filing all reach the one check.
 *
 * - **The filer's fields.** `mode`, one of the app's registered modes, and
 *   `issue`, the tracker issue the task works on. With no `mode`, the app's
 *   `defaultMode` is written in at filing, then the mode is checked against
 *   the registered set (its own keys only, so `constructor` is no mode) and
 *   against its `requires`. The rest of `input` is the filer's own.
 * - **The run settings** (`harness`, `model`, `plan`) are server-owned: a
 *   filer's are dropped, and the filler writes them, decided once per call so
 *   a replay stores what the first attempt filled. From inside a coding run
 *   they are that run's; otherwise the server's default, the kit's
 *   `defaultHarness`. The model's choice of worker is honoured: the filler,
 *   not the worker, decides the coder. A claim that finds a row filled under
 *   another declaration fills nothing: an unmarked value is absent.
 * - **`doneWhen` and `workspace`** are a mode's, never a task's: a filer's are
 *   dropped.
 * - **A worker's `lock:`** names values its tasks must run with. A filing that
 *   differs on a locked field is refused by name, an inherited one too; it is
 *   never swapped to fit.
 * - **`harnessFeature`**, the marker a task named feature work with before
 *   modes, is refused on any write. A stored row's is read at claim
 *   ({@link storedCodingInput}): it runs in the registered mode whose old phase
 *   value its `phase` is, on its issue, or is refused by name.
 */
import { toolCallOf } from "@flow-state-dev/orchestration/internal";
import { TaskWriteRefusedError } from "@flow-state-dev/orchestration/tasks";
import { taskInputSchema, type TaskInputRecord, type TaskInputSchema } from "@flow-state-dev/workforce";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { HARNESS_FEATURE_KEY, harnessFeatureSchema } from "../manager";
import { isTrackerIssue, TRACKER_ISSUE_REFUSED } from "../issue-spec";
import { sameSegment } from "../workspace";
import type { ResolvedModes } from "./coder-modes";

/** The run settings a coding task carries, written by the server only. */
export const RUN_SETTINGS = ["harness", "model", "plan"] as const;

/** What a filer may not set on a coding task: the run settings, and a mode's own done check and workspace. */
const SERVER_OWNED = [...RUN_SETTINGS, "doneWhen", "workspace"] as const;

/** The mode a stored marker with no `phase` ran in before modes, when the app registers it. */
const LEGACY_FEATURE_MODE = "implement";

/**
 * A coding task's input. Declared in full, the run settings included, so the
 * declaration (and the stamp a filed row carries) does not change as later
 * settings start being filled.
 */
export const codingTaskInputSchema = z
  .object({
    mode: z
      .string()
      .min(1)
      .optional()
      .describe("The work this task is, one of this app's modes. Leave it out for the app's default mode."),
    issue: z
      .string()
      .optional()
      .describe("The tracker issue the task works on, such as ENG-142. A mode that needs one refuses a task without it."),
    harness: z.string().optional().describe("Written by the server."),
    model: z
      .union([z.string(), z.object({ id: z.string(), params: z.record(z.string(), z.unknown()).optional() }).strict()])
      .optional()
      .describe("Written by the server."),
    plan: z.boolean().optional().describe("Written by the server."),
  })
  .passthrough();

/** A coding task's input, as the claim hands it on. */
export type CodingTaskInput = z.infer<typeof codingTaskInputSchema>;

/** The run settings the server wrote on a task: none, or some of the three. */
export interface RunSettings {
  readonly harness?: string;
}

/**
 * The values a worker's `lock:` fixes. A task that differs on one is refused
 * by name, at filing and at claim.
 */
export interface WorkerLock {
  readonly harness?: string;
  readonly mode?: string;
}

/** The `lock:` a coding worker's file may carry, checked when it is hired. */
export function workerLockSchema(harnesses: readonly string[], modes: readonly string[]) {
  return z
    .object({
      harness: z.enum(harnesses as [string, ...string[]]).optional(),
      mode: z.enum(modes as [string, ...string[]]).optional(),
    })
    .strict();
}

// BP-031.
/**
 * The run settings each running coding request resolved, by its session: the
 * route that runs a coding session notes them, and a task that request files
 * carries them. Server-set, held weakly.
 */
const noted = new WeakMap<object, RunSettings>();

/** Note the run settings the running request's coding session runs with. */
export function noteRunSettings(session: object, settings: RunSettings): void {
  noted.set(session, settings);
}

/** The run settings the running request's coding session runs with; `undefined` outside a coding run. */
export function runSettingsOf(session: object): RunSettings | undefined {
  return noted.get(session);
}

const nothingFiled = "Nothing was filed.";

const listed = (names: readonly string[]) => names.map((name) => `"${name}"`).join(", ").replace(/, ([^,]*)$/, " and $1");

/** Refused at claim, ending as an attempt does. */
const refusedAtClaim = (code: string, message: string) => new TaskWriteRefusedError(code, `${message} Nothing ran.`);

// BP-030.
/**
 * A stored coding task's input in the current shape: a row carrying the old
 * `harnessFeature: { issue, phase? }` marker reads as the registered mode
 * whose old phase value its `phase` is (its name, or the name it had before),
 * on its issue. No `phase` means the phase feature work ran in: `implement`
 * where the app registers it, else the default mode. A row with no marker is
 * returned as it is. Read at claim and by every reader of stored input; never
 * on a write, which refuses the marker.
 *
 * @throws TaskWriteRefusedError for a marker beside a `mode`, one with no valid
 *   `issue`, or one whose phase no registered mode keeps: never run in another mode.
 */
export function storedCodingInput(raw: TaskInputRecord, resolved: ResolvedModes): TaskInputRecord {
  if (!Object.hasOwn(raw, HARNESS_FEATURE_KEY)) return raw;
  const { [HARNESS_FEATURE_KEY]: marker, ...rest } = raw;
  if (Object.hasOwn(raw, "mode")) {
    throw refusedAtClaim("legacy_marker", `legacy task names both harnessFeature and mode ${JSON.stringify(raw.mode)}, so which work it is can't be told.`);
  }
  const parsed = harnessFeatureSchema.safeParse(marker);
  if (!parsed.success || !isTrackerIssue(parsed.data.issue)) {
    throw refusedAtClaim("legacy_marker", `legacy task names harnessFeature with no valid issue. ${TRACKER_ISSUE_REFUSED}`);
  }
  const { issue, phase } = parsed.data;
  const mode =
    phase === undefined
      ? Object.hasOwn(resolved.modes, LEGACY_FEATURE_MODE)
        ? LEGACY_FEATURE_MODE
        : resolved.defaultMode
      : Object.entries(resolved.modes).find(
          ([name, { spec }]) => sameSegment(phase, name) || (spec.formerName !== undefined && sameSegment(phase, spec.formerName)),
        )?.[0];
  if (mode === undefined) throw refusedAtClaim("legacy_marker", `legacy task names phase ${JSON.stringify(phase)}, which no registered mode keeps.`);
  return { ...rest, mode, issue };
}

/** The mode a checked input names: its own, or the default the filing wrote. */
function modeIn(input: TaskInputRecord, resolved: ResolvedModes): string {
  return typeof input.mode === "string" ? input.mode : resolved.defaultMode;
}

/**
 * Why `input`'s mode can't run in this app: the mode isn't one it registers
 * (an own key of the registry; an inherited name is no mode), or the task
 * lacks a field the mode requires. `undefined` when it can.
 */
export function modeProblem(input: TaskInputRecord, resolved: ResolvedModes): { code: string; text: string } | undefined {
  const mode = modeIn(input, resolved);
  const names = Object.keys(resolved.modes);
  if (!Object.hasOwn(resolved.modes, mode)) {
    return {
      code: "mode_unknown",
      text: `this app has no mode ${JSON.stringify(mode)}. Its modes are ${listed(names)}. File in one of those, or ask the user.`,
    };
  }
  const missing = resolved.modes[mode]!.requires.filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length > 0) {
    const without = names.filter((name) => name !== mode && missing.every((field) => !resolved.modes[name]!.requires.includes(field)));
    return {
      code: "mode_needs_input",
      text:
        `mode ${JSON.stringify(mode)} needs ${listed(missing)}, and this task has none. ` +
        `Name ${missing.length === 1 ? "it" : "them"}${without.length === 0 ? "" : `, or file it in mode ${listed(without)}`}.`,
    };
  }
  return undefined;
}

/** What the lock compares: the task's resolved values. */
interface Resolved {
  readonly harness: string | undefined;
  readonly mode: string;
}

/** The worker's lock, read from its configuration as declared. */
function lockOf(worker: { readonly id: string; readonly config: Readonly<Record<string, unknown>> }, schema: z.ZodTypeAny): WorkerLock | undefined {
  const raw = worker.config.lock;
  if (raw === undefined || raw === null) return undefined;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new TaskWriteRefusedError("lock_unreadable", `worker "${worker.id}"'s lock can't be read, so what its tasks must run with is unknown. ${nothingFiled}`);
  }
  return parsed.data as WorkerLock;
}

/**
 * The refusal for a task that differs from `lock` on a locked field, naming
 * the field, the worker's value and the one asked for; `undefined` when none
 * differs. Compared on the resolved values, never on what a filer sent.
 */
export function lockProblem(workerId: string, lock: WorkerLock | undefined, resolved: Resolved): { code: string; text: string } | undefined {
  if (lock === undefined) return undefined;
  for (const field of ["mode", "harness"] as const) {
    const pinned = lock[field];
    if (pinned === undefined || pinned === resolved[field]) continue;
    return {
      code: `${field}_locked`,
      text:
        `worker "${workerId}" always runs with ${field} ${pinned}; this task asked for ${resolved[field] ?? "none"}. ` +
        `File it to a worker that isn't locked, or ask the user.`,
    };
  }
  return undefined;
}

/** What {@link codingTaskInput} builds the declaration from: the kit's config and the app's modes. */
export interface CodingTaskInputOptions {
  readonly modes: ResolvedModes;
  /** The kit's `defaultHarness`: the harness a filing outside any coding run carries, and a worker naming none runs. */
  readonly defaultHarness?: string;
  /** The ids the kit was filled with, for the lock. */
  readonly harnesses: readonly string[];
  /** A coding task needs a project to work in (the kit's `project`). */
  readonly project?: boolean;
}

/**
 * The run settings a filing carries, decided once per call: the filing coding
 * run's when the request runs one, else the server's default. Recorded with
 * the call, so a replay stores what the first attempt decided.
 */
async function filledSettings(ctx: BlockContext, defaultHarness: string | undefined): Promise<RunSettings> {
  const decide = async (): Promise<RunSettings> => {
    const run = runSettingsOf(ctx.session as object);
    if (run !== undefined) return run;
    return defaultHarness === undefined ? {} : { harness: defaultHarness };
  };
  const call = toolCallOf(ctx);
  return call !== undefined && ctx.runOnce !== undefined ? ctx.runOnce(`fsd.coder.run-settings:${call.logicalId}`, decide) : decide();
}

/**
 * The coder flow's task-input declaration, for its `work` entry.
 */
export function codingTaskInput(options: CodingTaskInputOptions): TaskInputSchema {
  const { modes: resolved, defaultHarness } = options;
  const lockSchema = workerLockSchema(options.harnesses, Object.keys(resolved.modes));
  return taskInputSchema(codingTaskInputSchema as unknown as z.ZodType<TaskInputRecord, z.ZodTypeDef, unknown>, {
    serverOwned: SERVER_OWNED,
    refuse: (sent) => {
      // A silent drop would turn feature work into the default mode; a translation would keep a name that is going.
      if (Object.hasOwn(sent, HARNESS_FEATURE_KEY)) {
        throw new TaskWriteRefusedError("legacy_marker", `harnessFeature is no longer accepted; file mode: "implement" with issue instead. ${nothingFiled}`);
      }
    },
    // An unmarked value is absent: a claim fills nothing, so the task runs on its worker's harness, then the kit's.
    fill: async ({ ctx, at }) => (at === "claim" ? {} : { ...(await filledSettings(ctx, defaultHarness)) }),
    check: (input, { worker }) => {
      // One order: the default mode, then the registered set and `requires`, then the lock, all on the resolved mode.
      const checked: TaskInputRecord = { ...input, mode: modeIn(input, resolved) };
      const mode = modeProblem(checked, resolved);
      if (mode !== undefined) throw new TaskWriteRefusedError(mode.code, `${mode.text} ${nothingFiled}`);
      if (checked.issue !== undefined && !isTrackerIssue(checked.issue)) {
        throw new TaskWriteRefusedError("issue_malformed", `issue ${JSON.stringify(checked.issue)} isn't a tracker issue. ${TRACKER_ISSUE_REFUSED} ${nothingFiled}`);
      }
      const harness = (checked.harness as string | undefined) ?? (worker.config.harness as string | undefined) ?? defaultHarness;
      const locked = lockProblem(worker.id, lockOf(worker, lockSchema), { harness, mode: checked.mode as string });
      if (locked !== undefined) throw new TaskWriteRefusedError(locked.code, `${locked.text} ${nothingFiled}`);
      return checked;
    },
    stored: (raw) => storedCodingInput(raw, resolved),
    ...(options.project === true ? { project: "required" as const } : {}),
  });
}
