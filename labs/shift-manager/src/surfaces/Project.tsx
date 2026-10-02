/**
 * The project level (S6): reachable, four tabs, each its named empty state
 * until projects ship (BR-9), and the team strip from the seat inventory.
 */
import { EmptyState, ScreenTitle, Tabs } from "../components/ui";
import { teamsOf, type LoadedSnapshot } from "../lib/derive";
import { navigate, PROJECT_TABS, type ProjectTab } from "../lib/routes";
import type { Gaps } from "../gaps";

export function ProjectView({
  snapshot,
  projectId,
  tab,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  projectId: string;
  tab: ProjectTab;
  gaps: Gaps;
}) {
  const gap = {
    stream: gaps.projectStream,
    board: gaps.projectBoard,
    workstreams: gaps.projectWorkstreams,
    brief: gaps.projectBrief,
  }[tab];
  const teams = snapshot.inventory.ok ? teamsOf(snapshot.inventory.value.seats) : [];
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project" data-project-id={projectId}>
      <header className="flex items-end justify-between px-4 pt-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">PROJECT</p>
          <ScreenTitle>All workstreams</ScreenTitle>
        </div>
        <ul className="flex gap-2 pb-1" data-testid="team-strip" aria-label="Teams">
          {teams.map(({ team, seats }) => (
            <li key={team} className="border px-2 py-0.5 text-xs">
              {team} <span className="text-muted-foreground">{seats.length}</span>
            </li>
          ))}
        </ul>
      </header>
      <Tabs label="Project" tabs={PROJECT_TABS} selected={tab} onSelect={(next) => navigate({ level: "project", projectId, tab: next })} />
      <div role="tabpanel" data-tabpanel={tab}>
        <EmptyState title={gap.title} testId={`project-${tab}-empty`}>
          {gap.body}
        </EmptyState>
      </div>
    </div>
  );
}
