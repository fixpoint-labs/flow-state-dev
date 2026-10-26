"use client";

/**
 * Tool call rendering for block_trace and tool_output items.
 *
 * A call is a muted line with a chevron. A run is one line, labelled from
 * each call's stated intent, or the name-based phrase when none stated one.
 * Running ends in "…", waiting says "(waiting)", failure says "(failed)" in
 * words and stays muted: a failed call is routine, not an alarm on the run.
 * No status badge on the line.
 *
 * An agent's working, the tool calls and the thinking between the things it
 * says, is one stretch: consecutive `tool_output` and `reasoning` items are
 * wrapped via ItemsRenderer's `toolGroupRenderer`. Collapsed, the line says what
 * the agent is doing now ("Reading foo.ts…", "Thinking…"); settled, it
 * summarizes the calls. It opens to every step in order.
 */

import { Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import { isSuspensionWait, type BlockTraceItem, type ReasoningItem, type ToolOutputItem } from "@flow-state-dev/core/items";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleIcon,
  ClockIcon,
  XCircleIcon,
} from "lucide-react";

import { CodeBlock } from "./code-block";
import { composeToolCallsLabel } from "./tool-grouping";
import { toolIntent, toolSubject } from "./tool-naming";

export {
  composeToolCallsLabel,
  composeToolGroupLabel,
  TOOL_GROUP_DISTINCT_CAP,
  TOOL_GROUP_INTENT_CAP,
  TOOL_VERB_MAP,
  type ToolCallLabelInput,
  type ToolVerbs,
} from "./tool-grouping";
export { toolIntent } from "./tool-naming";

/**
 * Framework-agnostic tool execution state.
 * Replaces the AI SDK ToolUIPart["state"] with neutral vocabulary.
 */
export type ToolState =
  | "pending"      // not yet started
  | "streaming"    // input being received
  | "running"      // executing
  | "awaiting"     // needs user approval
  | "completed"    // finished successfully
  | "error"        // failed
  | "denied";      // user rejected

const statusLabels: Record<ToolState, string> = {
  pending: "Pending",
  streaming: "Receiving input…",
  running: "Running…",
  awaiting: "Awaiting approval",
  completed: "Completed",
  error: "Error",
  denied: "Denied",
};

const statusIcons: Record<ToolState, ReactNode> = {
  pending: <CircleIcon className="size-4" />,
  streaming: <ClockIcon className="size-4 animate-pulse" />,
  running: <ClockIcon className="size-4 animate-pulse" />,
  awaiting: <ClockIcon className="size-4 bg-attention text-attention-foreground" />,
  completed: <CheckCircleIcon className="size-4 text-success" />,
  error: <XCircleIcon className="size-4 text-destructive" />,
  denied: <XCircleIcon className="size-4 text-warning" />,
};

export const getStatusBadge = (state: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[state]}
    {statusLabels[state]}
  </Badge>
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: unknown;
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output?: unknown;
  errorText?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      {/* A failed call is routine for an agent (a search with no match exits
          non-zero), so its output reads like any other result. */}
      <div className="overflow-x-auto rounded-md bg-muted/50 text-foreground text-xs [&_table]:w-full">
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};

type ToolItem = BlockTraceItem | ToolOutputItem | ReasoningItem;

/** A thought in the stretch, not a call. */
function isThought(item: ToolItem): item is ReasoningItem {
  return item.type === "reasoning";
}

/** The thought's text, its summary parts joined. */
function thoughtText(item: ReasoningItem): string {
  return item.summary.map((part) => (part as { text?: string }).text ?? "").join("");
}

/** Longest thought shown on the status line. */
const THOUGHT_LINE_MAX = 80;

/** The thought's first line, bare of markdown emphasis and clipped, or undefined when it has no text. */
function thoughtLine(item: ReasoningItem): string | undefined {
  const first = thoughtText(item)
    .split("\n")
    .map((line) => line.replace(/^[\s#>*_-]+|[\s*_]+$/g, "").replace(/\s+/g, " "))
    .find((line) => line !== "");
  if (first === undefined) return undefined;
  return first.length > THOUGHT_LINE_MAX ? `${first.slice(0, THOUGHT_LINE_MAX - 1)}…` : first;
}

/** A call waiting on an approval or a question is `awaiting`, not `error` (`isSuspensionWait`). */
function mapToolStatus(item: ToolItem): ToolState {
  if (isSuspensionWait(item)) return "awaiting";
  switch (item.status) {
    case "in_progress": return "running";
    case "completed": return "completed";
    case "failed": return "error";
    case "incomplete": return "pending";
    default: return "pending";
  }
}

function getToolName(item: Exclude<ToolItem, ReasoningItem>): string {
  if (item.type === "tool_output") return item.toolCall.name;
  return item.blockName;
}

function getToolArgs(item: ToolItem): unknown {
  if (isThought(item)) return undefined;
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Extract the raw tool payload. `tool_output.output` is always raw.
 * `block_trace.output` is a BlockValue discriminated union (FIX-413); for
 * tool-call items the generator is a leaf, so we only see the `inline` case.
 */
function unwrapToolOutput(item: ToolItem): unknown {
  if (isThought(item)) return undefined;
  if (item.type === "tool_output") return item.output;
  const value = item.output;
  if (value !== undefined && typeof value === "object" && "kind" in value && value.kind === "inline") {
    return (value as { value: unknown }).value;
  }
  return undefined;
}

function getToolOutput(item: ToolItem): unknown {
  if (item.status === "failed") return undefined;
  return unwrapToolOutput(item);
}

function getToolErrorText(item: ToolItem): string | undefined {
  if (isThought(item) || item.status !== "failed" || isSuspensionWait(item)) return undefined;
  if (item.type === "tool_output" && item.error) return item.error.message;
  const raw = unwrapToolOutput(item);
  return raw === undefined ? undefined : String(raw);
}

type LineState = "running" | "waiting" | "completed" | "error";

function lineState(item: ToolItem): LineState {
  // A thought that ended unfinished (a stream that dropped mid-thought) is over, not still going.
  if (isThought(item)) return item.status === "in_progress" ? "running" : "completed";
  const state = mapToolStatus(item);
  if (state === "error") return "error";
  if (state === "awaiting") return "waiting";
  if (state === "completed") return "completed";
  return "running";
}

function runState(items: readonly ToolItem[]): LineState {
  const states = items.map(lineState);
  if (states.includes("error")) return "error";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("running")) return "running";
  return "completed";
}

function labelInput(item: Exclude<ToolItem, ReasoningItem>) {
  const name = getToolName(item);
  const args = getToolArgs(item);
  const subject = toolSubject(name, args);
  return { name, intent: toolIntent(name, args), subject };
}

/** "Thinking" while it goes on, "Thought" once it has. */
const thoughtWord = (state: LineState) => (state === "running" ? "Thinking" : "Thought");

function ToolCallDetails({ item }: { item: ToolItem }) {
  if (isThought(item)) {
    const text = thoughtText(item);
    return (
      <p className="whitespace-pre-wrap text-muted-foreground text-xs">
        {text === "" ? "No thought text." : text}
      </p>
    );
  }
  const args = getToolArgs(item);
  const output = getToolOutput(item);
  const errorText = getToolErrorText(item);
  const entries: Array<[string, string]> = [];
  if (item.blockName) entries.push(["Block", item.blockName]);
  entries.push(["Item", item.id]);

  return (
    <div className="space-y-3">
      {args !== undefined && <ToolInput input={args} />}
      {item.status !== "in_progress" && (output !== undefined || errorText !== undefined) && (
        <ToolOutput output={output} errorText={errorText} />
      )}
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

type ToolLineProps = {
  label: string;
  state: LineState;
  nested?: boolean;
  mono?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
};

function ToolLine({ label, state, nested = false, mono = false, defaultOpen = false, className, children }: ToolLineProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      data-testid={nested ? "tool-row" : "tool-group"}
      data-state-kind={state}
      // Named apart, so an open group doesn't turn its closed rows' chevrons.
      className={cn("not-prose w-full", nested ? "group/tool-row" : "group/tool mb-2", className)}
    >
      <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-muted-foreground text-sm hover:text-foreground">
        <span className={cn("truncate", mono && "font-mono")}>
          {label}
        </span>
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            nested ? "group-data-[state=open]/tool-row:rotate-90" : "group-data-[state=open]/tool:rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 outline-none">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function withState(label: string, state: LineState, count = 1, total = 1): string {
  if (state === "running") return `${label}…`;
  if (state === "error" || state === "waiting") {
    const word = state === "error" ? "failed" : "waiting";
    return total > 1 ? `${label} (${count} ${word})` : `${label} (${word})`;
  }
  return label;
}

/** One call. A missing tool call renders nothing. */
export function Tool({ item }: { item: BlockTraceItem | ToolOutputItem }) {
  if (!item.toolCall) return null;
  return <ToolGroup items={[item]} />;
}

export type ToolGroupProps = {
  items: readonly ToolItem[];
  /** Default-open state. Defaults to false (collapsed). */
  defaultOpen?: boolean;
  /**
   * The agent is still working after the last of these items. The line then
   * names the latest step, even between calls when none is running, and gives
   * way to the run's summary once the work is over.
   */
  live?: boolean;
  className?: string;
};

/** The call in flight, named by what it is doing. */
function nowLabel({ name, intent, subject }: ReturnType<typeof labelInput>): string {
  return composeToolCallsLabel([{ name, intent: intent ?? subject?.text }]);
}

/** One call opens to its details. While a run is going, the line names the call in flight. */
export function ToolGroup({ items, defaultOpen = false, live = false, className }: ToolGroupProps) {
  if (items.length === 0) return null;

  const state = runState(items);
  const calls = items.filter((item): item is Exclude<ToolItem, ReasoningItem> => !isThought(item));
  const inputs = calls.map(labelInput);
  const one = items.length === 1;

  // The calls say what the stretch was; a stretch of thinking alone says so.
  // One call is named by what it did; several are summarised by what they did.
  // A settled run of calls stays a count of what was done, so only a single call, and the step
  // in flight, are named by their subject.
  const only = one && calls.length === 1 ? labelInput(calls[0]!) : undefined;
  const summary =
    only !== undefined
      ? composeToolCallsLabel([{ name: only.name, intent: only.intent ?? only.subject?.text }])
      : calls.length > 0
        ? composeToolCallsLabel(inputs)
        : thoughtWord(state);

  let label: string;
  if (live || (!one && state === "running")) {
    // What the agent is doing now: the latest step still going, else (while
    // live, between calls) the latest step there is.
    let current = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (lineState(items[i]!) === "running") {
        current = i;
        break;
      }
    }
    if (current < 0 && live) current = items.length - 1;
    const now = current >= 0 ? items[current]! : undefined;
    const nowState = now === undefined ? state : lineState(now);
    label =
      now === undefined
        ? withState(summary, state)
        : isThought(now)
          ? withState(thoughtLine(now) ?? thoughtWord(nowState), nowState)
          : withState(nowLabel(labelInput(now)), nowState);
  } else {
    const count = one ? 1 : items.filter((item) => lineState(item) === state).length;
    label = withState(summary, state, count, items.length);
  }

  return (
    <ToolLine label={label} state={state} defaultOpen={defaultOpen} className={className}>
      {one ? (
        <ToolCallDetails item={items[0]!} />
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <ToolRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </ToolLine>
  );
}

export type ToolRowProps = {
  item: ToolItem;
  defaultOpen?: boolean;
  className?: string;
};

/** What the call stated or did (its intent, else its subject), else the tool name. A shell command is in mono. */
export function ToolRow({ item, defaultOpen = false, className }: ToolRowProps) {
  const state = lineState(item);
  const { name, intent, subject } = isThought(item)
    ? { name: thoughtWord(state), intent: undefined, subject: undefined }
    : labelInput(item);
  return (
    <ToolLine
      label={withState(intent ?? subject?.text ?? name, state)}
      state={state}
      nested
      mono={intent === undefined && (subject?.code ?? !isThought(item))}
      defaultOpen={defaultOpen}
      className={className}
    >
      <ToolCallDetails item={item} />
    </ToolLine>
  );
}
