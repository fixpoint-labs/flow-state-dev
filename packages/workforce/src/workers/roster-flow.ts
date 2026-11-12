// FIX-2085.
/**
 * The roster flow: a flow that runs no worker, which answers a user's roster
 * and changes it. Its `roster` view joins the user's own workers and the
 * standard ones at user scope, with no session (`roster-view.ts`), and its
 * `workerUsage` view reads what each of them spent (`worker-usage.ts`); its roster
 * actions (hire, fork, edit, fire, reset) run in a session of it, and it adds
 * no endpoint. It declares the projects at both scopes and
 * the workstream entries too, so the same session reads the projects its user
 * may, private ones included, and a project's entries by its prefix. It
 * declares the organization's worker inventory (`inventory/workers/*`), so the
 * same session reads who the organization's workers are without a coordinator
 * session to read it through. It declares the user's worker message log
 * (`workforce/messages/*`), so an app shows who messaged whom. And it keeps the
 * user's routines: their schedules (`workforce/schedules/*`), which its
 * `schedules` fires, and their subscriptions (`workforce/subscriptions/*`);
 * its routine actions list and write both, and each request first seeds the
 * app's declared routines (`seed`), and cleans up the ones config dropped.
 *
 * Its own kind (`workforce-roster`), so a listing of a worker flow's sessions
 * never shows a roster session. It takes no create check: a roster session
 * names no worker. The cost is one roster session per user per organization;
 * an app that lists every flow's sessions filters this flow kind out.
 */
import { defineFlow } from "@flow-state-dev/core";
import type { ActionEntry, BlockDefinition, SchedulesConfig } from "@flow-state-dev/core/types";
import { defineWorkerInventoryCollection } from "../inventory/collections";
import { workerMessagesResources } from "../messages/message-log";
import { PROJECT_ENTRY_RESOURCES } from "../projects/project-address";
import type { WorkerInstallation } from "./installation";
import { ROSTER_FLOW, ROSTER_VIEW, WORKER_USAGE_VIEW } from "./keys";
import { defineRosterView } from "./roster-view";
import { defineWorkerUsageView } from "./worker-usage";

/**
 * Define the roster flow over `installation`. Register what it returns.
 *
 * @param installation The installation whose worker collections it declares.
 * @param actions Actions to mount on it, such as the hire, fork, edit and fire
 *   blocks (`createWorkerHireBlocks`). Omitted, it reads and writes nothing.
 * @param routines The routine collections, the resolver clock fires go
 *   through (`defineScheduledWork`), and the declared routines' seed, run as
 *   each request starts. Omitted, it keeps no routines.
 */
export function defineWorkerRosterFlow(
  installation: WorkerInstallation,
  actions: Record<string, ActionEntry> = {},
  routines?: { resources: Record<string, unknown>; schedules: SchedulesConfig; seed?: BlockDefinition<any, any> }
) {
  return defineFlow({
    kind: ROSTER_FLOW,
    resources: {
      ...installation.resources,
      ...PROJECT_ENTRY_RESOURCES,
      ...workerMessagesResources,
      inventoryWorkers: defineWorkerInventoryCollection(),
      ...((routines?.resources ?? {}) as Record<string, never>)
    },
    ...(routines === undefined ? {} : { schedules: routines.schedules }),
    ...(routines?.seed === undefined ? {} : { request: { onStarted: routines.seed } }),
    actions,
    // FIX-2623: the roster, answered at user scope with no session. FIX-2624:
    // and what each of the user's workers spent, the same way.
    views: { [ROSTER_VIEW]: defineRosterView(installation), [WORKER_USAGE_VIEW]: defineWorkerUsageView(installation) }
  });
}
