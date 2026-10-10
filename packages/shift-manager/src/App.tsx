/**
 * Shift Manager's frame (S4): three columns, the sidebar, the centre at the level
 * and tab the URL names, and the right panel's slot for that level. The frame
 * holds v2's 900px minimum width; below that the page scrolls.
 *
 * The sidebar and the right panel each collapse on their own (`lib/panels.ts`),
 * from a control on the panel or with `[` and `]`, and the centre takes the
 * width they give up.
 *
 * A Lab that refuses the first read for want of a verified organization, or
 * that names no organization for the person, gets the refusal screen and
 * nothing else (BR-3): the sidebar, the tree and every other read wait behind
 * it.
 */
import { useEffect, useState } from "react";
import { GAPS, type Gaps } from "./gaps";
import type { ThemeLook } from "./lib/theme";
import type { LabClients } from "./lib/connection";
import type { LoadedSnapshot } from "./lib/derive";
import { LabProvider, useLab } from "./lib/lab-data";
import type { Failure } from "./lib/reads";
import { ResourceView } from "./surfaces/Resource";
import { useRoute, type Route } from "./lib/routes";
import { EmptyState } from "./components/ui";
import { ChiefOfStaffPanel, ChiefOfStaffView } from "./surfaces/ChiefOfStaff";
import { Inbox } from "./surfaces/Inbox";
import { JumpTo } from "./surfaces/JumpTo";
import { ProjectView } from "./surfaces/Project";
import { RosterView } from "./surfaces/Roster";
import { Sidebar } from "./surfaces/Sidebar";
import { TaskProvider } from "./lib/task";
import { TaskFrame } from "./surfaces/TaskFrame";
import { TaskInspector } from "./surfaces/TaskInspector";
import { Tasks } from "./surfaces/Tasks";
import { isTyping, usePanels } from "./lib/panels";
import { findWorkstream, WorkstreamPanel, WorkstreamView } from "./surfaces/Workstream";

/**
 * @param devtoolUrl The devtool a task's trace link opens: the one Shift Manager
 *   serves. Absent: the link is off and says how to turn it on.
 * @param look The page's theme, which the mark in the sidebar changes. Absent:
 *   the sidebar draws no mark.
 */
export function App({ clients, gaps = GAPS, devtoolUrl, look }: { clients: LabClients; gaps?: Gaps; devtoolUrl?: string; look?: ThemeLook }) {
  return (
    <LabProvider clients={clients}>
      <Shell gaps={gaps} devtoolUrl={devtoolUrl} look={look} />
    </LabProvider>
  );
}

/**
 * The screen a Lab gets when Shift Manager has no organization to open it under, and
 * the only one: the Lab refused the first read, or served nothing that names
 * the person's organization.
 */
function Refusal({ failure }: { failure: Failure }) {
  return (
    <main className="flex h-screen items-center justify-center p-6" data-testid="refusal">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">This Lab won't let Shift Manager in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failure.httpStatus === undefined
            ? "Shift Manager opens a Lab only under an organization, and this Lab doesn't say which one you're in. Shift Manager shows nothing from the Lab until it does."
            : "The Lab's server refused the first read because the request carried no verified organization. Shift Manager shows nothing from the Lab until it does. Check that the Lab's config hands Shift Manager a credential (its devtool block) and that Shift Manager is opened on the address its start script printed."}
        </p>
        <p className="mt-3 bg-muted px-3 py-2 font-mono text-xs" data-testid="refusal-message">
          {failure.httpStatus === undefined ? failure.message : `${failure.httpStatus} · ${failure.message}`}
        </p>
      </div>
    </main>
  );
}

/** The screen a first read that failed for another reason gets: what the Lab answered, and Retry. */
function Unreachable({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  return (
    <main className="flex h-screen items-center justify-center p-6" data-testid="unreachable">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">Shift Manager couldn't reach the Lab</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The first read failed before the Lab said who you are. Check that the Lab's server is running, then retry.
        </p>
        <p className="mt-3 bg-muted px-3 py-2 font-mono text-xs" data-testid="unreachable-message">
          {failure.httpStatus === undefined ? failure.message : `${failure.httpStatus} · ${failure.message}`}
        </p>
        <button type="button" onClick={onRetry} className="mt-3 border px-3 py-1.5 text-sm" data-testid="unreachable-retry">
          Retry
        </button>
      </div>
    </main>
  );
}

function Shell({ gaps, devtoolUrl, look }: { gaps: Gaps; devtoolUrl: string | undefined; look: ThemeLook | undefined }) {
  const { snapshot, refresh, clients } = useLab();
  const route = useRoute();
  const [jumping, setJumping] = useState(false);
  const panels = usePanels(clients.userId);
  const { toggleNav, togglePanel } = panels;
  const hasPanel = PANEL_NAMES[route.level] !== undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJumping((j) => !j);
        return;
      }
      // `[` and `]` toggle the sidebar and the right panel, except while typing,
      // and `]` only where there is a panel. AltGr, which types `[` on some
      // layouts, reports Ctrl and Alt held.
      const altGraph = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
      if (e.repeat || e.metaKey || ((e.ctrlKey || e.altKey) && !altGraph) || isTyping(e.target)) return;
      if (e.key === "[") toggleNav();
      else if (e.key === "]" && hasPanel) togglePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNav, togglePanel, hasPanel]);

  if (snapshot === undefined) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="loading">Reading the Lab…</p>;
  }
  if (snapshot.refused !== undefined) return <Refusal failure={snapshot.refused} />;
  if (snapshot.unreachable !== undefined) return <Unreachable failure={snapshot.unreachable} onRetry={() => void refresh()} />;

  const levels = (
    <>
      <main className="min-w-0 flex-1 overflow-hidden" data-testid="centre" data-level={route.level}>
        <Centre snapshot={snapshot} route={route} gaps={gaps} look={look} />
      </main>
      <Panel snapshot={snapshot} route={route} gaps={gaps} open={panels.panelOpen} overlay={panels.overlay} onToggle={togglePanel} />
    </>
  );
  return (
    <div className="flex h-screen min-h-0 min-w-[900px]" data-testid="shell">
      <Sidebar route={route} gaps={gaps} onJump={() => setJumping(true)} look={look} collapsed={panels.navCollapsed} onToggle={toggleNav} />
      {route.level === "task" ? (
        // The task screen and its inspector read one row and one run.
        <TaskProvider
          key={`${route.boardRef}/${route.taskId}`}
          snapshot={snapshot}
          boardRef={route.boardRef}
          taskId={route.taskId}
          devtoolUrl={devtoolUrl}
        >
          {levels}
        </TaskProvider>
      ) : (
        levels
      )}
      {jumping ? <JumpTo snapshot={snapshot} gaps={gaps} onClose={() => setJumping(false)} /> : null}
    </div>
  );
}

function Centre({ snapshot, route, gaps, look }: { snapshot: LoadedSnapshot; route: Route; gaps: Gaps; look: ThemeLook | undefined }) {
  switch (route.level) {
    case "cos":
      return <ChiefOfStaffView snapshot={snapshot} gaps={gaps} />;
    case "roster":
      return <RosterView snapshot={snapshot} team={route.team} gaps={gaps} look={look} />;
    case "inbox":
      return <Inbox snapshot={snapshot} suspensionId={route.suspensionId} gaps={gaps} />;
    case "tasks":
      return <Tasks snapshot={snapshot} by={route.by} gaps={gaps} />;
    case "task":
      return <TaskFrame tab={route.tab} gaps={gaps} />;
    case "resource":
      return <ResourceView sessionId={route.sessionId} resourceRef={route.ref} />;
    case "project":
      return <ProjectView snapshot={snapshot} route={route} gaps={gaps} />;
    case "workstream": {
      const workstream = findWorkstream(snapshot, route.mailboxId);
      return workstream === undefined ? (
        <EmptyState title="No such workstream" testId="workstream-missing">
          This Lab's inventory registers no mailbox "{route.mailboxId}".
        </EmptyState>
      ) : (
        <WorkstreamView key={workstream.id} snapshot={snapshot} workstream={workstream} tab={route.tab} gaps={gaps} />
      );
    }
  }
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What the collapsed right panel's strip names, per level that has a panel. */
const PANEL_NAMES: Partial<Record<Route["level"], string>> = { cos: "STREAMS", workstream: "WORKSTREAM", task: "TASK DETAIL" };

/**
 * The right panel's slot, per level: Chief of Staff's rail, the workstream's
 * panel, the task's slot, or nothing. v2's rail: 340px on the inspector
 * surface (v2:26, 1219).
 *
 * Collapsed, it is a 43px strip with the handle that opens it and the panel's
 * name. On a window narrower than 1180px (v2:1121) it starts collapsed and
 * opens over the centre (`overlay`), so the centre keeps its width.
 *
 * Collapsing, the panel stays mounted under the strip until the slot's width
 * has animated down, so it slides shut the way it slides open.
 */
function Panel({
  snapshot,
  route,
  gaps,
  open,
  overlay,
  onToggle,
}: {
  snapshot: LoadedSnapshot;
  route: Route;
  gaps: Gaps;
  open: boolean;
  overlay: boolean;
  onToggle: () => void;
}) {
  let content = null;
  if (route.level === "cos") {
    content = <ChiefOfStaffPanel snapshot={snapshot} gaps={gaps} />;
  } else if (route.level === "workstream") {
    const workstream = findWorkstream(snapshot, route.mailboxId);
    if (workstream !== undefined) content = <WorkstreamPanel snapshot={snapshot} workstream={workstream} gaps={gaps} />;
  } else if (route.level === "task") {
    content = <TaskInspector snapshot={snapshot} gaps={gaps} />;
  }
  // Adjusted during render, not in an effect, so the frame after the click already has the panel kept.
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open && !overlay && !reducedMotion());
  }
  if (content === null) return null;
  const label = open ? "Collapse panel" : "Expand panel";
  const handle = (
    <button
      type="button"
      onClick={onToggle}
      title={`${label} (])`}
      aria-label={label}
      aria-expanded={open}
      data-testid="right-panel-toggle"
      className={`flex size-[22px] shrink-0 items-center justify-center border bg-inspector font-mono text-xs text-muted-foreground hover:text-foreground ${
        // Open, it sits across the panel's left border, 3px left of centre so it clears the labels, wherever the panel's edge is.
        open ? `absolute top-2.5 z-30 ${overlay ? "right-[332px]" : "-left-[14px]"}` : ""
      }`}
    >
      {open ? "›" : "‹"}
    </button>
  );
  return (
    <div
      className={`relative h-full shrink-0 transition-[width] duration-[180ms] ease-out motion-reduce:transition-none ${open && !overlay ? "w-[340px]" : "w-[43px]"}`}
      data-testid="right-panel-slot"
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width") setClosing(false);
      }}
    >
      {(open || closing) && (
        // The panel's content holds 340px, so the slot's width moving clips it rather than reflowing it.
        <aside
          className={`absolute inset-y-0 right-0 overflow-hidden border-l bg-inspector ${open && overlay ? "z-20 w-[340px] shadow-xl" : "w-full"}`}
          data-testid="right-panel"
          data-panel={route.level}
          data-overlay={overlay}
          inert={!open}
        >
          <div className="h-full w-[340px] overflow-y-auto">{content}</div>
        </aside>
      )}
      {open ? (
        handle
      ) : (
        <div className="absolute inset-y-0 right-0 z-10 flex w-[43px] flex-col items-center gap-3 border-l bg-inspector pt-2.5" data-testid="right-panel-rail" data-panel={route.level}>
          {handle}
          <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]" data-look="meta-label">
            {PANEL_NAMES[route.level]}
          </span>
        </div>
      )}
    </div>
  );
}
