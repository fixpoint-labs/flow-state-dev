/**
 * Typed factories for `OutputItem` shapes used in Storybook stories.
 *
 * These fixtures are story-only — they're not exported from the package's
 * public surface. They mirror the inline factories used in the framework's
 * unit tests so stories and tests stay in shape parity.
 */
import type {
  ComponentItem,
  MessageItem,
  ReasoningItem,
  SourceItem,
  ToolOutputItem,
} from "@flow-state-dev/core/items";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

const baseProvenance = {
  blockName: "gen",
  blockInstanceId: "b1",
  phase: "main" as const,
};

export type MessageRole = MessageItem["role"];

export type MessageItemOptions = {
  id?: string;
  role?: MessageRole;
  text?: string;
  requestId?: string;
  status?: MessageItem["status"];
  itemIndex?: number;
};

export function messageItem(options: MessageItemOptions = {}): MessageItem {
  const {
    id = nextId("m"),
    role = "assistant",
    text = "",
    requestId = "req-1",
    status = "completed",
    itemIndex = 0,
  } = options;
  return {
    id,
    type: "message",
    status,
    requestId,
    itemIndex,
    ts: 0,
    provenance: baseProvenance,
    role,
    content: [{ type: "output_text", text }],
  };
}

export type ReasoningItemOptions = {
  id?: string;
  text?: string;
  requestId?: string;
  status?: ReasoningItem["status"];
};

export function reasoningItem(options: ReasoningItemOptions = {}): ReasoningItem {
  const {
    id = nextId("r"),
    text = "",
    requestId = "req-1",
    status = "completed",
  } = options;
  return {
    id,
    type: "reasoning",
    status,
    requestId,
    itemIndex: 0,
    ts: 0,
    provenance: baseProvenance,
    summary: [{ type: "reasoning_text", text }],
  };
}

export type ToolItemOptions = {
  id?: string;
  name?: string;
  args?: unknown;
  output?: unknown;
  status?: ToolOutputItem["status"];
  requestId?: string;
};

export function toolItem(options: ToolItemOptions = {}): ToolOutputItem {
  const {
    id = nextId("t"),
    name = "web_search",
    args = {},
    output = null,
    status = "completed",
    requestId = "req-1",
  } = options;
  return {
    id,
    type: "tool_output",
    status,
    requestId,
    itemIndex: 0,
    ts: 0,
    provenance: baseProvenance,
    blockName: name,
    output,
    toolCall: {
      callId: `c-${id}`,
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
      generatorBlock: "gen",
    },
  };
}

export type ComponentItemOptions = {
  id?: string;
  component: string;
  data?: Record<string, unknown>;
  key?: string;
  requestId?: string;
};

export function componentItem(options: ComponentItemOptions): ComponentItem {
  const {
    id = nextId("c"),
    component,
    data = {},
    key,
    requestId = "req-1",
  } = options;
  return {
    id,
    type: "component",
    status: "completed",
    requestId,
    itemIndex: 0,
    ts: 0,
    provenance: baseProvenance,
    component,
    data,
    ...(key !== undefined ? { key } : {}),
  };
}

export type SourceItemOptions = {
  id?: string;
  url: string;
  title?: string;
  requestId?: string;
};

export function sourceItem(options: SourceItemOptions): SourceItem {
  const {
    id = nextId("s"),
    url,
    title,
    requestId = "req-1",
  } = options;
  return {
    id,
    type: "source",
    status: "completed",
    requestId,
    itemIndex: 0,
    ts: 0,
    provenance: baseProvenance,
    sourceType: "url",
    sourceId: id,
    url,
    ...(title !== undefined ? { title } : {}),
  };
}
