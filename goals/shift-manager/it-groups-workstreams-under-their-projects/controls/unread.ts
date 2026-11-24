/**
 * Control `unread`: Shift Manager that never groups by the Lab's projects.
 *
 * Built into the control page in place of `src/lib/directory.tsx`. Everything
 * is the real module except `useProjects`, which ignores the project rows: a
 * projects read that landed holds none of them. The goal must fail at
 * "PROJECTS equals the store's rows".
 */
import { useProjects as readAsWritten } from "../../../../packages/shift-manager/src/lib/directory.tsx";

export * from "../../../../packages/shift-manager/src/lib/directory.tsx";

/** No projects: the stored rows are never read into the grouping. */
export function useProjects(): ReturnType<typeof readAsWritten> {
  const read = readAsWritten();
  return read.section?.ok === true ? { ...read, section: { ok: true, value: [] } } : read;
}
