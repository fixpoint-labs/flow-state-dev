/**
 * The sidebar (S5): in order, the organization, Jump to, Chief of Staff,
 * Inbox and Tasks with their counts, PROJECTS, TEAMS, and a footer (BR-6) that ends in the Day
 * shift / Night shift switch.
 *
 * Every entry is drawn from the one snapshot, so a count and the screen it
 * opens always agree. PROJECTS lists the workstreams directly while no
 * projects ship (BR-9); TEAMS lists each team in the seat inventory with
 * exactly its seats (BR-7). A failed read shows its section's Retry and
 * nothing else changes (BR-11).
 */
import { useState, useSyncExternalStore } from "react";
import type { ColorScheme, ShiftLook } from "../lib/color-scheme";
import { navigate, NO_PROJECT, type Route } from "../lib/routes";
import { useLab } from "../lib/lab-data";
import { allRows, openRows, rosterOf, teamsOf, workerStatus, type LoadedSnapshot } from "../lib/derive";
import { SectionFailure, StatusWord } from "../components/ui";
import type { Gaps } from "../gaps";

function NavItem({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string;
  count?: number | string;
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
      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
        active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60"
      }`}
    >
      <span className="truncate">{label}</span>
      {count === undefined ? null : (
        <span className="ml-2 text-xs tabular-nums text-muted-foreground" data-testid={`${testId}-count`}>
          {count}
        </span>
      )}
    </button>
  );
}

function Heading({ children, onClick, testId }: { children: string; onClick?: () => void; testId: string }) {
  const className = "px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground";
  return onClick === undefined ? (
    <p className={className} data-testid={testId}>
      {children}
    </p>
  ) : (
    <button type="button" className={`${className} w-full text-left hover:text-foreground`} onClick={onClick} data-testid={testId}>
      {children}
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
        className="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm"
      >
        <span className="truncate font-medium">{orgId}</span>
        <span className="text-xs text-muted-foreground">▾</span>
      </button>
      {open ? (
        <div role="menu" className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow">
          <button
            type="button"
            role="menuitemradio"
            aria-checked
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
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

  return (
    <nav aria-label="Shift Manager" className="flex h-full w-64 shrink-0 flex-col border-r bg-card" data-testid="sidebar">
      <div className="flex-1 overflow-y-auto p-3">
        {loaded === undefined ? null : <OrgSwitcher orgId={loaded.orgId} onSwitch={retry} />}
        <button
          type="button"
          onClick={onJump}
          data-testid="jump-to"
          className="mt-2 flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-sm text-muted-foreground"
        >
          <span>Jump to…</span>
          <kbd className="text-xs">⌘K</kbd>
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
          {loaded === undefined ? null : loaded.inventory.ok ? (
            teamsOf(loaded.inventory.value.seats).map(({ team, seats }) => (
              <div key={team} className="mb-2" data-testid="team" data-team={team}>
                <p className="px-2 py-1 text-sm font-medium">{team}</p>
                <ul>
                  {seats.map((seat) => (
                    <li key={seat.id} className="px-2 py-1" data-testid="worker" data-seat-id={seat.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 text-left text-sm hover:underline"
                        onClick={() => navigate({ level: "tasks", by: "worker" })}
                      >
                        <span className="truncate">{seat.name}</span>
                        <StatusWord status={workerStatus(seat, allRows(loaded), rosterOf(loaded))} />
                      </button>
                      <p className="text-xs text-muted-foreground">
                        <span data-testid="worker-kind">{seat.kind ?? "unknown kind"}</span>
                        {" · "}
                        <span title={gaps.harness} data-testid="worker-harness">
                          —
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <SectionFailure what="Teams" failure={loaded.inventory.failure} onRetry={retry} testId="teams-failure" />
          )}
        </div>
      </div>
      <footer className="border-t px-3 py-2 text-xs text-muted-foreground" data-testid="sidebar-footer">
        <span data-testid="sessions-live">{liveSessions === null ? "sessions unknown" : `${liveSessions} sessions`}</span>
        {" · "}
        <span data-testid="current-user">{clients.userId}</span>
        {look === undefined ? null : <ShiftSwitch look={look} />}
      </footer>
    </nav>
  );
}
