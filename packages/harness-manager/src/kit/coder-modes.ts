/**
 * The coding worker flow's modes: the ways an app's coding runs can work, by
 * name, each with how its run is told what to do (`instructions`), when it
 * counts as done (`doneWhen`), where it works (`workspace`) and the task-input
 * fields it needs (`requires`).
 *
 * An app that registers none gets the kit's one mode, `default`. An app may
 * register its own beside or instead of it; a `default` entry it registers is
 * completed from the kit's, so `modes: { default: { instructions } }` keeps the
 * kit's done check and workspace. `defaultMode` names the mode a task that
 * names none runs. Everything here is checked when the flow is built, so a
 * typo fails the host and never a task.
 */
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import type { ModeDone, ModeSpec } from "../manager";
import { TaskWriteRefusedError } from "@flow-state-dev/orchestration/tasks";
import { trustedCodingInput } from "./coding-task-input";
import { quotedList as listed } from "./quoted-list";
import { assertSafeSegment, sameSegment } from "../workspace";

/** The kit's own mode's name: what a task runs when the app registers no modes. */
export const KIT_MODE = "default";

/** The task-input fields a mode can need: the ones a filer writes. */
const TASK_INPUT_FIELDS = ["issue", "project"] as const;

/** A task-input field a mode can need (`requires`). */
export type CodingTaskInputField = (typeof TASK_INPUT_FIELDS)[number];

/** One mode an app registers on the coding worker flow. */
export interface CoderMode {
  /** The run's prompt, the task's own text included, rebuilt on every wake (`ModeSpec.instructions`). */
  instructions: ModeSpec["instructions"];
  /**
   * When the run counts as done: the server-side check, with how long it may
   * take and what it needs from the workspace, or the check alone.
   */
  doneWhen: ModeDone | ModeDone["check"];
  /** Where the run works: a workspace host, as the kit's own `workspace` is. Absent: the kit's. */
  workspace?: WorkspaceHost;
  /**
   * The task-input fields a task in this mode needs, such as `["issue"]`. The
   * filing check refuses a task in this mode without them, by name, and the
   * claim checks again. Absent: none.
   */
  requires?: readonly CodingTaskInputField[];
  /**
   * This mode's runs work in their task's project: they hold the project
   * collections their workspace's source reads, and run the project's checks.
   * Overrides the kit's `project` for this mode only; whether a filing needs a
   * project stays the kit's. Absent: the kit's.
   */
  project?: boolean;
}

/** A mode as the flow runs it: its spec, where it works, and what it needs. */
export interface ResolvedMode {
  spec: ModeSpec;
  /** Absent: the kit's workspace. */
  workspace?: WorkspaceHost;
  requires: readonly CodingTaskInputField[];
  /** Absent: the kit's `project`. */
  project?: boolean;
}

/** The modes a flow runs, by name, and the one a task naming none runs. */
export interface ResolvedModes {
  modes: Readonly<Record<string, ResolvedMode>>;
  defaultMode: string;
}


/**
 * The app's modes, completed and checked.
 *
 * @param kitMode The kit's own mode, which a `default` entry is completed from.
 * @throws When a mode's name can't key a run, a mode other than `default` lacks
 *   `instructions` or `doneWhen`, a mode's `workspace` isn't a workspace host,
 *   `requires` names a field a task doesn't
 *   carry, a mode is named as another mode's `formerName`, or `defaultMode`
 *   names a mode that isn't registered.
 */
export function resolveCoderModes(
  options: { modes?: Readonly<Record<string, Partial<CoderMode>>>; defaultMode?: string },
  kitMode: ModeSpec,
  who: string,
): ResolvedModes {
  const given = options.modes ?? { [KIT_MODE]: {} };
  const names = Object.keys(given);
  if (names.length === 0) throw new Error(`${who}: \`modes\` registers no mode; omit it for the kit's "${KIT_MODE}" mode.`);
  const modes: Record<string, ResolvedMode> = {};
  for (const name of names) {
    let canonical: string;
    try {
      canonical = assertSafeSegment("mode", name);
    } catch (refused) {
      throw new Error(`${who}: mode "${name}" can't name a run: ${(refused as Error).message}`);
    }
    if (canonical !== name) throw new Error(`${who}: mode "${name}" can't name a run; write it as "${canonical}".`);
    const mode = given[name]!;
    const base = name === KIT_MODE ? kitMode : undefined;
    const instructions = mode.instructions ?? base?.instructions;
    const doneWhen = mode.doneWhen === undefined ? base?.doneWhen : typeof mode.doneWhen === "function" ? { check: mode.doneWhen } : mode.doneWhen;
    if (instructions === undefined || doneWhen === undefined) {
      throw new Error(`${who}: mode "${name}" needs ${[instructions === undefined ? "`instructions`" : "", doneWhen === undefined ? "`doneWhen`" : ""].filter(Boolean).join(" and ")}.`);
    }
    if (mode.workspace !== undefined && typeof (mode.workspace as Partial<WorkspaceHost>).provision !== "function") {
      throw new Error(`${who}: mode "${name}" names a workspace that isn't a workspace host; pass one (\`localWorkspaceHost(…)\`), as the kit's \`workspace\` is.`);
    }
    const requires = mode.requires ?? [];
    const unknown = requires.filter((field) => !(TASK_INPUT_FIELDS as readonly string[]).includes(field));
    if (unknown.length > 0) {
      throw new Error(`${who}: mode "${name}" requires ${listed(unknown)}, which a task doesn't carry; a mode can require ${listed(TASK_INPUT_FIELDS)}.`);
    }
    modes[name] = {
      // The kit's mode keeps its former name, so a run stored under it is still found.
      spec: { ...(base ?? {}), name, instructions, doneWhen },
      ...(mode.workspace === undefined ? {} : { workspace: mode.workspace }),
      requires,
      ...(mode.project === undefined ? {} : { project: mode.project }),
    };
  }
  // A run stored or frozen under a mode's former name would be either mode's.
  for (const [name, { spec }] of Object.entries(modes)) {
    const clash = names.find((other) => other !== name && spec.formerName !== undefined && sameSegment(other, spec.formerName));
    if (clash !== undefined) {
      throw new Error(`${who}: mode "${clash}" is the former name of mode "${name}", whose runs were stored under it; name it something else.`);
    }
  }
  const defaultMode = options.defaultMode ?? KIT_MODE;
  if (!Object.hasOwn(modes, defaultMode)) {
    throw new Error(
      `${who}: the default mode is "${defaultMode}"${options.defaultMode === undefined ? " (no `defaultMode` is set)" : ""}, ` +
        `which is not registered; its modes are ${listed(names)}.`,
    );
  }
  return { modes, defaultMode };
}

// FIX-2878.
/**
 * The mode a task runs: the one its checked input names, which the filing
 * check wrote (the app's default when the filer named none) or the claim read
 * from a stored row (`storedCodingInput`). A route hands it the input the
 * claim checked, never the filer's raw `input`: a `harnessFeature` marker
 * there is no mode, and a task carrying only that runs the default mode.
 */
export function modeOfTask(input: unknown, resolved: ResolvedModes): string {
  const mode = (input as { mode?: unknown } | undefined)?.mode;
  return typeof mode === "string" ? mode : resolved.defaultMode;
}

/**
 * The mode a task's run is keyed by, with its former name, for a reader that
 * finds the run from the stored task (a line typed in its session): the
 * stored input read as the claim reads it, `stamped` saying whether the
 * filing check wrote it. `undefined` for a row no run is keyed by: one the
 * claim refuses, or one in a mode the app no longer has.
 *
 * @throws Any error the legacy read throws that isn't its refusal.
 */
export function runModeOfTask(input: unknown, resolved: ResolvedModes, stamped: boolean): { readonly name: string; readonly formerName?: string } | undefined {
  const raw = input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  let read: Record<string, unknown>;
  try {
    read = trustedCodingInput(raw, stamped, resolved);
  } catch (error) {
    // Only the legacy read's own refusal means no run is keyed by the row; anything else is a fault, and surfaces.
    if (error instanceof TaskWriteRefusedError) return undefined;
    throw error;
  }
  const name = modeOfTask(read, resolved);
  if (!Object.hasOwn(resolved.modes, name)) return undefined;
  const { formerName } = resolved.modes[name]!.spec;
  return formerName === undefined ? { name } : { name, formerName };
}
