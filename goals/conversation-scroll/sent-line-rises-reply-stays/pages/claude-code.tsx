/**
 * The Claude Code-style lab's goal page: its real `Thread`, `ThreadView` (a
 * task's thread) and the task panel's `SessionOverlay` sheet, with the lab's stylesheet, on a
 * scripted adapter (`script.ts`) in place of the server. Copied to the lab's
 * scratch copy as `src/goal/claude-code.tsx`.
 *
 *   ?surface=thread        the main thread and its composer
 *   ?surface=task-thread   a task's thread and its composer, in the sheet it opens in
 *   ?surface=task-panel    the task panel's sheet, which never sends
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { LabAdapter, SessionRow, TaskRow, ThreadEntry } from "../adapter";
import { Entry } from "../components/Entry";
import { SessionOverlay, SessionOverlayArea, SessionOverlayProvider } from "../components/flow-state/session-overlay";
import { Thread } from "../components/Thread";
import { ThreadView } from "../components/ThreadView";
import "../styles.css";
import { exposeGoal, script, useConversation, useOpen, type Line } from "./script";

const entryOf = (line: Line): ThreadEntry =>
  line.who === "person"
    ? { kind: "user", id: line.id, text: line.text }
    : line.who === "worker"
      ? { kind: "assistant", id: line.id, text: line.text }
      : { kind: "result", id: line.id, taskId: "t-other", title: "Answer from a task", status: "completed", summary: line.text, duringTurn: false };

const follow = (key: string, emit: (value: never) => void, shape: (lines: ThreadEntry[], running: boolean) => unknown) => {
  const read = () => {
    const c = script.get(key);
    emit(shape(c.lines.map(entryOf), c.running) as never);
  };
  read();
  return script.subscribe(read);
};

/** Every read and write the views make; only the thread, the task's work and the sends do anything. */
const adapter: LabAdapter = {
  modes: ["session"],
  watchSessions: () => () => undefined,
  listProjects: async () => [],
  createProject: async () => ({ id: "p", name: "P" }),
  checkRepository: async () => undefined as never,
  readHarnesses: async () => [],
  openSession: async () => session("a"),
  send: (key, text) => script.send(key, text),
  interrupt: async () => undefined,
  retry: async () => undefined,
  watchThread: (key, emit) => follow(key, emit, (entries, running) => ({ entries, running, connection: "live", ...(running ? { turnStartedAt: Date.now() } : {}) })),
  watchTasks: () => () => undefined,
  watchTaskWork: (_session, taskId, emit) => follow(taskId, emit, (entries) => ({ entries })),
  sayInThread: (_session, taskId, line) => script.send(taskId, line),
  resolve: async () => undefined,
  taskActions: () => ({ cancel: async () => undefined, steer: async () => undefined, release: async () => undefined, retry: async () => undefined }) as never,
  requestChanges: (_session, taskId, words) => script.send(taskId, words),
  watchPins: () => () => undefined,
  pin: async () => undefined,
  unpin: async () => undefined,
};

const session = (id: string): SessionRow => ({ id, title: `Session ${id}`, worker: "desk.main", updatedAt: 0, running: false, waiting: 0, projectId: "p" });
const task = (id: string): TaskRow => ({ id, title: `Task ${id}`, goal: "A task", status: "in_progress" });

function Page() {
  const open = useOpen();
  const surface = new URLSearchParams(location.search).get("surface");
  const conversation = useConversation(open);
  if (surface === "task-thread") {
    return (
      <SessionOverlayProvider>
        <div style={{ height: "100vh" }} className="grid bg-background text-foreground">
          <SessionOverlayArea>
            <div style={{ height: "100vh" }} />
          </SessionOverlayArea>
        </div>
        <ThreadView key={open} adapter={adapter} sessionId="a" task={task(open)} pinned={false} onClose={() => undefined} />
      </SessionOverlayProvider>
    );
  }
  return (
    <SessionOverlayProvider>
      <div style={{ height: "100vh" }} className="grid bg-background text-foreground">
        <SessionOverlayArea>
          <div style={{ height: "100vh" }}>
            <Thread adapter={adapter} session={session(surface === "task-panel" ? "panel" : open)} project={{ id: "p", name: "P" }} onOpenThread={() => undefined} />
          </div>
        </SessionOverlayArea>
      </div>
      {surface === "task-panel" ? (
        <SessionOverlay key={open} variant="sheet" label="Task" title={`Task ${open}`} onClose={() => undefined}>
          {conversation.lines.map((line) => (
            <Entry key={line.id} entry={entryOf(line)} />
          ))}
        </SessionOverlay>
      ) : null}
    </SessionOverlayProvider>
  );
}

exposeGoal();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
