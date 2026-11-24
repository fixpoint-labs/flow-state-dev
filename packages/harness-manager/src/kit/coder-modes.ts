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
import { harnessFeatureOf, namesHarnessFeature, type ModeDone, type ModeSpec } from "../manager";
import { assertSafeSegment } from "../workspace";

/** The kit's own mode's name: what a task runs when the app registers no modes. */
export const KIT_MODE = "default";

/**
 * The mode a task carrying the `harnessFeature` marker runs, when the app
 * registers one under this name. Interim: the marker is how a task names
 * feature work until a task names its mode itself.
 */
const FEATURE_MODE = "implement";

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
   * The task-input fields a task in this mode needs, such as `["issue"]`. Read
   * by the filing check; nothing here refuses a task for them. Absent: none.
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

const listed = (names: readonly string[]) => names.map((name) => `"${name}"`).join(", ");

/**
 * The app's modes, completed and checked.
 *
 * @param kitMode The kit's own mode, which a `default` entry is completed from.
 * @throws When a mode's name can't key a run, a mode other than `default` lacks
 *   `instructions` or `doneWhen`, a mode's `workspace` isn't a workspace host,
 *   `requires` names a field a task doesn't
 *   carry, or `defaultMode` names a mode that isn't registered.
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
  const defaultMode = options.defaultMode ?? KIT_MODE;
  if (!Object.hasOwn(modes, defaultMode)) {
    throw new Error(
      `${who}: the default mode is "${defaultMode}"${options.defaultMode === undefined ? " (no `defaultMode` is set)" : ""}, ` +
        `which is not registered; its modes are ${listed(names)}.`,
    );
  }
  return { modes, defaultMode };
}

/**
 * The mode a task runs: a task carrying the `harnessFeature` marker, well
 * formed or not, runs `implement` when the app registers it (a malformed one
 * is then refused inside the run); every other task runs the default mode.
 */
export function modeOfTask(input: unknown, resolved: ResolvedModes): string {
  return namesHarnessFeature(input) && Object.hasOwn(resolved.modes, FEATURE_MODE) ? FEATURE_MODE : resolved.defaultMode;
}

/**
 * The mode name a task's run is keyed by, for a reader that finds the run
 * from the task (a line typed in its session): a feature task's own `phase`
 * when it names one, else its mode's, with the mode's former name. `undefined`
 * for a malformed marker, which no run is keyed by.
 */
export function runModeOfTask(input: unknown, resolved: ResolvedModes): { readonly name: string; readonly formerName?: string } | undefined {
  const { name, formerName } = resolved.modes[modeOfTask(input, resolved)]!.spec;
  const keyed = formerName === undefined ? { name } : { name, formerName };
  if (!namesHarnessFeature(input)) return keyed;
  const feature = harnessFeatureOf(input);
  if (feature === undefined) return undefined;
  return feature.phase === undefined ? keyed : { name: feature.phase };
}
