/**
 * Control `gap-tabs`: the project level as it was before projects shipped.
 *
 * Built into the control page in place of `src/surfaces/Project.tsx`. Every
 * tab is a named empty state saying what arrives with FIX-1650, whatever the
 * Lab holds. The goal must fail at "a project's four tabs".
 */
import { EmptyState, Tabs } from "../../../../packages/shift-manager/src/components/ui";
import type { LoadedSnapshot } from "../../../../packages/shift-manager/src/lib/derive";
import { navigate, PROJECT_TABS, type ProjectTab } from "../../../../packages/shift-manager/src/lib/routes";
import type { Gaps } from "../../../../packages/shift-manager/src/gaps";

/** The copy each tab drew before projects shipped. */
const GAP_COPY: Record<ProjectTab, { title: string; body: string }> = {
  stream: {
    title: "No project stream yet",
    body: "Projects arrive with FIX-1650. Until then every workstream is listed on its own under PROJECTS.",
  },
  board: { title: "No project board yet", body: "A project's board gathers its workstreams' boards once projects ship (FIX-1650)." },
  workstreams: {
    title: "No project holds a workstream yet",
    body: "Grouping workstreams into projects arrives with FIX-1650. The sidebar lists every workstream directly meanwhile.",
  },
  brief: { title: "No project brief yet", body: "A project's brief arrives with FIX-1650." },
};

export function ProjectView({ projectId, tab }: { snapshot: LoadedSnapshot; projectId: string; tab: ProjectTab; gaps: Gaps }) {
  const gap = GAP_COPY[tab];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project" data-project-id={projectId}>
      <h1 className="px-4 pt-3 text-base font-semibold">All workstreams</h1>
      <Tabs label="Project" tabs={PROJECT_TABS} selected={tab} onSelect={(next) => navigate({ level: "project", projectId, tab: next })} />
      <div role="tabpanel" data-tabpanel={tab}>
        <EmptyState title={gap.title} testId={`project-${tab}-empty`}>
          {gap.body}
        </EmptyState>
      </div>
    </div>
  );
}
