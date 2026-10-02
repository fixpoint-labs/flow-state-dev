/**
 * The sidebar (S5): in order, the organization, Jump to, Chief of Staff,
 * Inbox, Tasks and Roster with their counts, PROJECTS, TEAMS, and a footer
 * (BR-6) with the on-shift and on-call counts that ends in the Day shift /
 * Night shift switch.
 *
 * Every entry is drawn from the one snapshot, so a count and the screen it
 * opens always agree; every status and status count from its one
 * `seatStates` result, so they agree with Roster. PROJECTS lists the
 * workstreams directly while no projects ship (BR-9); TEAMS is one row per
 * team with a status square per seat, opening Roster for that team. A failed
 * read shows its section's Retry and nothing else changes (BR-11).
 *
 * Drawn in design v2's frame: 248px wide on v2's sidebar surface, darker than
 * the page; square; labels, counts and the footer in mono (v2:26-113).
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { ColorScheme, ShiftLook } from "../lib/color-scheme";
import { navigate, NO_PROJECT, type Route } from "../lib/routes";
import { useLab } from "../lib/lab-data";
import { openRows, seatStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../lib/derive";
import { Meta, PartialMark, SectionFailure, ShiftMark } from "../components/ui";
import type { Gaps } from "../gaps";

function NavItem({
  label,
  count,
  mark,
  active,
  onClick,
  testId,
}: {
  label: string;
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
      className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[13.5px] ${
        active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60"
      }`}
    >
      <span className="truncate">{label}</span>
      {count === undefined ? null : (
        <Meta role="count" className="ml-2 tabular-nums text-muted-foreground" testId={`${testId}-count`}>
          {count}
        </Meta>
      )}
      {mark}
    </button>
  );
}

function Heading({ children, onClick, testId }: { children: string; onClick?: () => void; testId: string }) {
  const className = "block px-2 pt-4 pb-1.5 text-muted-foreground";
  const label = <Meta role="label">{children}</Meta>;
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

const SHIFTS: Array<{ scheme: ColorScheme; label: string }> = [
  { scheme: "light", label: "Day shift" },
  { scheme: "dark", label: "Night shift" },
];

/** Day shift / Night shift: shows the look the page is in, and a click switches it. */
function ShiftSwitch({ look }: { look: ShiftLook }) {
  const current = useSyncExternalStore(look.subscribe, look.current);
  return (
    <div role="group" aria-label="Shift" className="mt-2 grid grid-cols-2 border border-foreground font-mono text-[11px]" data-testid="shift-switch">
      {SHIFTS.map(({ scheme, label }, i) => (
        <button
          key={scheme}
          type="button"
          aria-pressed={current === scheme}
          onClick={() => look.choose(scheme)}
          data-testid={`shift-${scheme === "light" ? "day" : "night"}`}
          className={`py-1 text-center ${i > 0 ? "border-l border-foreground" : ""} ${
            current === scheme ? "bg-foreground text-background" : "text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Sidebar({ route, gaps, onJump, look }: { route: Route; gaps: Gaps; onJump: () => void; look?: ShiftLook }) {
  const { snapshot, refresh, clients } = useLab();
  const loaded = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? (snapshot as LoadedSnapshot) : undefined;
  const retry = () => void refresh();

  const inboxCount = loaded === undefined ? "…" : loaded.asks.ok ? loaded.asks.value.length : "!";
  const tasksCount = loaded === undefined ? "…" : openRows(loaded).length;
  const liveSessions = loaded === undefined ? null : loaded.sessions.length;
  const states = loaded === undefined || !loaded.inventory.ok ? undefined : seatStates(loaded);
  const counts = states === undefined ? undefined : shiftCounts(states);
  const partial = states?.partial === true ? <PartialMark title={gaps.roster.partial} /> : null;

  return (
    <nav aria-label="Shift Manager" className="flex h-full w-[248px] shrink-0 flex-col border-r bg-sidebar" data-testid="sidebar">
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
          <NavItem
            label="Chief of Staff"
            active={route.level === "cos"}
            onClick={() => navigate({ level: "cos" })}
            testId="nav-cos"
          />
          <NavItem
            label="Inbox"
            count={inboxCount}
            active={route.level === "inbox"}
            onClick={() => navigate({ level: "inbox", suspensionId: null })}
            testId="nav-inbox"
          />
          <NavItem
            label="Tasks"
            count={tasksCount}
            active={route.level === "tasks" || route.level === "task"}
            onClick={() => navigate({ level: "tasks", by: "state" })}
            testId="nav-tasks"
          />
          <NavItem
            label="Roster"
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
          {loaded === undefined ? null : loaded.inventory.ok ? (
            <>
              <p className="px-2 pb-1 text-xs text-muted-foreground">{gaps.projectWorkstreams.title}; workstreams:</p>
              {loaded.inventory.value.workstreams.map((w) => (
                <NavItem
                  key={w.id}
                  label={w.id}
                  active={route.level === "workstream" && route.channelId === w.id}
                  onClick={() => navigate({ level: "workstream", channelId: w.id, tab: "stream" })}
                  testId={`nav-workstream-${w.id}`}
                />
              ))}
            </>
          ) : (
            <SectionFailure what="Workstreams" failure={loaded.inventory.failure} onRetry={retry} testId="projects-failure" />
          )}
        </div>

        <Heading testId="teams-heading">TEAMS</Heading>
        <div data-testid="teams">
          {loaded?.inventory.ok && loaded.inventory.value.rosterUnread !== undefined ? (
            <p className="px-2 py-1 text-xs text-muted-foreground" data-testid="teams-roster-unread">
              {loaded.inventory.value.rosterUnread}
            </p>
          ) : null}
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
                  route.level === "roster" && route.team === team ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60"
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
      <footer className="border-t px-3 pt-2.5 pb-3 font-mono text-[11px] font-medium text-muted-foreground" data-testid="sidebar-footer" data-look="meta-meta">
        {counts === undefined ? null : (
          <p className="mb-1 flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <ShiftMark status="on shift" />
              <span data-testid="footer-on-shift">{counts["on shift"]} on shift</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShiftMark status="on call" />
              <span data-testid="footer-on-call">{counts["on call"]} on call</span>
            </span>
            {partial}
          </p>
        )}
        <span data-testid="sessions-live">{liveSessions === null ? "sessions unknown" : `${liveSessions} sessions`}</span>
        {" · "}
        <span data-testid="current-user">{clients.userId}</span>
        {look === undefined ? null : <ShiftSwitch look={look} />}
      </footer>
    </nav>
  );
}
