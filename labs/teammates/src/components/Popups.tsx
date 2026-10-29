import { useCallback } from "react";
import type { LabAdapter, TalkRow } from "../adapter";
import type { Look } from "../lib/looks";
import { useWatch } from "../lib/use-watch";
import { Avatar } from "./Avatar";
import { SessionPopup, Steps } from "./SessionPopup";

/** What a popup shows: a task one conversation filed, or one message a worker sent. */
export type Popup =
  | { kind: "task"; sessionId: string; taskId: string }
  | { kind: "message"; from: string; to: string; messageId: string; text: string };

/** "Draft the PM role" as it reads after "Asked writer to". */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A task's line, the same in the thread and on the popup: a coding task, or what was asked of whom. */
export function taskLine(task: { title: string; to: string }, coding: boolean, nameOf: (id: string) => string): string {
  return coding ? `Coding task: ${task.title}` : `Asked ${nameOf(task.to)} to ${lowerFirst(task.title)}`;
}

/** Whether a message was answered, from the message log: by a reply message, or, for a call, by its result. */
export const repliedIn = (talk: readonly TalkRow[], messageId: string) =>
  talk.some((row) => row.inReplyTo === messageId || (row.id === messageId && row.callAnswered === true));

/** The open popup, live: it reads what it shows by itself, so it stays current while the work goes on. */
export function PopupView({ adapter, popup, nameOf, lookOf, isCoding, onClose }: {
  adapter: LabAdapter;
  popup: Popup;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onClose: () => void;
}) {
  return popup.kind === "task" ? (
    <TaskPopup adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} isCoding={isCoding} onClose={onClose} />
  ) : (
    <MessagePopup adapter={adapter} popup={popup} nameOf={nameOf} lookOf={lookOf} onClose={onClose} />
  );
}

/** A task's run session and its result. */
function TaskPopup({ adapter, popup, nameOf, lookOf, isCoding, onClose }: {
  adapter: LabAdapter;
  popup: Extract<Popup, { kind: "task" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onClose: () => void;
}) {
  const task = (useWatch(adapter.watchTasks, popup.sessionId) ?? []).find((t) => t.id === popup.taskId);
  const steps = useWatch(adapter.watchRun, task?.runSessionId) ?? [];
  const line = task ? taskLine(task, isCoding(task.to), nameOf) : "Task";
  // A teammate's task carries its look; a coding task is nobody's.
  const title = task && !isCoding(task.to) ? <Titled look={lookOf(task.to)} line={line} /> : line;
  return (
    <SessionPopup label={line} title={title} status={task?.status} onClose={onClose}>
      <Steps steps={steps} nameOf={nameOf} empty={task?.runSessionId ? "Starting…" : "Not started yet."} />
      {task?.result ? (
        <section aria-label="Result" data-step="result" className="rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-2 text-sm whitespace-pre-wrap">
          {task.result}
        </section>
      ) : null}
    </SessionPopup>
  );
}

/** One message: what was sent, what the worker that read it did, and its reply. */
function MessagePopup({ adapter, popup, nameOf, lookOf, onClose }: {
  adapter: LabAdapter;
  popup: Extract<Popup, { kind: "message" }>;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  onClose: () => void;
}) {
  const watch = useCallback<typeof adapter.watchRun>((messageId, onChange) => adapter.watchExchange(popup.to, messageId, onChange), [adapter, popup.to]);
  const steps = useWatch(watch, popup.messageId) ?? [];
  const talk = useWatch(adapter.watchTalk, popup.to) ?? [];
  const to = nameOf(popup.to);
  const line = `Messaged ${to}`;
  return (
    <SessionPopup label={line} title={<Titled look={lookOf(popup.to)} line={line} />} status={repliedIn(talk, popup.messageId) ? "replied" : "working"} onClose={onClose}>
      <p className="font-mono text-xs text-muted-foreground">
        {nameOf(popup.from)} → {to}
      </p>
      <Steps steps={steps} nameOf={nameOf} empty={`${popup.text}\n\n${to} hasn't read it yet.`} />
    </SessionPopup>
  );
}

/** A popup's title with the teammate's icon in front. */
function Titled({ look, line }: { look: Look; line: string }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar look={look} size="sm" />
      {line}
    </span>
  );
}
