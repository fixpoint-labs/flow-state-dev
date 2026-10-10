/**
 * The roster flow: a flow that runs no worker, through which a client reads a
 * user's roster. It declares the two worker collections, so a session of it
 * reads the user's own workers and the standard ones over the collection-state
 * routes, and it adds no endpoint. It declares the projects at both scopes and
 * the workstream entries too, so the same session reads the projects its user
 * may, private ones included, and a project's entries by its prefix.
 *
 * Its own kind (`workforce-roster`), so a listing of a worker flow's sessions
 * never shows a roster session. It takes no create check: a roster session
 * names no worker. The cost is one roster session per user per organization;
 * an app that lists every flow's sessions filters this kind out.
 */
import { defineFlow } from "@flow-state-dev/core";
import type { ActionConfig } from "@flow-state-dev/core/types";
import { PROJECT_ROW_RESOURCES } from "../projects/project-address";
import type { WorkerInstallation } from "./installation";
import { ROSTER_FLOW_KIND } from "./keys";

/**
 * Define the roster flow over `installation`. Register what it returns.
 *
 * @param installation The installation whose worker collections it declares.
 * @param actions Actions to mount on it, such as the hire, fork, edit and fire
 *   blocks (`createWorkerHireBlocks`). Omitted, it reads and writes nothing.
 */
export function defineWorkerRosterFlow(
  installation: WorkerInstallation,
  actions: Record<string, ActionConfig> = {}
) {
  return defineFlow({
    kind: ROSTER_FLOW_KIND,
    resources: { ...installation.resources, ...PROJECT_ROW_RESOURCES },
    actions
  });
}
