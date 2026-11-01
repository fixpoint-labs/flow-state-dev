import { useEffect, useState } from "react";
import type { LabAdapter, ProjectRow, SessionRow } from "./adapter";
import { PaneResizer } from "./components/PaneResizer";
import { ProjectPicker } from "./components/ProjectPicker";
import { SheetArea, SheetProvider } from "./components/Sheet";
import { KeysSheet } from "./components/KeysSheet";
import { SessionsList } from "./components/SessionsList";
import { Switcher } from "./components/Switcher";
import { TasksPane } from "./components/TasksPane";
import { ThreadsBoard } from "./components/ThreadsBoard";
import { Thread } from "./components/Thread";
import { paneColumn, usePaneWidth } from "./lib/pane-width";
import { focusComposer, focusWhenDrawn, useLabKeys } from "./lib/keys";
import { useWatch } from "./lib/use-watch";
import { modeOfWorker, type ModeId } from "./modes";

/**
 * The screen: the view's sessions on the left, the open session's main thread
 * in the center, and its mode's right pane: background tasks in session mode,
 * the threads board in threads mode. A pane opens a task's work in a sheet
 * over the main thread (`SheetArea`). The right pane's width is yours to drag,
 * and stays across reloads (`usePaneWidth`). The app opens in the Sessions view on
 * *New session*, which asks for a project before the composer opens.
 *
 * Keys (`useLabKeys`): ⌘K switches to any session, Alt+↑/↓ steps through the
 * view's sessions, `/` puts the cursor in the composer, `?` lists the keys.
 * Opening a session, however it is opened, puts the cursor in its composer;
 * *New session* puts it on the first project to choose.
 */
/** What `?` lists: every key the lab has. */
const KEYS = [
  ["⌘K / Ctrl+K", "Switch to any session, or start one"],
  ["Alt+↑ / Alt+↓", "The previous or next session in this view"],
  ["/", "Put the cursor in the composer"],
  ["?", "This list"],
  ["← / →", "On the view switch: the other view"],
  ["Enter", "Send, in the composer"],
  ["Esc", "Close a dialog"],
] as const;

export function App({ adapter }: { adapter: LabAdapter }) {
  const sessions = useWatch((emit: (rows: SessionRow[]) => void) => adapter.watchSessions(emit), [adapter]) ?? [];
  const [view, setView] = useState<ModeId>("session");
  // Each view keeps its own open session when you switch away and back.
  const [openByView, setOpenByView] = useState<Partial<Record<ModeId, string>>>({});
  const selectedId = openByView[view];
  // A view with no open session is on *New session*: the center asks for a project.
  const select = (mode: ModeId, id: string | undefined) => setOpenByView((open) => ({ ...open, [mode]: id }));
  // A person's pick: the view and session change, and the cursor goes where they will type.
  const pick = (mode: ModeId, id: string | undefined) => {
    setView(mode);
    select(mode, id);
    if (id === undefined) focusWhenDrawn('section[aria-label="Choose a project"] button, section[aria-label="Choose a project"] input');
    else focusComposer(id);
  };
  const [switching, setSwitching] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // The thread open in the board, by session: a card's *View thread* opens it there too.
  const [openThread, setOpenThread] = useState<Partial<Record<string, string>>>({});
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [paneWidth, setPaneWidth] = usePaneWidth();
  useEffect(() => {
    let live = true;
    void adapter.listProjects().then((rows) => live && setProjects(rows));
    return () => {
      live = false;
    };
  }, [adapter]);

  const openNew = (mode: ModeId, project: ProjectRow) => {
    void adapter.openSession(mode, project.id).then((row) => pick(mode, row.id));
  };
  const inView = sessions.filter((s) => modeOfWorker(s.worker)?.id === view);

  const selected = inView.find((s) => s.id === selectedId);
  useLabKeys({
    palette: () => setSwitching((open) => !open),
    step: (by) => {
      // The view's sessions in the order the list draws them; the ends hold.
      const at = inView.findIndex((s) => s.id === selectedId);
      const next = inView[at === -1 ? (by === 1 ? 0 : inView.length - 1) : at + by];
      if (next !== undefined) pick(view, next.id);
    },
    help: () => setKeysOpen(true),
  });
  const pane = selected ? modeOfWorker(selected.worker)?.pane : undefined;
  return (
    <SheetProvider>
      <div
        className="grid h-full grid-rows-[minmax(0,1fr)] overflow-hidden"
        style={{ gridTemplateColumns: `15rem minmax(0,1fr) ${paneColumn(paneWidth)}` }}
      >
        <SessionsList
          view={view}
          modes={adapter.modes}
          sessions={inView}
          selectedId={selectedId}
          onView={setView}
          onSelect={(id) => pick(view, id)}
          onNew={() => pick(view, undefined)}
        />
        <SheetArea>
          {selected ? (
            <Thread
              key={selected.id}
              adapter={adapter}
              session={selected}
              project={projects.find((p) => p.id === selected.projectId)}
              onOpenThread={(taskId) => setOpenThread((open) => ({ ...open, [selected.id]: taskId }))}
            />
          ) : (
            <ProjectPicker
              projects={projects}
              onPick={(project) => openNew(view, project)}
              onCreate={async (name, repository) => {
                const created = await adapter.createProject(name, repository);
                setProjects((rows) => [...rows, created]);
              }}
            />
          )}
        </SheetArea>
        <div className="relative min-h-0 min-w-0">
          <PaneResizer width={paneWidth} onResize={setPaneWidth} />
          {selected && pane === "tasks" ? (
            <TasksPane adapter={adapter} sessionId={selected.id} />
          ) : selected && pane === "board" ? (
            <ThreadsBoard
              adapter={adapter}
              sessionId={selected.id}
              openId={openThread[selected.id]}
              onOpen={(taskId) => setOpenThread((open) => ({ ...open, [selected.id]: taskId }))}
            />
          ) : (
            <aside className="h-full bg-inspector" />
          )}
        </div>
      </div>
      <Switcher open={switching} onOpenChange={setSwitching} sessions={sessions} modes={adapter.modes} onPick={(mode, id) => {
          // A pick goes somewhere: the key list, if it was open under the switcher, closes too.
          setSwitching(false);
          setKeysOpen(false);
          pick(mode, id);
        }}
      />
      <KeysSheet open={keysOpen} onOpenChange={setKeysOpen} keys={KEYS} />
    </SheetProvider>
  );
}
