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

/** What a coding task runs on, as its line names it: the harness, and the model when its run reported one. */
export function runsOn(task: { harness?: string; model?: string }): string | undefined {
  if (task.harness === undefined) return undefined;
  return task.model === undefined ? task.harness : `${task.harness} · ${task.model}`;
}

/** A coding task line's accessible name: its line, and what it runs on. */
export const taskLabel = (line: string, task: { harness?: string; model?: string }) => {
  const on = runsOn(task);
  return on === undefined ? line : `${line}, on ${on}`;
};

/** How a sent message stands. */
export type AnswerState = "working" | "replied" | "no answer";

/**
 * How a message stands, from the message log: `replied` by a reply message
 * or, for a call, by its result; `no answer` when the reply is the
 * framework's "no answer"; `working` until then.
 */
export const answerIn = (talk: readonly TalkRow[], messageId: string): AnswerState => {
  const reply = talk.find((row) => row.inReplyTo === messageId);
  if (reply !== undefined) return reply.noAnswer === true ? "no answer" : "replied";
  return talk.some((row) => row.id === messageId && row.callAnswered === true) ? "replied" : "working";
};

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
  const on = task ? runsOn(task) : undefined;
  const title =
    task && !isCoding(task.to) ? (
      <Titled look={lookOf(task.to)} line={line} />
    ) : (
      <span className="flex items-center gap-2">
        {line}
        {on === undefined ? null : <RunsOn on={on} />}
      </span>
    );
  // A coding task says what it starts on from the moment it is filed, before its run reports anything.
  const starting = task?.harness !== undefined && isCoding(task.to) ? `Starting on ${task.harness}…` : task?.runSessionId ? "Starting…" : "Not started yet.";
  return (
    <SessionPopup label={line} title={title} status={task?.status} onClose={onClose}>
      {/* The result leads; how the run got there is below it. */}
      {task?.result ? (
        <section aria-label="Result" data-step="result" className="rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-2 text-sm whitespace-pre-wrap">
          {task.result}
        </section>
      ) : null}
      <Steps steps={steps} nameOf={nameOf} empty={starting} />
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
    <SessionPopup label={line} title={<Titled look={lookOf(popup.to)} line={line} />} status={answerIn(talk, popup.messageId)} onClose={onClose}>
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

/** What a coding task runs on, as a small tag after its line. */
export function RunsOn({ on }: { on: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground" data-harness>
      {on}
    </span>
  );
}
