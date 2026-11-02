/**
 * The sidebar (S5): in order, Shift Coordinator, Inbox, Tasks and Roster with
 * their counts, Messages, PROJECTS, TEAMS, then Settings pinned above a footer
 * (BR-6) with the ⌘K tip and the on-shift count. A header above them all carries
 * the mark, which changes the theme with a click, and names the theme.
 *
 * Every entry is drawn from the one snapshot, so a count and the screen it
 * opens always agree; every status and status count from its one
 * `workerStates` result, so they agree with Roster. PROJECTS lists each project,
 * its workstreams beneath it while it is open, read as its view reads them;
 * TEAMS is one row per
 * team with a status square per worker, the user's own workers included,
 * opening Roster for that team. A failed
 * read shows its section's Retry and nothing else changes (BR-11).
 *
 * Drawn in design v2's frame: 248px wide on v2's sidebar surface, darker than
 * the page; square; labels, counts and the footer in mono (v2:26-113). Shift
 * Coordinator is v2's bordered entry; Inbox, Tasks and Roster carry v2's icons;
 * Inbox's count wears the highlighter only while an ask waits, and Tasks' is
 * blue; the current row is v2's blue tint at 700; each workstream has its `#`;
 * TEAMS says what its counts are; and the
 * footer ends its counts with the user's initials (v2:52-113, 1173-1188).
 *
 * Collapsed, it is a 48px rail: the toggle that expands it, then an icon each
 * for Shift Coordinator, Inbox (with its count while an ask waits), Tasks,
 * Roster, Messages and Jump to, with Settings at the bottom. Each icon names itself on hover and navigates as its
 * entry does.
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { themeLabel, type ThemeLook } from "../lib/theme";
import type { Route } from "../lib/routes";
import { useLab } from "../lib/lab-data";
import { useRoster, withRoster } from "../lib/roster";
import { openRows, projectsOf, workerLabel, workerStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../lib/derive";
import { projectReaderOf, useProjectRead, type WorkstreamEntry } from "../lib/projects";
import type { Project } from "../lib/reads";
import { initialsOf } from "../lib/shell";
import { useShiftCoordinatorWorking } from "../lib/working";
import { Meta, PartialMark, SectionFailure, ShiftMark } from "../components/ui";
import { ShiftManagerMark } from "../components/ShiftManagerMark";
import { RouteLink } from "../components/RouteLink";
import type { Gaps } from "../gaps";

function NavItem({
  label,
  icon,
  count,
  mark,
  active,
  to,
  testId,
}: {
  label: string;
  /** v2's 14px line icon, drawn before the label (v2:58, 63, 68). */
  icon?: ReactNode;
  count?: number | string;
  /** Drawn after the count. */
  mark?: ReactNode;
  active: boolean;
  to: Route;
  testId: string;
}) {
  return (
    <RouteLink
      to={to}
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
    </RouteLink>
  );
}

/** v2's 14px line icons for Inbox, Tasks and Roster (v2:58, 63, 68), stroked in the text's colour. */
const ICON_PATHS = {
  /** The toggle: a panel with its left column marked. */
  panel: "M1.5 1.5h11v11h-11z M5 1.5v11",
  jump: "M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M9.3 9.3l3.2 3.2",
  inbox: "M1.5 1.5h11v11h-11z M1.5 8.5h3.2l1 1.8h2.6l1-1.8h3.2",
  tasks: "M1.5 3h2 M5.5 3h7 M1.5 7h2 M5.5 7h7 M1.5 11h2 M5.5 11h7",
  messages: "M1.5 2.5h11v7h-6l-3 2.5v-2.5h-2z",
  /** Scheduled work: a clock face. */
  schedules: "M7 1.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M7 4v3l2 1.5",
  /** Usage: a gauge. */
  usage: "M1.5 10.5a5.5 5.5 0 0 1 11 0 M7 10.5l2.5-3",
  roster: "M1.5 1.5h4.5v4.5h-4.5z M8 1.5h4.5v4.5h-4.5z M1.5 8h4.5v4.5h-4.5z M8 8h4.5v4.5h-4.5z",
  /** Settings: a key. */
  settings: "M4.5 4.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M7.5 7.5h5 M10.5 7.5v2 M12.5 7.5v1.5",
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
function ShiftCoordinatorEntry({ active }: { active: boolean }) {
  const working = useShiftCoordinatorWorking();
  return (
    <RouteLink
      to={{ level: "shift-coordinator" }}
      aria-current={active ? "page" : undefined}
      data-testid="nav-shift-coordinator"
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
    </RouteLink>
  );
}

function Heading({ children, aside, testId }: { children: string; aside?: string; testId: string }) {
  return (
    <p className="flex justify-between px-1.5 pt-4 pb-1.5 text-muted-foreground" data-testid={testId}>
      <Meta role="label">{children}</Meta>
      {aside === undefined ? null : <Meta role="label">{aside}</Meta>}
    </p>
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

/** One icon on the collapsed rail: named on hover, and the current screen's tinted as its entry is. A link to its entry's address, or, for Jump to, a button. */
function RailItem({
  label,
  active = false,
  testId,
  children,
  ...action
}: {
  label: string;
  active?: boolean;
  testId: string;
  children: ReactNode;
} & ({ to: Route } | { onClick: () => void })) {
  const props = {
    title: label,
    "aria-label": label,
    "aria-current": active ? ("page" as const) : undefined,
    "data-testid": testId,
    className: `relative flex size-8 items-center justify-center ${active ? "bg-accent text-accent-foreground" : "hover:bg-foreground/6"}`,
    children,
  };
  return "to" in action ? <RouteLink to={action.to} {...props} /> : <button type="button" onClick={action.onClick} {...props} />;
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
    <div className="flex h-full w-12 flex-col items-center gap-1 py-3" data-testid="sidebar-rail">
      <SidebarToggle collapsed onToggle={onToggle} />
      <div className="mt-2 flex flex-col items-center gap-1">
        <RailItem label="Shift Coordinator" active={route.level === "shift-coordinator"} to={{ level: "shift-coordinator" }} testId="rail-shift-coordinator">
          <span className="flex size-[18px] items-center justify-center border border-primary bg-primary font-mono text-[7.5px] font-semibold text-primary-foreground" aria-hidden>
            SC
          </span>
        </RailItem>
        <RailItem label="Inbox" active={route.level === "inbox"} to={{ level: "inbox", item: null }} testId="rail-inbox">
          <NavIcon name="inbox" />
          {waiting ? (
            <span className="absolute -top-0.5 -right-0.5 bg-attention px-[3px] font-mono text-[9px] font-semibold leading-tight text-attention-foreground tabular-nums" data-testid="rail-inbox-count">
              {inboxCount}
            </span>
          ) : null}
        </RailItem>
        <RailItem label="Tasks" active={route.level === "tasks" || route.level === "task"} to={{ level: "tasks", by: "state" }} testId="rail-tasks">
          <NavIcon name="tasks" />
        </RailItem>
        <RailItem label="Roster" active={route.level === "roster" || route.level === "worker-settings"} to={{ level: "roster", team: null }} testId="rail-roster">
          <NavIcon name="roster" />
        </RailItem>
        <RailItem label="Messages" active={route.level === "messages" || route.level === "session"} to={{ level: "messages" }} testId="rail-messages">
          <NavIcon name="messages" />
        </RailItem>
        <RailItem label="Scheduled work" active={route.level === "schedules"} to={{ level: "schedules" }} testId="rail-schedules">
          <NavIcon name="schedules" />
        </RailItem>
        <RailItem label="Usage" active={route.level === "usage"} to={{ level: "usage" }} testId="rail-usage">
          <NavIcon name="usage" />
        </RailItem>
        <RailItem label="Jump to (⌘K)" onClick={onJump} testId="rail-jump">
          <NavIcon name="jump" />
        </RailItem>
      </div>
      <div className="mt-auto">
        <RailItem label="Settings" active={route.level === "settings"} to={{ level: "settings" }} testId="rail-settings">
          <NavIcon name="settings" />
        </RailItem>
      </div>
    </div>
  );
}

/**
 * One project under PROJECTS, its workstreams beneath it while it is open. A
 * project opens with its toggle, and is open while it is the current screen.
 * Only an open project's entries are read, by its one prefix, as its view
 * reads them (BR-18); a closed one costs nothing.
 */
function ProjectGroup({
  project,
  route,
  reader,
  readAt,
}: {
  project: Project;
  route: Route;
  reader: string | null;
  readAt: number;
}) {
  // `null` follows the route; a toggle overrides it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const { id, title, visibility } = project;
  // A project's address is its visibility and its id: a private project and a shared one can share an id.
  const here = route.level === "project" && route.projectId === id && (route.visibility ?? "shared") === visibility;
  const open = toggled ?? here;
  const { read, reread } = useProjectRead({ visibility, id }, open ? reader : null, readAt);
  const testId = visibility === "private" ? `nav-project-private-${id}` : `nav-project-${id}`;
  const entries = read !== undefined && "value" in read && read.value !== null ? read.value.entries : undefined;
  const to = (entry?: { owner: string; id: string }): Route => ({
    level: "project",
    projectId: id,
    tab: entry === undefined ? "stream" : "workstreams",
    ...(visibility === "private" ? { visibility } : {}),
    ...(entry === undefined ? {} : { entry }),
  });
  return (
    <div data-testid="project-group" data-project-id={id} data-visibility={visibility} data-open={open}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setToggled(!open)}
          aria-expanded={open}
          aria-label={open ? `Hide ${title}'s workstreams` : `Show ${title}'s workstreams`}
          data-testid={`${testId}-toggle`}
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <Meta className={`inline-flex size-3 items-center justify-center text-[11px] transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>▸</Meta>
        </button>
        <div className="min-w-0 flex-1">
          <NavItem
            label={visibility === "private" ? `${title} · private` : title}
            active={here && route.entry === undefined}
            to={to()}
            testId={testId}
          />
        </div>
      </div>
      {!open ? null : (
        <div className="pl-6" data-testid="nav-project-workstreams">
          {read !== undefined && "failure" in read ? (
            <p className="px-1.5 py-[5px] text-xs text-muted-foreground" data-testid="nav-workstreams-failure">
              Workstreams didn't load.{" "}
              <button type="button" className="underline" onClick={reread}>
                Retry
              </button>
            </p>
          ) : entries === undefined ? null : entries.length === 0 ? (
            <p className="px-1.5 py-[5px] text-xs text-muted-foreground" data-testid="nav-workstreams-none">
              No workstreams
            </p>
          ) : (
            entries.map((entry) => (
              <StreamItem
                key={`${entry.owner}/${entry.id}`}
                entry={entry}
                active={here && route.entry?.owner === entry.owner && route.entry.id === entry.id}
                to={to({ owner: entry.owner, id: entry.id })}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** A workstream under its project (v2:88): a mono `#` and its title, opening on its own view. */
function StreamItem({ entry, active, to }: { entry: WorkstreamEntry; active: boolean; to: Route }) {
  return (
    <RouteLink
      to={to}
      aria-current={active ? "page" : undefined}
      title={`${entry.title} · ${entry.owner} · ${entry.status}`}
      data-testid="nav-workstream"
      data-owner={entry.owner}
      data-workstream-id={entry.id}
      className={`flex w-full items-center gap-[7px] px-1.5 py-[5px] text-left text-[13px] ${
        active ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-foreground/6"
      }`}
    >
      <Meta className="text-[11.5px] text-muted-foreground">#</Meta>
      <span className="min-w-0 flex-1 truncate" data-look="nav-label">
        {entry.title}
      </span>
    </RouteLink>
  );
}

/** PROJECTS (BR-22): each project by title, with its workstreams beneath it while it is open. */
function ProjectsSection({ snapshot, route, onRetry }: { snapshot: LoadedSnapshot; route: Route; onRetry: () => void }) {
  const view = projectsOf(snapshot);
  if (!view.ok) {
    return <SectionFailure what="Projects" failure={view.failure} onRetry={onRetry} testId="projects-failure" />;
  }
  const reader = projectReaderOf(snapshot.sessions);
  return (
    <>
      {view.value.projects.map((project) => (
        <ProjectGroup key={`${project.visibility}/${project.id}`} project={project} route={route} reader={reader} readAt={snapshot.readAt} />
      ))}
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
  const { snapshot, refresh, client } = useLab();
  const loaded = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? (snapshot as LoadedSnapshot) : undefined;
  const retry = () => void refresh();

  const inboxCount = loaded === undefined ? "…" : loaded.inbox.ok ? loaded.inbox.value.length : "!";
  const tasksCount = loaded === undefined ? "…" : openRows(loaded).length;
  const waiting = loaded !== undefined && loaded.inbox.ok && loaded.inbox.value.length > 0;
  // The user's own workers are on their roster, not in the inventory: joined as Roster joins them.
  const roster = useRoster(loaded?.readAt);
  const joined = loaded === undefined ? undefined : withRoster(loaded, roster);
  // With the inventory unread and nobody on the roster, TEAMS has only its failure to show.
  const drawn = joined !== undefined && (loaded?.inventory.ok === true || joined.workers.length > 0) ? joined : undefined;
  const states = drawn === undefined ? undefined : workerStates(drawn.snapshot);
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
            <div className="space-y-0.5">
              <ShiftCoordinatorEntry active={route.level === "shift-coordinator"} />
              <NavItem
                label="Inbox"
                icon={<NavIcon name="inbox" />}
                mark={
                  // v2's badge (v2:60): the highlighter only while an ask waits on the user.
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
                to={{ level: "inbox", item: null }}
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
                to={{ level: "tasks", by: "state" }}
                testId="nav-tasks"
              />
              <NavItem
                label="Roster"
                icon={<NavIcon name="roster" />}
                count={counts?.["on shift"]}
                mark={partial}
                active={(route.level === "roster" && route.team === null) || route.level === "worker-settings"}
                to={{ level: "roster", team: null }}
                testId="nav-roster"
              />
              <NavItem
                label="Messages"
                icon={<NavIcon name="messages" />}
                active={route.level === "messages" || route.level === "session"}
                to={{ level: "messages" }}
                testId="nav-messages"
              />
              <NavItem
                label="Scheduled work"
                icon={<NavIcon name="schedules" />}
                active={route.level === "schedules"}
                to={{ level: "schedules" }}
                testId="nav-schedules"
              />
              <NavItem
                label="Usage"
                icon={<NavIcon name="usage" />}
                active={route.level === "usage"}
                to={{ level: "usage" }}
                testId="nav-usage"
              />
            </div>

            <Heading testId="projects-heading">PROJECTS</Heading>
            <div data-testid="projects">
              {loaded === undefined ? null : <ProjectsSection snapshot={loaded} route={route} onRetry={retry} />}
            </div>

            <Heading testId="teams-heading" aside="on shift">
              TEAMS
            </Heading>
            <div data-testid="teams">
              {drawn === undefined ? null : (
                teamsOf(drawn.workers).map(({ team, name, workers }) => (
                  <RouteLink
                    key={team}
                    to={{ level: "roster", team }}
                    aria-current={route.level === "roster" && route.team === team ? "page" : undefined}
                    data-testid="team"
                    data-team={team}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[13px] ${
                      route.level === "roster" && route.team === team ? "bg-accent text-accent-foreground" : "hover:bg-foreground/6"
                    }`}
                  >
                    <span className="flex-1 truncate">{name}</span>
                    <span className="flex gap-0.5">
                      {workers.map((worker) => {
                        const status = states?.workers.get(worker.id)?.status ?? "off shift";
                        return (
                          <span key={worker.id} title={`${workerLabel(worker.displayName)} · ${status}`} data-testid="worker" data-worker-id={worker.id} data-status={status}>
                            <ShiftMark status={status} className="block size-2" />
                          </span>
                        );
                      })}
                    </span>
                    <Meta role="count" className="w-8 text-right tabular-nums text-muted-foreground" testId="team-on-shift">
                      {states === undefined ? 0 : shiftCounts(states, team)["on shift"]}/{workers.length}
                    </Meta>
                  </RouteLink>
                ))
              )}
              {loaded === undefined || loaded.inventory.ok ? null : (
                <SectionFailure what="Teams" failure={loaded.inventory.failure} onRetry={retry} testId="teams-failure" />
              )}
              {roster !== undefined && "failure" in roster ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground" data-testid="teams-own-failure">
                  Your own workers didn't load: {roster.failure.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="px-3 pb-2">
            <NavItem
              label="Settings"
              icon={<NavIcon name="settings" />}
              active={route.level === "settings"}
              to={{ level: "settings" }}
              testId="nav-settings"
            />
          </div>
          <footer
            className="flex flex-col gap-[9px] border-t border-foreground/20 px-3 pt-2.5 pb-3 font-mono text-[11px] font-medium text-muted-foreground"
            data-testid="sidebar-footer"
            data-look="meta-meta"
          >
            <p className="text-[10.5px]" data-testid="jump-tip">
              <kbd>⌘K</kbd> to go to anything
            </p>
            <p className="flex items-center gap-3">
              {counts === undefined ? null : (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <ShiftMark status="on shift" />
                    <span data-testid="footer-on-shift">{counts["on shift"]} on shift</span>
                  </span>
                  {partial}
                </>
              )}
              <span
                className="ml-auto flex size-[22px] shrink-0 items-center justify-center border border-foreground text-[10px] text-foreground"
                title={client.userId}
                aria-label={`Signed in as ${client.userId}`}
                data-testid="footer-user"
                data-look="avatar"
              >
                {initialsOf(client.userId)}
              </span>
            </p>
          </footer>
        </div>
      )}
    </nav>
  );
}
