/**
 * The sidebar (S5): in order, the organization, Jump to, Shift Coordinator,
 * Inbox, Tasks and Roster with their counts, PROJECTS, TEAMS, and a footer
 * (BR-6) with the on-shift and on-call counts. A header above them all carries
 * the mark, which changes the theme with a click, and names the theme.
 *
 * Every entry is drawn from the one snapshot, so a count and the screen it
 * opens always agree; every status and status count from its one
 * `seatStates` result, so they agree with Roster. PROJECTS lists each project
 * with its workstreams, then No project; TEAMS is one row per
 * team with a status square per seat, opening Roster for that team. A failed
 * read shows its section's Retry and nothing else changes (BR-11).
 *
 * Drawn in design v2's frame: 248px wide on v2's sidebar surface, darker than
 * the page; square; labels, counts and the footer in mono (v2:26-113). Shift
 * Coordinator is v2's bordered entry; Inbox, Tasks and Roster carry v2's icons;
 * Inbox's count wears the highlighter only while an ask waits, and Tasks' is
 * blue; the current row is v2's blue tint at 700; each workstream has its `#`
 * and its needs-you or running dot; TEAMS says what its counts are; and the
 * footer ends its counts with the person's initials (v2:52-113, 1173-1188).
 *
 * Collapsed, it is a 48px rail: the toggle that expands it, then an icon each
 * for Shift Coordinator, Inbox (with its count while an ask waits), Tasks,
 * Roster and Jump to. Each icon names itself on hover and navigates as its
 * entry does.
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { themeLabel, type ThemeLook } from "../lib/theme";
import { navigate, NO_PROJECT, type Route } from "../lib/routes";
import { useLab } from "../lib/lab-data";
import { openRows, projectsOf, seatStates, shiftCounts, streamCounts, teamsOf, type LoadedSnapshot } from "../lib/derive";
import type { Workstream } from "../lib/reads";
import { initialsOf, streamMark } from "../lib/shell";
import { useChiefOfStaffWorking } from "../lib/working";
import { Meta, PartialMark, SectionFailure, ShiftMark, StateSquare } from "../components/ui";
import { ShiftManagerMark } from "../components/ShiftManagerMark";
import type { Gaps } from "../gaps";

function NavItem({
  label,
  icon,
  count,
  mark,
  active,
  onClick,
  testId,
}: {
  label: string;
  /** v2's 14px line icon, drawn before the label (v2:58, 63, 68). */
  icon?: ReactNode;
  count?: number | string;
  /** Drawn after the count. */
  mark?: ReactNode;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={`flex w-full items-center gap-[9px] px-[7px] py-1.5 text-left text-[13.5px] ${
        active ? "bg-accent font-bold text-accent-foreground" : "font-medium hover:bg-foreground/6"
      }`}
    >
      {icon}
      <span className="flex-1 truncate" data-look="nav-label">
        {label}
      </span>
      {count === undefined ? null : (
        <Meta role="count" className="ml-2 tabular-nums text-muted-foreground" testId={`${testId}-count`}>
          {count}
        </Meta>
      )}
      {mark}
    </button>
  );
}

/** v2's 14px line icons for Inbox, Tasks and Roster (v2:58, 63, 68), stroked in the text's colour. */
const ICON_PATHS = {
  /** The toggle: a panel with its left column marked. */
  panel: "M1.5 1.5h11v11h-11z M5 1.5v11",
  jump: "M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M9.3 9.3l3.2 3.2",
  inbox: "M1.5 1.5h11v11h-11z M1.5 8.5h3.2l1 1.8h2.6l1-1.8h3.2",
  tasks: "M1.5 3h2 M5.5 3h7 M1.5 7h2 M5.5 7h7 M1.5 11h2 M5.5 11h7",
  roster: "M1.5 1.5h4.5v4.5h-4.5z M8 1.5h4.5v4.5h-4.5z M1.5 8h4.5v4.5h-4.5z M8 8h4.5v4.5h-4.5z",
} as const;

function NavIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.2} className="size-3.5 shrink-0 text-foreground" aria-hidden data-look="nav-icon">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/**
 * The Shift Coordinator entry, v2's bordered card row (v2:52-56): an 18px SC
 * square, the name at 600, inverted to ink when it is the current screen, and
 * a blue dot while the shift coordinator works on a line sent from this page.
 */
function ChiefOfStaffEntry({ active }: { active: boolean }) {
  const working = useChiefOfStaffWorking();
  return (
    <button
      type="button"
      onClick={() => navigate({ level: "cos" })}
      aria-current={active ? "page" : undefined}
      data-testid="nav-cos"
      className={`mb-[5px] flex w-full items-center gap-[9px] border p-[7px] text-left text-[13.5px] font-semibold ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-foreground/30 bg-card text-foreground hover:border-foreground"
      }`}
    >
      <span
        className={`flex size-[18px] shrink-0 items-center justify-center border font-mono text-[7.5px] font-semibold ${
          active ? "border-primary-foreground bg-primary-foreground text-primary" : "border-primary bg-primary text-primary-foreground"
        }`}
        data-look="avatar"
        aria-hidden
      >
        SC
      </span>
      <span className="flex-1 truncate" data-look="nav-label">
        Shift Coordinator
      </span>
      <span className={`size-[7px] shrink-0 ${working ? "bg-info" : ""}`} data-look="working" data-working={working} aria-hidden />
    </button>
  );
}

/**
 * A workstream under PROJECTS (v2:88): a mono `#`, its name, and a dot, the
 * highlighter while one of its members' asks waits on the person, else blue
 * while a row on its boards runs, else none (v2:1183-1184).
 */
function StreamItem({ id, state, active }: { id: string; state: "needs" | "run" | null; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate({ level: "workstream", mailboxId: id, tab: "stream" })}
      aria-current={active ? "page" : undefined}
      data-testid={`nav-workstream-${id}`}
      data-dot={state ?? "none"}
      className={`flex w-full items-center gap-[7px] px-1.5 py-[5px] text-left text-[13px] ${
        active ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-foreground/6"
      }`}
    >
      <Meta className="text-[11.5px] text-muted-foreground">#</Meta>
      <span className="min-w-0 flex-1 truncate" data-look="nav-label">
        {id}
      </span>
      {state === null ? null : <StateSquare state={state} className="size-1.5" />}
    </button>
  );
}

function Heading({ children, aside, onClick, testId }: { children: string; aside?: string; onClick?: () => void; testId: string }) {
  const className = "flex justify-between px-1.5 pt-4 pb-1.5 text-muted-foreground";
  const label = (
    <>
      <Meta role="label">{children}</Meta>
      {aside === undefined ? null : <Meta role="label">{aside}</Meta>}
    </>
  );
  return onClick === undefined ? (
    <p className={className} data-testid={testId}>
      {label}
    </p>
  ) : (
    <button type="button" className={`${className} w-full text-left hover:text-foreground`} onClick={onClick} data-testid={testId}>
      {label}
    </button>
  );
}

/** The organization this person's sessions are bound to. One per Lab principal. */
function OrgSwitcher({ orgId, onSwitch }: { orgId: string; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" data-testid="org-switcher">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between border px-2 py-1.5 text-left text-sm"
      >
        <span className="truncate font-medium">{orgId}</span>
        <Meta role="count" className="text-muted-foreground">▾</Meta>
      </button>
      {open ? (
        <div role="menu" className="absolute inset-x-0 top-full z-10 mt-1 border bg-popover p-1 text-popover-foreground shadow">
          <button
            type="button"
            role="menuitemradio"
            aria-checked
            className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => {
              setOpen(false);
              onSwitch();
            }}
          >
            {orgId}
          </button>
          <p className="px-2 py-1 text-xs text-muted-foreground">
            The Lab binds you to one organization; it is the only one to switch to.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The control that collapses the sidebar to its rail, or expands it back (`[`). */
function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${label} ([)`}
      aria-label={label}
      aria-expanded={!collapsed}
      data-testid="sidebar-toggle"
      className="flex size-7 shrink-0 items-center justify-center hover:bg-foreground/6"
    >
      <NavIcon name="panel" />
    </button>
  );
}

/** The mark, the app's name, and the theme it's in: `Evening shift`. Then the toggle. */
function SidebarHeader({ look, onToggle }: { look: ThemeLook; onToggle: () => void }) {
  const theme = useSyncExternalStore(look.subscribe, look.current);
  return (
    <div className="flex items-center gap-2.5 border-b px-3.5 pt-3.5 pb-3" data-testid="sidebar-header">
      <ShiftManagerMark look={look} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold tracking-tight">Shift Manager</p>
        <Meta role="label" className="block truncate text-muted-foreground" testId="sidebar-theme-name">
          {themeLabel(theme)}
        </Meta>
      </div>
      <SidebarToggle collapsed={false} onToggle={onToggle} />
    </div>
  );
}

/** One icon on the collapsed rail: named on hover, and the current screen's tinted as its entry is. */
function RailItem({
  label,
  active = false,
  onClick,
  testId,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={`relative flex size-8 items-center justify-center ${active ? "bg-accent text-accent-foreground" : "hover:bg-foreground/6"}`}
    >
      {children}
    </button>
  );
}

/** The collapsed sidebar: the toggle, then the entries as icons. */
function SidebarRail({
  route,
  onToggle,
  onJump,
  inboxCount,
  waiting,
}: {
  route: Route;
  onToggle: () => void;
  onJump: () => void;
  inboxCount: number | string;
  waiting: boolean;
}) {
  return (
    <div className="flex w-12 flex-col items-center gap-1 py-3" data-testid="sidebar-rail">
      <SidebarToggle collapsed onToggle={onToggle} />
      <div className="mt-2 flex flex-col items-center gap-1">
        <RailItem label="Shift Coordinator" active={route.level === "cos"} onClick={() => navigate({ level: "cos" })} testId="rail-cos">
          <span className="flex size-[18px] items-center justify-center border border-primary bg-primary font-mono text-[7.5px] font-semibold text-primary-foreground" aria-hidden>
            SC
          </span>
        </RailItem>
        <RailItem label="Inbox" active={route.level === "inbox"} onClick={() => navigate({ level: "inbox", suspensionId: null })} testId="rail-inbox">
          <NavIcon name="inbox" />
          {waiting ? (
            <span className="absolute -top-0.5 -right-0.5 bg-attention px-[3px] font-mono text-[9px] font-semibold leading-tight text-attention-foreground tabular-nums" data-testid="rail-inbox-count">
              {inboxCount}
            </span>
          ) : null}
        </RailItem>
        <RailItem label="Tasks" active={route.level === "tasks" || route.level === "task"} onClick={() => navigate({ level: "tasks", by: "state" })} testId="rail-tasks">
          <NavIcon name="tasks" />
        </RailItem>
        <RailItem label="Roster" active={route.level === "roster"} onClick={() => navigate({ level: "roster", team: null })} testId="rail-roster">
          <NavIcon name="roster" />
        </RailItem>
        <RailItem label="Jump to (⌘K)" onClick={onJump} testId="rail-jump">
          <NavIcon name="jump" />
        </RailItem>
      </div>
    </div>
  );
}

/**
 * PROJECTS (BR-22): each project by title, its workstreams beneath it, a
 * project with none still listed; then No project with every workstream no
 * project lists, only when there is one. A workstream id whose mailbox left
 * the tree is shown as gone, with no link.
 */
function ProjectsSection({
  snapshot,
  route,
  marks,
  onRetry,
}: {
  snapshot: LoadedSnapshot;
  route: Route;
  /** Each workstream's square, by workstream id. */
  marks: ReadonlyMap<string, "needs" | "run" | null>;
  onRetry: () => void;
}) {
  const view = projectsOf(snapshot);
  if (!view.ok) {
    const what = snapshot.inventory.ok ? "Projects" : "Workstreams";
    return <SectionFailure what={what} failure={view.failure} onRetry={onRetry} testId="projects-failure" />;
  }
  const workstreamItem = (w: Workstream) => (
    <StreamItem key={w.id} id={w.id} state={marks.get(w.id) ?? null} active={route.level === "workstream" && route.mailboxId === w.id} />
  );
  const projectItem = (projectId: string, label: string) => (
    <NavItem
      label={label}
      active={route.level === "project" && route.projectId === projectId}
      onClick={() => navigate({ level: "project", projectId, tab: "stream" })}
      testId={`nav-project-${projectId}`}
    />
  );
  return (
    <>
      {view.value.projects.map(({ project, workstreams }) => (
        <div key={project.id} data-testid="project-group" data-project-id={project.id}>
          {projectItem(project.id, project.title)}
          <div className="pl-3">
            {workstreams.map(({ id, workstream }) =>
              workstream === undefined ? (
                <p key={id} className="px-2 py-1 text-xs text-muted-foreground" data-testid="nav-workstream-gone" data-mailbox-id={id}>
                  {id} · no longer in the Lab
                </p>
              ) : (
                workstreamItem(workstream)
              ),
            )}
          </div>
        </div>
      ))}
      {view.value.noProject.length === 0 ? null : (
        <div data-testid="project-group" data-project-id={NO_PROJECT}>
          {projectItem(NO_PROJECT, "No project")}
          <div className="pl-3">{view.value.noProject.map(workstreamItem)}</div>
        </div>
      )}
    </>
  );
}

/**
 * @param collapsed Draw the rail instead of the full nav.
 * @param onToggle Collapse or expand it.
 */
export function Sidebar({
  route,
  gaps,
  onJump,
  look,
  collapsed,
  onToggle,
}: {
  route: Route;
  gaps: Gaps;
  onJump: () => void;
  look?: ThemeLook;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { snapshot, refresh, clients } = useLab();
  const loaded = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? (snapshot as LoadedSnapshot) : undefined;
  const retry = () => void refresh();

  const inboxCount = loaded === undefined ? "…" : loaded.asks.ok ? loaded.asks.value.length : "!";
  const tasksCount = loaded === undefined ? "…" : openRows(loaded).length;
  const waiting = loaded !== undefined && loaded.asks.ok && loaded.asks.value.length > 0;
  // Each workstream's dot (v2:1183-1184): needs-you first, then running.
  const streams = loaded === undefined ? undefined : streamCounts(loaded);
  const dots = new Map(streams?.ok === true ? streams.value.map((stream) => [stream.workstream.id, streamMark(stream)]) : []);
  const states = loaded === undefined || !loaded.inventory.ok ? undefined : seatStates(loaded);
  const counts = states === undefined ? undefined : shiftCounts(states);
  const partial = states?.partial === true ? <PartialMark title={gaps.roster.partial} /> : null;

  return (
    <nav
      aria-label="Shift Manager"
      className={`h-full shrink-0 overflow-hidden border-r bg-sidebar transition-[width] duration-[180ms] ease-out motion-reduce:transition-none ${collapsed ? "w-12" : "w-[248px]"}`}
      data-testid="sidebar"
      data-collapsed={collapsed}
    >
      {collapsed ? (
        <SidebarRail route={route} onToggle={onToggle} onJump={onJump} inboxCount={inboxCount} waiting={waiting} />
      ) : (
        // Held at its full width inside the border, so the width's change clips the nav rather than reflowing it.
        <div className="flex h-full w-[247px] flex-col">
          {look === undefined ? (
            <div className="flex justify-end px-3.5 pt-3">
              <SidebarToggle collapsed={false} onToggle={onToggle} />
            </div>
          ) : (
            <SidebarHeader look={look} onToggle={onToggle} />
          )}
          <div className="flex-1 overflow-y-auto p-3">
            {loaded === undefined ? null : <OrgSwitcher orgId={loaded.orgId} onSwitch={retry} />}
            <button
              type="button"
              onClick={onJump}
              data-testid="jump-to"
              className="mt-2 flex w-full items-center justify-between border bg-secondary px-2 py-1.5 text-muted-foreground"
            >
              <Meta role="control">Jump to…</Meta>
              <kbd className="border px-1">
                <Meta role="count">⌘K</Meta>
              </kbd>
            </button>

            <div className="mt-3 space-y-0.5">
              <ChiefOfStaffEntry active={route.level === "cos"} />
              <NavItem
                label="Inbox"
                icon={<NavIcon name="inbox" />}
                mark={
                  // v2's badge (v2:60): the highlighter only while an ask waits on the person.
                  <span
                    className={`px-[5px] font-mono text-[10.5px] font-semibold tabular-nums ${waiting ? "bg-attention text-attention-foreground" : "text-muted-foreground"}`}
                    data-look="meta-count"
                    data-testid="nav-inbox-count"
                    data-waiting={waiting}
                  >
                    {inboxCount}
                  </span>
                }
                active={route.level === "inbox"}
                onClick={() => navigate({ level: "inbox", suspensionId: null })}
                testId="nav-inbox"
              />
              <NavItem
                label="Tasks"
                icon={<NavIcon name="tasks" />}
                mark={
                  <Meta role="count" className="ml-2 tabular-nums text-info" testId="nav-tasks-count">
                    {tasksCount}
                  </Meta>
                }
                active={route.level === "tasks" || route.level === "task"}
                onClick={() => navigate({ level: "tasks", by: "state" })}
                testId="nav-tasks"
              />
              <NavItem
                label="Roster"
                icon={<NavIcon name="roster" />}
                count={counts === undefined ? undefined : `${counts["on shift"]}·${counts["on call"]}`}
                mark={partial}
                active={route.level === "roster" && route.team === null}
                onClick={() => navigate({ level: "roster", team: null })}
                testId="nav-roster"
              />
            </div>

            <Heading testId="projects-heading" onClick={() => navigate({ level: "project", projectId: NO_PROJECT, tab: "stream" })}>
              PROJECTS
            </Heading>
            <div data-testid="projects">
              {loaded === undefined ? null : <ProjectsSection snapshot={loaded} route={route} marks={dots} onRetry={retry} />}
            </div>

            <Heading testId="teams-heading" aside="on shift">
              TEAMS
            </Heading>
            <div data-testid="teams">
              {loaded === undefined ? null : loaded.inventory.ok ? (
                teamsOf(loaded.inventory.value.seats).map(({ team, seats }) => (
                  <button
                    key={team}
                    type="button"
                    aria-current={route.level === "roster" && route.team === team ? "page" : undefined}
                    onClick={() => navigate({ level: "roster", team })}
                    data-testid="team"
                    data-team={team}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] ${
                      route.level === "roster" && route.team === team ? "bg-accent text-accent-foreground" : "hover:bg-foreground/6"
                    }`}
                  >
                    <span className="flex-1 truncate">{team}</span>
                    <span className="flex gap-0.5">
                      {seats.map((seat) => {
                        const status = states?.seats.get(seat.id)?.status ?? "off shift";
                        return (
                          <span key={seat.id} title={`${seat.name} · ${status}`} data-testid="worker" data-seat-id={seat.id} data-status={status}>
                            <ShiftMark status={status} className="block size-2" />
                          </span>
                        );
                      })}
                    </span>
                    <Meta role="count" className="w-8 text-right tabular-nums text-muted-foreground" testId="team-on-shift">
                      {states === undefined ? 0 : shiftCounts(states, team)["on shift"]}/{seats.length}
                    </Meta>
                  </button>
                ))
              ) : (
                <SectionFailure what="Teams" failure={loaded.inventory.failure} onRetry={retry} testId="teams-failure" />
              )}
            </div>
          </div>
          <footer
            className="flex flex-col gap-[9px] border-t border-foreground/20 px-3 pt-2.5 pb-3 font-mono text-[11px] font-medium text-muted-foreground"
            data-testid="sidebar-footer"
            data-look="meta-meta"
          >
            <p className="flex items-center gap-3">
              {counts === undefined ? null : (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <ShiftMark status="on shift" />
                    <span data-testid="footer-on-shift">{counts["on shift"]} on shift</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShiftMark status="on call" />
                    <span data-testid="footer-on-call">{counts["on call"]} on call</span>
                  </span>
                  {partial}
                </>
              )}
              <span
                className="ml-auto flex size-[22px] shrink-0 items-center justify-center border border-foreground text-[10px] text-foreground"
                title={clients.userId}
                aria-label={`Signed in as ${clients.userId}`}
                data-testid="footer-user"
                data-look="avatar"
              >
                {initialsOf(clients.userId)}
              </span>
            </p>
          </footer>
        </div>
      )}
    </nav>
  );
}
