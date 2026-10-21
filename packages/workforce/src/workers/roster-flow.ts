/**
 * The roster flow: a flow that runs no worker, through which a client reads a
 * user's roster. It declares the two worker collections, so a session of it
 * reads the user's own workers and the standard ones over the collection-state
 * routes, and it adds no endpoint. It declares the projects at both scopes and
 * the workstream entries too, so the same session reads the projects its user
 * may, private ones included, and a project's entries by its prefix. It
 * declares the organization's worker inventory (`inventory/workers/*`), so the
 * same session reads who the organization's workers are without a coordinator
 * session to read it through. It declares the user's worker message log
 * (`workforce/messages/*`), so an app shows who messaged whom. And it keeps the
 * user's schedules (`workforce/schedules/*`, FIX-2085): its `schedules` fires
 * each one, and its schedule actions list and write them.
 *
 * Its own kind (`workforce-roster`), so a listing of a worker flow's sessions
 * never shows a roster session. It takes no create check: a roster session
 * names no worker. The cost is one roster session per user per organization;
 * an app that lists every flow's sessions filters this flow kind out.
 */
import { defineFlow } from "@flow-state-dev/core";
import type { ActionConfig, SchedulesConfig } from "@flow-state-dev/core/types";
import { defineWorkerInventoryCollection } from "../inventory/collections";
import { workerMessagesResources } from "../messages/message-log";
import { PROJECT_ROW_RESOURCES } from "../projects/project-address";
import type { ScheduledWork } from "../schedules/scheduled-work";
import type { WorkerInstallation } from "./installation";
import { ROSTER_FLOW } from "./keys";

/**
 * Define the roster flow over `installation`. Register what it returns.
 *
 * @param installation The installation whose worker collections it declares.
 * @param actions Actions to mount on it, such as the hire, fork, edit and fire
 *   blocks (`createWorkerHireBlocks`). Omitted, it reads and writes nothing.
 * @param scheduled Recurring work (`defineScheduledWork`): the schedule
 *   collection and the resolver its fires go through. Omitted, it keeps no
 *   schedules.
 */
export function defineWorkerRosterFlow(
  installation: WorkerInstallation,
  actions: Record<string, ActionConfig> = {},
  scheduled?: Pick<ScheduledWork, "resources" | "schedules">
) {
  return defineFlow({
    kind: ROSTER_FLOW,
    resources: {
      ...installation.resources,
      ...PROJECT_ROW_RESOURCES,
      ...workerMessagesResources,
      inventoryWorkers: defineWorkerInventoryCollection(),
      ...(scheduled?.resources ?? {})
    },
    ...(scheduled === undefined ? {} : { schedules: scheduled.schedules as SchedulesConfig }),
    actions
  });
}
