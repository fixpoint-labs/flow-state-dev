// BR-3.
/**
 * Shift Manager's frame (S4): three columns, the sidebar, the centre at the level
 * and tab the URL names, and the right panel's slot for that level. The frame
 * holds v2's 900px minimum width; below that the page scrolls.
 *
 * The sidebar and the right panel each collapse on their own (`lib/panels.ts`),
 * from a control on the panel or with `[` and `]`, and the centre takes the
 * width they give up.
 *
 * A Lab that refuses the organization read for want of a verified
 * organization, or that names no organization for the user, gets the refusal
 * screen and nothing else: the sidebar, the tree and every other read wait
 * behind it (`lib/gate.ts`). An organization read that can't reach the Lab
 * gets the couldn't-reach screen, whose Retry reads it again. Once in, a later
 * failure keeps the shell and draws the connection bar above it instead.
 */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { GAPS, type Gaps } from "./gaps";
import type { ThemeLook } from "./lib/theme";
import type { Connection } from "./lib/connection";
import { LabProvider, useLab } from "./lib/lab-data";
import { DirectoryProvider, useDirectoryLanded, useProjects, useWorkers } from "./lib/directory";
import { useGate } from "./lib/gate";
import { PageReadsProvider, useReadPageAgain } from "./lib/page-reads";
import { ConnectionBanner } from "./components/flow-state/connection-banner";
import { ConnectionScreen } from "./components/flow-state/connection-screen";
import { ResourceView } from "./surfaces/Resource";
import { useRoute, type Route } from "./lib/routes";
import { ShiftCoordinatorPanel, ShiftCoordinatorView } from "./surfaces/ShiftCoordinator";
import { Inbox } from "./surfaces/Inbox";
import { JumpTo, MESSAGE_PREFIX } from "./surfaces/JumpTo";
import { ProjectView } from "./surfaces/Project";
import { RosterView } from "./surfaces/Roster";
import { WorkerSettingsView } from "./surfaces/WorkerSettings";
import { SettingsView } from "./surfaces/Settings";
import { Sidebar } from "./surfaces/Sidebar";
import { TaskProvider } from "./lib/task";
import { SessionFeedsProvider } from "./lib/session-feeds";
import { TaskFrame } from "./surfaces/TaskFrame";
import { TaskInspector } from "./surfaces/TaskInspector";
import { Tasks } from "./surfaces/Tasks";
import { Messages } from "./surfaces/Messages";
import { Routines } from "./surfaces/Routines";
import { Usage } from "./surfaces/Usage";
import { SessionView } from "./surfaces/SessionView";
import { isTypingTarget } from "@flow-state-dev/react";
import { usePanels } from "./lib/panels";
import { useInbox, useInboxTasks } from "./lib/inbox";

/**
 * @param devtoolUrl The devtool a task's trace link opens: the one Shift Manager
 *   serves. Absent: the link is off and says how to turn it on.
 * @param look The page's theme, which the mark in the sidebar changes. Absent:
 *   the sidebar draws no mark.
 */
export function App({ connection, gaps = GAPS, devtoolUrl, look }: { connection: Connection; gaps?: Gaps; devtoolUrl?: string; look?: ThemeLook }) {
  return (
    <LabProvider connection={connection}>
      <LabSessionFeeds>
        <Shell gaps={gaps} devtoolUrl={devtoolUrl} look={look} />
      </LabSessionFeeds>
    </LabProvider>
  );
}

/** The page's session feeds, one per session a screen shows, through the Lab's client. */
function LabSessionFeeds({ children }: { children: ReactNode }) {
  const { client } = useLab();
  return <SessionFeedsProvider client={client}>{children}</SessionFeedsProvider>;
}

/** What the page draws while the Lab is first read. */
const READING = (
  <p className="p-6 text-sm text-muted-foreground" data-testid="loading">
    Reading the Lab…
  </p>
);

function Shell({ gaps, devtoolUrl, look }: { gaps: Gaps; devtoolUrl: string | undefined; look: ThemeLook | undefined }) {
  const { gate, retry } = useGate();
  if (gate.state === "reading") return READING;
  if (gate.state === "refused") {
    return (
      <ConnectionScreen kind="refused" title="This Lab won't let Shift Manager in" failure={gate.failure}>
        {gate.failure.httpStatus === undefined
          ? "Shift Manager opens a Lab only under an organization, and this Lab doesn't say which one you're in. Shift Manager shows nothing from the Lab until it does."
          : "The Lab's server refused the first read because the request carried no verified organization. Shift Manager shows nothing from the Lab until it does. Check that the Lab's config hands Shift Manager a credential (its devtool block) and that Shift Manager is opened on the address its start script printed."}
      </ConnectionScreen>
    );
  }
  if (gate.state === "unreachable") {
    return (
      <ConnectionScreen kind="unreachable" title="Shift Manager couldn't reach the Lab" failure={gate.failure} onRetry={retry}>
        The first read failed before the Lab said who you are. Check that the Lab's server is running, then retry.
      </ConnectionScreen>
    );
  }
  // Every read but the gate's waits behind it: the directory, the Inbox view and the screens' own.
  return (
    <DirectoryProvider>
      <PageReadsProvider>
        <Landed>
          <Frame gaps={gaps} devtoolUrl={devtoolUrl} look={look} />
        </Landed>
      </PageReadsProvider>
    </DirectoryProvider>
  );
}

/** The frame, once the directory's first reads have landed; until then, the page is still reading the Lab. */
function Landed({ children }: { children: ReactNode }) {
  return useDirectoryLanded() ? children : READING;
}

/** The frame, once the Lab let Shift Manager in. */
function Frame({ gaps, devtoolUrl, look }: { gaps: Gaps; devtoolUrl: string | undefined; look: ThemeLook | undefined }) {
  const { client, health } = useLab();
  // FIX-2774: the Inbox, Tasks and a task's asks read the inbox view; R reads it again too.
  const inbox = useInbox();
  const refreshInbox = inbox.refresh;
  const refreshWorkers = useWorkers().refresh;
  const refreshProjects = useProjects().refresh;
  const readPageAgain = useReadPageAgain();
  const route = useRoute();
  // Null is closed; "" opens Jump to, MESSAGE_PREFIX opens it already in message mode.
  const [jumping, setJumping] = useState<string | null>(null);
  // Jump to lists finished tasks too, so it alone asks the view for them, and only while it is open.
  const jumpTasks = useInboxTasks(jumping !== null);
  const panels = usePanels(client.userId);
  const { toggleNav, togglePanel } = panels;
  const hasPanel = PANEL_NAMES[route.level] !== undefined;

  // Bound as the frame commits, not after paint: a key pressed the moment the page draws is heard.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Shift+⌘K goes straight to messaging the Shift Coordinator. Either chord closes an open palette; neither re-seeds it.
        setJumping((j) => (j === null ? (e.shiftKey ? MESSAGE_PREFIX : "") : null));
        return;
      }
      // `[` and `]` toggle the sidebar and the right panel, and R reads again
      // what the page holds, except while typing, and `]` only where there is
      // a panel. AltGr, which types `[` on some layouts, reports Ctrl and Alt held.
      const altGraph = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
      if (e.repeat || e.metaKey || ((e.ctrlKey || e.altKey) && !altGraph) || isTypingTarget(e.target)) return;
      if (e.key === "[") toggleNav();
      else if (e.key === "]" && hasPanel) togglePanel();
      else if (e.key === "r" || e.key === "R") {
        // The page's reads: the Inbox view, the worker directory and the sessions, the projects, and each screen's own.
        refreshInbox();
        refreshWorkers();
        refreshProjects();
        readPageAgain();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNav, togglePanel, hasPanel, refreshInbox, refreshWorkers, refreshProjects, readPageAgain]);

  const levels = (
    <>
      <main className="min-w-0 flex-1 overflow-hidden" data-testid="centre" data-level={route.level}>
        <Centre route={route} gaps={gaps} look={look} devtoolUrl={devtoolUrl} />
      </main>
      <Panel route={route} gaps={gaps} open={panels.panelOpen} overlay={panels.overlay} onToggle={togglePanel} />
    </>
  );
  return (
    <div className="flex h-dvh min-h-0 min-w-[900px] flex-col" data-testid="shell">
      <ConnectionBanner feed={{ state: health }} className="pb-2" />
      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} gaps={gaps} onJump={() => setJumping("")} look={look} collapsed={panels.navCollapsed} onToggle={toggleNav} />
        {route.level === "task" ? (
          // The task screen and its inspector read one row and one run.
          <TaskProvider
            key={`${route.boardRef}/${route.taskId}`}
            boardRef={route.boardRef}
            taskId={route.taskId}
            devtoolUrl={devtoolUrl}
          >
            {levels}
          </TaskProvider>
        ) : (
          levels
        )}
        {jumping !== null ? <JumpTo tasks={jumpTasks ?? (inbox.section?.ok === true ? inbox.section.value.tasks : undefined)} gaps={gaps} client={client} initialQuery={jumping} onClose={() => setJumping(null)} /> : null}
      </div>
    </div>
  );
}

function Centre({ route, gaps, look, devtoolUrl }: { route: Route; gaps: Gaps; look: ThemeLook | undefined; devtoolUrl: string | undefined }) {
  switch (route.level) {
    case "shift-coordinator":
      return <ShiftCoordinatorView gaps={gaps} />;
    case "roster":
      return <RosterView team={route.team} gaps={gaps} look={look} />;
    case "inbox":
      return <Inbox itemId={route.item} gaps={gaps} />;
    case "tasks":
      return <Tasks by={route.by} gaps={gaps} />;
    case "task":
      return <TaskFrame tab={route.tab} gaps={gaps} />;
    case "messages":
      return <Messages />;
    case "routines":
      return <Routines />;
    case "usage":
      return <Usage />;
    case "session":
      return <SessionView sessionId={route.sessionId} gaps={gaps} />;
    case "resource":
      return <ResourceView sessionId={route.sessionId} resourceRef={route.ref} />;
    case "project":
      return <ProjectView route={route} gaps={gaps} />;
    case "worker-settings":
      return <WorkerSettingsView workerId={route.worker} devtoolUrl={devtoolUrl} />;
    case "settings":
      return <SettingsView />;
  }
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What the collapsed right panel's strip names, per level that has a panel. */
const PANEL_NAMES: Partial<Record<Route["level"], string>> = { "shift-coordinator": "DELEGATES", task: "TASK DETAIL" };

/**
 * The right panel's slot, per level: Shift Coordinator's rail, the task's slot,
 * or nothing. v2's rail: 340px on the inspector
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
  route,
  gaps,
  open,
  overlay,
  onToggle,
}: {
  route: Route;
  gaps: Gaps;
  open: boolean;
  overlay: boolean;
  onToggle: () => void;
}) {
  let content = null;
  if (route.level === "shift-coordinator") {
    content = <ShiftCoordinatorPanel />;
  } else if (route.level === "task") {
    content = <TaskInspector gaps={gaps} />;
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
          <span className="font-mono text-xs font-medium tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]" data-look="meta-label">
            {PANEL_NAMES[route.level]}
          </span>
        </div>
      )}
    </div>
  );
}
