/**
 * Control `unread`: Shift Manager that never groups by the Lab's projects.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module except `projectsOf`, which ignores the `projects` rows and
 * lists every workstream on its own, the flat list PROJECTS drew before
 * projects shipped. The goal must fail at "PROJECTS equals the store's rows".
 */
import { projectsOf as groupedAsWritten, type LoadedSnapshot } from "../../../../packages/shift-manager/src/lib/derive.ts";

export * from "../../../../packages/shift-manager/src/lib/derive.ts";

/** Every workstream, no project: the rows are never read into the grouping. */
export function projectsOf(snapshot: LoadedSnapshot): ReturnType<typeof groupedAsWritten> {
  if (!snapshot.inventory.ok) return snapshot.inventory;
  return { ok: true, value: { projects: [], noProject: snapshot.inventory.value.workstreams } };
}
