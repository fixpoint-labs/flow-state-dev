/**
 * `projectChecks()`: the commands that check a coding run's project, for a
 * host that opts in to running them.
 *
 * A project names its checks on its row (`checks`); nothing runs them until a
 * host hands this resolver to harness-manager's `commandCheck` (or a session
 * flow's `verify`). That is the host's call, once, for its own machine: the
 * commands are a project member's words, run in the run's checkout.
 *
 * Per run, it finds the run's project with the same reader `projectWorkspace()`
 * and `projectMcpTools()` use (`run-project.ts`), so the checks come from the
 * same read of stored, server-written data as the checkout, never a task's
 * payload or a prompt (BP-031). Read fresh on every call, so a list changed
 * between two attempts applies to the second.
 *
 * A run with no project, or one the lookup refuses, gets `[]`: the run source
 * refuses that run on its own, before anything runs.
 *
 * @example
 *   const phase = commandCheck(codePhase, { commands: projectChecks(), timeoutMs: 10 * 60_000 });
 */
import type { LooseBlockContext } from "@flow-state-dev/core";
import { runProjectOf } from "./run-project";

/** A resolver answering one run's project's checks, handed the run's context as harness-manager hands it. */
export type ProjectChecksResolver = (run: { ctx: unknown }) => Promise<string[]>;

/**
 * The resolver. The run's context must hold the collections
 * `projectWorkspaceCapability` installs, as a run on `projectWorkspace()` does.
 */
export function projectChecks(): ProjectChecksResolver {
  return async (run) => {
    const found = await runProjectOf(run.ctx as LooseBlockContext);
    return found.kind === "refused" ? [] : [...(found.project.checks ?? [])];
  };
}
