/**
 * The operator's setup command, run once in a checkout the host just made, so
 * a run starts in a tree it can build and test in (installed dependencies,
 * say) instead of spending its first turn on that or failing outright.
 *
 * Opt-in: a host given no `setup` runs nothing here. When it has one:
 *
 * - **Once per fresh checkout.** It runs when a provision made the tree (a
 *   new branch, an existing branch checked out again, a tree rebuilt from
 *   held work), never on a hand-back of a tree that was already set up.
 * - **Until it succeeds.** A marker beside the checkout is written before the
 *   command starts and removed only when it exits 0, so a failed or killed
 *   setup runs again on the next provision.
 * - **Inside the provision's one budget.** It is the last step of
 *   `provision`, under the place's lock, timed by what is left of
 *   `provisionTimeoutMs`. A caller that sizes a lease from that budget stays
 *   right.
 * - **A failure is an outcome, not a refusal.** The checkout is handed over
 *   all the same, with the failure and the tail of the command's output on
 *   `place.setup`, so the caller can say so and the run can still work (or
 *   fix what broke).
 */
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { run } from "./exec";

/** A command a host runs in each checkout it makes. See `LocalWorkspaceHostOptions.setup`. */
export interface WorkspaceSetup {
  /** The program and its arguments, run in the checkout without a shell. */
  command: readonly [string, ...string[]];
  /** Extra environment, laid over the host process's own. */
  env?: Record<string, string>;
}

/** What one setup run came to. On `WorkspacePlace.setup` when the provision ran it. */
export type PlaceSetup =
  | { status: "done" }
  | {
      status: "failed";
      /** The last lines the command wrote, and how it ended, for a person to read. */
      tail: string;
    };

/** How many lines of output a failure keeps. */
const TAIL_LINES = 20;
/** And how many characters, from the end, so one long line can't flood a notice. */
const TAIL_CHARS = 2_000;

/**
 * Run `setup` in `checkout` when this provision made the tree or the last
 * setup there never finished; otherwise do nothing.
 *
 * @param fresh Whether this provision made the tree.
 * @param marker Beside the checkout, never inside it: present while a setup is owed.
 * @param timeoutMs What is left of the provision's budget.
 * @param onSetup Told before the command starts. Awaited.
 * @returns The outcome, or `undefined` when nothing ran.
 */
export async function setUpCheckout(
  setup: WorkspaceSetup | undefined,
  checkout: string,
  marker: string,
  fresh: boolean,
  timeoutMs: () => number,
  onSetup?: () => void | Promise<void>,
): Promise<PlaceSetup | undefined> {
  if (setup === undefined || (!fresh && !existsSync(marker))) return undefined;
  writeFileSync(marker, "");
  await onSetup?.();
  const lines: string[] = [];
  const [file, ...args] = setup.command;
  try {
    await run(file, args, {
      cwd: checkout,
      timeoutMs: timeoutMs(),
      ...(setup.env !== undefined ? { env: setup.env } : {}),
      onLine: (line) => {
        lines.push(line);
        if (lines.length > TAIL_LINES) lines.shift();
      },
    });
  } catch (error) {
    return { status: "failed", tail: tailOf(lines, error) };
  }
  rmSync(marker, { force: true });
  return { status: "done" };
}

/** The output's last lines, then how the command ended. */
function tailOf(stdout: readonly string[], error: unknown): string {
  const failure = error as { stderr?: unknown; killed?: unknown; code?: unknown; message?: unknown };
  const stderr = typeof failure.stderr === "string" ? failure.stderr.split("\n").filter((l) => l.trim() !== "") : [];
  const ended =
    failure.killed === true
      ? "The setup command was stopped: it ran past the provision's budget (provisionTimeoutMs)."
      : typeof failure.code === "number"
        ? `The setup command exited ${failure.code}.`
        : `The setup command did not run: ${firstLineOf(failure.message)}`;
  const text = [...stdout, ...stderr].slice(-TAIL_LINES).concat(ended).join("\n");
  return text.length <= TAIL_CHARS ? text : `…${text.slice(-(TAIL_CHARS - 1))}`;
}

function firstLineOf(message: unknown): string {
  return typeof message === "string" ? (message.split("\n")[0] ?? "") : String(message);
}
