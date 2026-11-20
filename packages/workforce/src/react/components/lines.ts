// FIX-2848 D1.
/**
 * How workforce's conversation lines look by default: one renderer per
 * `data` type the server writes, keyed for a registry's `data` slot.
 *
 *     const renderers = { ...appRenderers, data: { ...workforceRenderers, ...appRenderers.data } };
 *
 * - `workforce:received`: a message another worker sent, under its sender's name.
 * - `workforce:sent`: a message this worker sent, *To ada: …*; *Asked ada* when
 *   it asked for a reply, with the answer under it once a waited send has
 *   one; *Not sent to ada*, and why, when it was refused; *Not answered by
 *   ada*, and why, when a waited send's delivery failed.
 * - `workforce:task`: a task the conversation filed, and who it is for.
 * - `workforce:result`: a task's ending, under the worker that ran it. The
 *   board still says each ending as a message too, so a host that draws that
 *   message leaves this type out (`[TASK_RESULT_DATA_TYPE]: false`), or it
 *   draws the ending twice.
 *
 * An app that wants its own look registers its own renderer for a type after
 * the spread. Nothing here publishes a class name and the package brings no
 * CSS framework: each line names what it is in `data-line` and its parts in
 * `data-part`, for a host's styles and a test's selectors. Colours come from
 * the same `--fsd-panel-*` custom properties the panels read.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import type { DataItem } from "@flow-state-dev/core/items";
import { FILED_TASK_DATA_TYPE, RECEIVED_MESSAGE_DATA_TYPE, SENT_MESSAGE_DATA_TYPE, TASK_RESULT_DATA_TYPE } from "../../messages/keys";
import type { FiledTaskValue, ReceivedMessageValue, SentMessageValue, TaskResultValue } from "../../messages/line-values";
import { sentTargetLabel } from "../../messages/sent-target";

const lineStyle = { margin: 0, whiteSpace: "pre-wrap", color: "var(--fsd-panel-fg, inherit)" } as const;
const labelStyle = { fontWeight: 600 } as const;
const mutedStyle = { margin: 0, fontSize: "var(--fsd-panel-note-font-size, 12px)", color: "var(--fsd-panel-muted-fg, inherit)" } as const;

/** A line's text, after its label: "**To ada:** hello". */
function said(label: string, text: string): ReactNode {
  return createElement("p", { style: lineStyle, "data-part": "text" }, createElement("span", { style: labelStyle, "data-part": "label" }, `${label}:`), " ", text);
}

/** A message another worker sent this one (`workforce:received`). */
function ReceivedMessageLine({ item }: { item: DataItem }): ReactNode {
  const value = item.value as Partial<ReceivedMessageValue>;
  const notes = [
    value.inReplyTo === undefined ? null : "answering your message",
    value.replyRequested === true ? "asks for a reply" : null,
    value.noAnswer === true ? "no answer came" : null
  ].filter((note): note is string => note !== null);
  return createElement(
    "div",
    { "data-line": "received", "data-from": value.from ?? "", "data-message-id": value.id ?? "" },
    said(`From ${value.from ?? "another worker"}`, value.text ?? ""),
    notes.length === 0 ? null : createElement("p", { style: mutedStyle, "data-part": "notes" }, notes.join(" · "))
  );
}

/** What a waited send's answer says under its line, or nothing while it waits. */
function waitAnswer(wait: SentMessageValue["wait"]): string | null {
  if (wait?.status === "answered") return wait.noAnswer === true ? "No answer came." : (wait.reply ?? "");
  if (wait?.status === "running") {
    return wait.recipient === "waiting_on_person"
      ? "No answer by the deadline: it waits on the user. The answer comes as a message."
      : "No answer by the deadline yet. The answer comes as a message.";
  }
  return null;
}

/** A message this worker sent (`workforce:sent`), refused and failed ones too. */
function SentMessageLine({ item }: { item: DataItem }): ReactNode {
  const value = item.value as Partial<SentMessageValue>;
  const to = sentTargetLabel(value.to);
  const asks = value.replyRequested === true || value.wait !== undefined;
  const state =
    value.refused !== undefined ? "refused" : value.wait?.status === "waiting" ? "waiting" : value.wait?.status === "failed" ? "failed" : "sent";
  const label =
    state === "refused" ? `Not sent to ${to}` : state === "waiting" ? `Asking ${to}…` : state === "failed" ? `Not answered by ${to}` : asks ? `Asked ${to}` : `To ${to}`;
  const answer = state === "sent" ? waitAnswer(value.wait) : null;
  const reason = state === "refused" ? value.refused : state === "failed" ? value.wait?.error : undefined;
  return createElement(
    "div",
    { "data-line": "sent", "data-to": to, "data-state": state, ...(value.messageId === undefined ? {} : { "data-message-id": value.messageId }) },
    said(label, value.text ?? ""),
    answer === null ? null : createElement("p", { style: lineStyle, "data-part": "answer" }, answer),
    reason === undefined ? null : createElement("p", { style: mutedStyle, "data-part": "reason" }, reason)
  );
}

/** A task the conversation filed (`workforce:task`). */
function FiledTaskLine({ item }: { item: DataItem }): ReactNode {
  const value = item.value as Partial<FiledTaskValue>;
  return createElement(
    "div",
    { "data-line": "task", "data-task-id": value.taskId ?? "" },
    said(value.assignee === undefined ? "Filed a task" : `Filed a task for ${value.assignee}`, value.title ?? "")
  );
}

/** A task the conversation filed ended (`workforce:result`), under the worker that ran it. */
function TaskResultLine({ item }: { item: DataItem }): ReactNode {
  const value = item.value as Partial<TaskResultValue>;
  const from = value.from ?? "The task";
  const label = value.ending === "errored" ? `${from} couldn't finish` : value.ending === "cancelled" ? `${from}'s task was cancelled` : `${from} finished`;
  return createElement(
    "div",
    { "data-line": "result", "data-task-id": value.taskId ?? "", "data-ending": value.ending ?? "" },
    createElement("p", { style: mutedStyle, "data-part": "title" }, `${label}: ${value.title ?? ""}`),
    createElement("p", { style: lineStyle, "data-part": "text" }, value.text ?? "")
  );
}

/**
 * Workforce's renderers for a registry's `data` slot, by `dataType`. Spread
 * them under an app's own: `data: { ...workforceRenderers, ...appRenderers.data }`.
 * A host that draws the board's ending messages sets `[TASK_RESULT_DATA_TYPE]: false`
 * after the spread, so a task's ending draws once.
 * Keep the registry object at module level (or in a `useMemo`), not built
 * per render.
 */
export const workforceRenderers: Readonly<Record<string, ComponentType<{ item: DataItem }>>> = {
  [RECEIVED_MESSAGE_DATA_TYPE]: ReceivedMessageLine,
  [SENT_MESSAGE_DATA_TYPE]: SentMessageLine,
  [FILED_TASK_DATA_TYPE]: FiledTaskLine,
  [TASK_RESULT_DATA_TYPE]: TaskResultLine
};
