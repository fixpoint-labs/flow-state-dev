/**
 * Control `unread`: Shift Manager that never groups by the Lab's projects.
 *
 * Built into the control page in place of `src/lib/derive.ts`. Everything is
 * the real module except `projectsOf`, which ignores the project rows.
 * `ProjectsView` is the project list alone, so the control returns none of
 * them. The goal must fail at "PROJECTS equals the store's rows".
 */
import { projectsOf as groupedAsWritten, type LoadedSnapshot } from "../../../../packages/shift-manager/src/lib/derive.ts";

export * from "../../../../packages/shift-manager/src/lib/derive.ts";

/** No projects: the stored rows are never read into the grouping. */
export function projectsOf(snapshot: LoadedSnapshot): ReturnType<typeof groupedAsWritten> {
  if (!snapshot.projects.ok) return snapshot.projects;
  return { ok: true, value: { projects: [] } };
}
