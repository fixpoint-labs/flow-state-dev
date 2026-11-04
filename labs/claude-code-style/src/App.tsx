import { useCallback, useEffect, useRef, useState } from "react";
import type { LabAdapter, ProjectRow, SessionRow, TaskRow } from "./adapter";
import { PaneResizer } from "./components/PaneResizer";
import { ProjectPicker } from "./components/ProjectPicker";
import { SheetArea, SheetProvider } from "./components/Sheet";
import { KeysSheet } from "./components/KeysSheet";
import { SessionsList } from "./components/SessionsList";
import { Switcher } from "./components/Switcher";
import { TasksPane } from "./components/TasksPane";
import { ThreadsBoard } from "./components/ThreadsBoard";
import { Thread } from "./components/Thread";
import { readAddress, writeAddress, type Address, type AddressWrite } from "./lib/address";
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
 * *New session*, which asks for a project before the composer opens, unless
 * the page's address names what was open (`lib/address`): a reload, a link and
 * Back reopen the view, the session and the task open in its pane. A line in
 * the main thread that names a task opens it too, the same way: one open task
 * per session, whichever side it was opened from.
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
  const listed = useWatch((emit: (rows: SessionRow[]) => void) => adapter.watchSessions(emit), [adapter]);
  const sessions = listed ?? [];
  // What the page's address named when it loaded, or on Back, until the sessions are read.
  const [start] = useState(readAddress);
  const pending = useRef<Address | null>(start.session === undefined ? null : start);
  // How the next address write lands: a pick adds a Back step, anything else replaces.
  const how = useRef<AddressWrite>("replace");
  const [view, setView] = useState<ModeId>(start.view ?? "session");
  // Each view keeps its own open session when you switch away and back.
  const [openByView, setOpenByView] = useState<Partial<Record<ModeId, string>>>({});
  const selectedId = openByView[view];
  // A view with no open session is on *New session*: the center asks for a project.
  const select = (mode: ModeId, id: string | undefined) => setOpenByView((open) => ({ ...open, [mode]: id }));
  // The task open in each session's pane: a thread on the board, or a task's sheet.
  const [openTask, setOpenTask] = useState<Partial<Record<string, string>>>({});
  // The task the address opened. Only it is dropped when it is gone: a task
  // filed a moment ago can be opened before its row arrives.
  const addressedTask = useRef<string | undefined>(undefined);
  const dropMissing = (sessionId: string) => {
    if (openTask[sessionId] === addressedTask.current) openTaskOf(sessionId, undefined, "replace");
  };
  const openTaskOf = (sessionId: string, taskId: string | undefined, write: AddressWrite = "push") => {
    how.current = write;
    setOpenTask((open) => ({ ...open, [sessionId]: taskId }));
  };
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [paneWidth, setPaneWidth] = usePaneWidth();
  useEffect(() => {
    let live = true;
    void adapter.listProjects().then((rows) => live && setProjects(rows));
    return () => {
      live = false;
    };
  }, [adapter]);

  // Open what the address names, once the sessions are read. A session that is gone leaves the default.
  const rows = useRef(listed);
  rows.current = listed;
  const open = useCallback((address: Address, listing: SessionRow[]) => {
    pending.current = null;
    const row = listing.find((s) => s.id === address.session);
    const mode = row ? modeOfWorker(row.worker)?.id : undefined;
    if (row && mode) {
      setView(mode);
      setOpenByView((open) => ({ ...open, [mode]: row.id }));
      addressedTask.current = address.task;
      setOpenTask((open) => ({ ...open, [row.id]: address.task }));
      return;
    }
    // A session that is gone: the default screen, as for an address that names none.
    const fallback = address.view ?? "session";
    setView(fallback);
    setOpenByView((open) => ({ ...open, [fallback]: undefined }));
  }, []);
  useEffect(() => {
    if (listed !== undefined && pending.current !== null) open(pending.current, listed);
  }, [listed, open]);
  // Back and Forward: draw what the address names now.
  useEffect(() => {
    const onPop = () => {
      const address = readAddress();
      how.current = "replace";
      if (address.session === undefined) {
        pending.current = null;
        const mode = address.view ?? "session";
        setView(mode);
        setOpenByView((open) => ({ ...open, [mode]: undefined }));
      } else if (rows.current === undefined) pending.current = address;
      else open(address, rows.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);
  // Keep the address on what is open. Held while the address's own session is still being read.
  const task = selectedId === undefined ? undefined : openTask[selectedId];
  useEffect(() => {
    if (pending.current !== null) return;
    // A run that changes nothing (a list refresh) leaves a pending pick's push for the write it is waiting on.
    if (writeAddress({ view, session: selectedId, task }, how.current)) how.current = "replace";
  }, [view, selectedId, task, listed]);
  // A user's pick: a step Back returns from, and it wins over an address still waiting on the session list.
  // The view and session change, and the cursor goes where they will type.
  const pick = (mode: ModeId, id: string | undefined) => {
    how.current = "push";
    pending.current = null;
    setView(mode);
    select(mode, id);
    if (id === undefined) focusWhenDrawn('section[aria-label="Choose a project"] button, section[aria-label="Choose a project"] input');
    else focusComposer(id);
  };
  const [switching, setSwitching] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const pickView = (mode: ModeId) => {
    how.current = "push";
    pending.current = null;
    setView(mode);
  };

  // ProjectPicker holds its buttons while this runs and shows a refusal.
  const openNew = (mode: ModeId, project: ProjectRow) =>
    adapter.openSession(mode, project.id).then((row) => pick(mode, row.id));
  const inView = sessions.filter((s) => modeOfWorker(s.worker)?.id === view);

  const selected = inView.find((s) => s.id === selectedId);
  // The open session's task rows, read once for the main thread and its pane (FIX-2399 E1). Each read
  // carries the session it was read for, so a switch never hands one session the last one's rows.
  const read = useWatch(
    (emit: (read: { sessionId: string; rows: TaskRow[] }) => void) =>
      selected === undefined ? () => undefined : adapter.watchTasks(selected.id, (rows) => emit({ sessionId: selected.id, rows })),
    [adapter, selected?.id],
  );
  const taskRows = selected !== undefined && read?.sessionId === selected.id ? read.rows : undefined;
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
          onView={pickView}
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
              tasks={taskRows}
              onOpenThread={(taskId) => openTaskOf(selected.id, taskId)}
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
            <TasksPane
              // Keyed by session: a switch never judges the open task against the last session's rows.
              key={selected.id}
              adapter={adapter}
              sessionId={selected.id}
              tasks={taskRows}
              openId={openTask[selected.id]}
              onOpen={(taskId) => openTaskOf(selected.id, taskId)}
              onMissing={() => dropMissing(selected.id)}
            />
          ) : selected && pane === "board" ? (
            <ThreadsBoard
              // Keyed by session: a switch never judges the open task against the last session's rows.
              key={selected.id}
              adapter={adapter}
              sessionId={selected.id}
              tasks={taskRows}
              openId={openTask[selected.id]}
              onOpen={(taskId) => openTaskOf(selected.id, taskId)}
              onMissing={() => dropMissing(selected.id)}
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
