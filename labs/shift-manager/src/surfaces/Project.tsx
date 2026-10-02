/**
 * The project level (S6): reachable, four tabs, each its named empty state
 * until projects ship (BR-9), and the team strip from the seat inventory, as
 * design v2 draws it (v2:513-519): each team's name in spaced mono caps and
 * how many of its seats are on shift and on call.
 */
import { EmptyState, Meta, PartialMark, ScreenTitle, Tabs } from "../components/ui";
import { seatStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../lib/derive";
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
  const states = seatStates(snapshot);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="project" data-project-id={projectId}>
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">PROJECT</p>
        <ScreenTitle>All workstreams</ScreenTitle>
      </header>
      <ul className="flex flex-wrap items-center gap-x-[26px] gap-y-1 border-b border-foreground/[0.12] px-[22px] py-2" data-testid="team-strip" aria-label="Teams">
        {teams.map(({ team }) => {
          const counts = shiftCounts(states, team);
          return (
            <li key={team} className="flex items-center gap-2.5" data-testid="team-strip-team" data-team={team}>
              <Meta role="count" className="tracking-[0.12em] text-muted-foreground uppercase">
                {team}
              </Meta>
              <Meta>
                {counts["on shift"]} on shift · {counts["on call"]} on call
                {states.partial ? <PartialMark title={gaps.roster.partial} /> : null}
              </Meta>
            </li>
          );
        })}
      </ul>
      <Tabs label="Project" tabs={PROJECT_TABS} selected={tab} onSelect={(next) => navigate({ level: "project", projectId, tab: next })} />
      <div role="tabpanel" data-tabpanel={tab}>
        <EmptyState title={gap.title} testId={`project-${tab}-empty`}>
          {gap.body}
        </EmptyState>
      </div>
    </div>
  );
}
