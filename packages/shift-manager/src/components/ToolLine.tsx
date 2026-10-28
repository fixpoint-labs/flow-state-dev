"use client";

/**
 * Tool calls as background, not content.
 *
 * One call is a single muted line ("Used discover ›") that opens to its input,
 * result and metadata; a run of consecutive calls is one line ("Used 3 tools
 * ›") that opens to one row per call. A call that is running or failed says
 * so in words ("Using discover…", "discover failed"), since there is no badge.
 * A call that stopped to wait (`isSuspensionWait`) says so ("discover is
 * waiting"), not that it failed. A failed call that a later call of the same
 * tool in the run completed was an attempt, not an error: it reads "Tried
 * openWorkstream", and the run doesn't read as failed for it.
 *
 * A `sendMessage` call is talk, not background: it is its own line, *To
 * <recipient>: <text>*, with a link to Messages, and a refused one says it
 * wasn't sent and why (FIX-1989). One that waits for the answer (a call,
 * FIX-2239) reads *Asked <recipient>* and shows the reply under it, or says no
 * answer came by its deadline.
 *
 * This is Shift Manager's own presentation: `flow-state/tool.tsx` is the
 * registry's copy and stays byte-equal to it. {@link shiftManagerRenderers}
 * swaps this in for its `tool_output` renderer.
 */
import { Fragment, type ReactNode } from "react";
import { isSuspensionWait, type ToolOutputItem } from "@flow-state-dev/core/items";
import { ChevronRightIcon } from "lucide-react";
import type { ItemRenderSegment, RendererRegistry } from "@flow-state-dev/react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { COORDINATOR_ROUTE, RECEIVED_MESSAGE_COMPONENT, SEND_MESSAGE_TOOL } from "@flow-state-dev/workforce/browser";
import { navigate } from "../lib/routes";
import { chatAssistantRenderers } from "./flow-state/chat-assistant";
import { CoordinatorRoute } from "./CoordinatorRoute";
import { ReceivedMessage } from "./ReceivedMessage";
import { TaskBoardMeta } from "./TaskBoardMeta";
import { ToolInput, ToolOutput } from "./flow-state/tool";

type CallState = "pending" | "running" | "waiting" | "completed" | "error" | "retried";

function stateOf(item: ToolOutputItem): CallState {
  if (isSuspensionWait(item)) return "waiting";
  switch (item.status) {
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    default:
      return "pending";
  }
}

/**
 * Each call's state in its run: a failure that a later call of the same tool
 * completed is `retried`. Only the tool name is compared, not the arguments,
 * and a retry in another run doesn't count.
 */
function statesInRun(items: readonly ToolOutputItem[]): CallState[] {
  return items.map((item, i) => {
    const state = stateOf(item);
    if (state !== "error") return state;
    const retried = items.slice(i + 1).some((later) => later.toolCall?.name === item.toolCall?.name && stateOf(later) === "completed");
    return retried ? "retried" : state;
  });
}

/** The worst state in a run: any failure not retried, else any call waiting, else any call still going, else done. */
function runState(states: readonly CallState[]): CallState {
  if (states.includes("error")) return "error";
  if (states.includes("waiting")) return "waiting";
  if (states.some((s) => s === "running" || s === "pending")) return "running";
  return "completed";
}

function argsOf(item: ToolOutputItem): unknown {
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** "Used discover", "Using discover…" while it runs, "discover failed" when it did, "discover is waiting" while it waits, "Tried discover" when a retry did it. */
function callLabel(name: string, state: CallState): string {
  if (state === "error") return `${name} failed`;
  if (state === "retried") return `Tried ${name}`;
  if (state === "waiting") return `${name} is waiting`;
  if (state === "running" || state === "pending") return `Using ${name}…`;
  return `Used ${name}`;
}

/** The input, result and metadata of one call: what a quiet line opens to. */
function CallDetails({ item }: { item: ToolOutputItem }) {
  // A wait is not an error: its message is what it waits on, which the ask itself shows.
  const failed = stateOf(item) === "error";
  const args = argsOf(item);
  const output = failed ? undefined : item.output;
  const errorText = failed ? (item.error?.message ?? (item.output === undefined ? undefined : String(item.output))) : undefined;
  const entries: Array<[string, string]> = [];
  if (item.blockName) entries.push(["Block", item.blockName]);
  entries.push(["Item", item.id]);
  return (
    <div className="space-y-3">
      {args !== undefined && <ToolInput input={args} />}
      {item.status !== "in_progress" && (output !== undefined || errorText !== undefined) && <ToolOutput output={output} errorText={errorText} />}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="uppercase tracking-wide">{k}</dt>
            <dd className="truncate font-mono">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/** The muted line and its chevron, opening to `children`. */
function QuietLine({ label, state, nested = false, children }: { label: string; state: CallState; nested?: boolean; children: ReactNode }) {
  return (
    <Collapsible className="group/quiet not-prose w-full" data-testid={nested ? "tool-row" : "tool-group"} data-state-kind={state}>
      <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
        <span className={cn("truncate", state === "error" && "text-destructive", nested && "font-mono text-xs")}>{label}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/quiet:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 outline-none">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function isMessageCall(item: ToolOutputItem): boolean {
  return item.toolCall?.name === SEND_MESSAGE_TOOL;
}

/** Who a message call names: a worker's id, a task, or a conversation (FIX-2160). */
function messageTargetLabel(to: unknown): string {
  if (typeof to === "string") return to;
  const target = (typeof to === "object" && to !== null ? to : {}) as { task?: unknown; session?: unknown };
  if (typeof target.task === "string") return `task ${target.task}`;
  if (typeof target.session === "string") return `conversation ${target.session}`;
  return "another worker";
}

/** What a call's answer says under its line: the reply, or why none came yet (FIX-2239). */
function callOutcomeLine(output: { status?: unknown; reply?: unknown; recipient?: unknown } | undefined): string | null {
  if (output?.status === "answered" && typeof output.reply === "string") return output.reply;
  if (output?.status === "running") {
    return output.recipient === "waiting_on_person" ? "No answer by the deadline: it waits on the user." : "No answer by the deadline yet.";
  }
  return null;
}

function MessageCallLine({ item }: { item: ToolOutputItem }) {
  const args = argsOf(item) as { to?: unknown; text?: unknown; wait?: unknown; callId?: unknown } | undefined;
  const callId = typeof args?.callId === "string" ? args.callId : undefined;
  const to = messageTargetLabel(args?.to);
  const text = callId !== undefined ? `call ${callId}` : typeof args?.text === "string" ? args.text : "";
  const isCall = args?.wait === true || callId !== undefined;
  const state = stateOf(item);
  const output = item.output as { ok?: unknown; error?: unknown; status?: unknown; reply?: unknown; recipient?: unknown } | undefined;
  const refused = state === "error" || output?.ok === false || output?.status === "failed";
  const reason = typeof output?.error === "string" ? output.error : item.error?.message;
  const busy = state === "running" || state === "pending" || state === "waiting";
  const label =
    callId !== undefined
      ? refused
        ? "Couldn't wait again"
        : busy
          ? "Waiting again…"
          : "Waited again"
      : refused
        ? `Not sent to ${to}`
        : busy
          ? isCall
            ? `Asking ${to}…`
            : `Sending to ${to}…`
          : isCall
            ? `Asked ${to}`
            : `To ${to}`;
  const answer = isCall && !refused ? callOutcomeLine(output) : null;
  return (
    <div className="not-prose text-sm" data-testid="message-call" data-to={to} data-state-kind={refused ? "error" : state}>
      <p className="whitespace-pre-wrap">
        <span className={cn("font-medium", refused && "text-destructive")}>{label}:</span> {text}
      </p>
      {answer === null ? null : (
        <p className="mt-0.5 whitespace-pre-wrap" data-testid="message-call-answer" data-status={String(output?.status)}>
          {answer}
        </p>
      )}
      <p className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
        {refused && reason !== undefined ? <span data-testid="message-call-reason">{reason}</span> : null}
        <button type="button" className="hover:text-foreground hover:underline" onClick={() => navigate({ level: "messages" })} data-testid="message-call-messages">
          Messages ›
        </button>
      </p>
    </div>
  );
}

/**
 * A run of tool calls as one quiet line: the call's own name for one call, a
 * count for several. Opens to the call's details, or to one line per call that
 * opens to its own.
 */
export function ToolLineGroup({ items }: { items: readonly ToolOutputItem[] }) {
  if (items.length === 0) return null;
  if (items.some(isMessageCall)) {
    // Consecutive other calls stay one quiet line between the messages.
    const parts: Array<{ message: ToolOutputItem } | { run: ToolOutputItem[] }> = [];
    for (const item of items) {
      const last = parts[parts.length - 1];
      if (isMessageCall(item)) parts.push({ message: item });
      else if (last !== undefined && "run" in last) last.run.push(item);
      else parts.push({ run: [item] });
    }
    return (
      <div className="flex flex-col gap-1.5">
        {parts.map((part) =>
          "message" in part ? <MessageCallLine key={part.message.id} item={part.message} /> : <ToolLineGroup key={part.run[0]!.id} items={part.run} />,
        )}
      </div>
    );
  }
  const states = statesInRun(items);
  const state = runState(states);
  if (items.length === 1) {
    const item = items[0]!;
    return (
      <QuietLine label={callLabel(item.toolCall.name, state)} state={state}>
        <CallDetails item={item} />
      </QuietLine>
    );
  }
  const label =
    state === "running"
      ? `Using ${items.length} tools…`
      : state === "error"
        ? `Used ${items.length} tools, one failed`
        : state === "waiting"
          ? `Used ${items.length} tools, one waiting`
          : `Used ${items.length} tools`;
  return (
    <QuietLine label={label} state={state}>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.id}>
            <QuietLine label={callLabel(item.toolCall.name, states[i]!)} state={states[i]!} nested>
              <CallDetails item={item} />
            </QuietLine>
          </li>
        ))}
      </ul>
    </QuietLine>
  );
}

/** A feed segment: one item, or a run of calls and nothing else. */
export type CallRunSegment = Extract<ItemRenderSegment, { kind: "item" }> | { kind: "group"; items: ToolOutputItem[] };

/**
 * The feed's segments with each stretch of activity split back into runs of
 * calls, which {@link ToolLineGroup} draws, and the thoughts between them, which
 * draw as they always have. The renderer groups thinking with calls; Shift
 * Manager's quiet lines are for calls alone.
 */
export function callRuns(segments: readonly ItemRenderSegment[]): CallRunSegment[] {
  const out: CallRunSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "item") {
      out.push(segment);
      continue;
    }
    let run: ToolOutputItem[] = [];
    const flush = () => {
      if (run.length > 0) out.push({ kind: "group", items: run });
      run = [];
    };
    for (const item of segment.items) {
      if (item.type === "tool_output") run.push(item);
      else {
        flush();
        out.push({ kind: "item", item });
      }
    }
    flush();
  }
  return out;
}

/** One call, as the registry hands it to a `tool_output` renderer. */
export function ToolLine({ item }: { item: ToolOutputItem }) {
  if (!item.toolCall) return null;
  return <ToolLineGroup items={[item]} />;
}

/** The chat registry with tool calls drawn as quiet lines. */
export const shiftManagerRenderers: RendererRegistry = {
  ...chatAssistantRenderers,
  tool_output: ToolLine,
  // A coordinator's routing record, drawn apart from the conversation's lines.
  // Its task board, with each row opening that task's session. Another
  // worker's message, under its sender's name.
  component: {
    ...chatAssistantRenderers.component,
    [COORDINATOR_ROUTE]: CoordinatorRoute,
    "task-board-meta": TaskBoardMeta,
    [RECEIVED_MESSAGE_COMPONENT]: ReceivedMessage,
  },
};
