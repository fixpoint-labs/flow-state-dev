/**
 * Item factories for the goal's host page.
 *
 * Copied into the host beside `main.tsx`. Shapes follow the `@flow-state-dev/ui`
 * Storybook fixtures, kept separate on purpose: the host is an app that
 * installed the registry, and an app has no access to the registry's stories.
 */
import type {
  ComponentItem,
  ContainerItem,
  MessageItem,
  OutputItem,
  ReasoningItem,
  SuspensionItem,
  SuspensionResumeItem,
  ToolOutputItem,
} from "@flow-state-dev/core/items";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

const provenance = (blockInstanceId = "b1") => ({ blockName: "gen", blockInstanceId, phase: "main" as const });

const base = (type: string, requestId: string) => ({
  id: nextId(type),
  type,
  status: "completed" as const,
  requestId,
  itemIndex: 0,
  ts: 0,
  provenance: provenance(),
});

export function message(role: "user" | "assistant", text: string, extra: Partial<MessageItem> = {}): MessageItem {
  return {
    ...base("message", "req-1"),
    type: "message",
    role,
    content: [{ type: "output_text", text }],
    ...extra,
  } as MessageItem;
}

export function reasoning(text: string, status: "completed" | "in_progress"): ReasoningItem {
  return {
    ...base("reasoning", "req-1"),
    type: "reasoning",
    status,
    summary: [{ type: "reasoning_text", text }],
  } as ReasoningItem;
}

export function tool(
  name: string,
  args: unknown,
  output: unknown,
  status: ToolOutputItem["status"],
  extra: Partial<ToolOutputItem> = {},
  requestId = "req-1"
): ToolOutputItem {
  const id = nextId("tool");
  return {
    ...base("tool_output", requestId),
    id,
    type: "tool_output",
    status,
    blockName: name,
    output,
    toolCall: { callId: `c-${id}`, name, arguments: JSON.stringify(args), generatorBlock: "gen" },
    ...extra,
  } as ToolOutputItem;
}

export function component(name: string, data: Record<string, unknown>, requestId = "req-1", extra: Record<string, unknown> = {}): ComponentItem {
  return { ...base("component", requestId), type: "component", component: name, data, ...extra } as ComponentItem;
}

export function container(component: string, requestId: string, blockInstanceId: string, status: "completed" | "in_progress"): ContainerItem {
  return {
    ...base("container", requestId),
    type: "container",
    status,
    blockName: component,
    component,
    provenance: provenance(blockInstanceId),
  } as ContainerItem;
}

export function suspension(options: {
  suspensionId: string;
  message: string;
  reason?: "human_approval" | "human_input";
  resumeSchema?: Record<string, unknown>;
  allow?: string[];
}): SuspensionItem {
  return {
    ...base("suspension", "req-1"),
    type: "suspension",
    suspensionId: options.suspensionId,
    suspensionStatus: "pending",
    reason: options.reason ?? "human_approval",
    message: options.message,
    ...(options.resumeSchema ? { resumeSchema: options.resumeSchema } : {}),
    ...(options.allow ? { allow: options.allow } : {}),
  } as SuspensionItem;
}

export function resume(suspensionId: string, resolution: string): SuspensionResumeItem {
  return {
    ...base("suspension_resume", "req-1"),
    type: "suspension_resume",
    suspensionId,
    resolution,
    resolvedAt: 0,
  } as SuspensionResumeItem;
}

/** One board with one task in `status`, as the stream carries it. */
export function board(collectionId: string, boardStatus: string, tasks: Array<Record<string, unknown>>): OutputItem[] {
  return [
    component("task-board-meta", { collectionId, status: boardStatus }, "req-tasks", { key: collectionId }),
    ...tasks.map((task) =>
      component("task-change", { collectionId, taskId: task.id, task }, "req-tasks", { key: `${collectionId}/${task.id}` })
    ),
  ];
}

/** Findings for one audit card whose highest severity is `severity`. */
export function audit(severity: "info" | "warning" | "critical"): ComponentItem {
  return component("audit-annotation", {
    results: [],
    overallScore: 0.6,
    surfacedResults: [
      {
        analyzerId: "claims",
        category: "accuracy",
        score: 0.6,
        shouldSurface: true,
        annotations: [
          { type: "claim", label: `A ${severity} finding`, severity, description: "What the auditor saw.", evidence: "The sentence it saw it in." },
        ],
      },
    ],
  });
}

/** A debate: in progress (a debater composing) or finished (a verdict). */
export function debate(requestId: string, finished: boolean): { item: ContainerItem; items: OutputItem[] } {
  const item = container("debate", requestId, `debate-${requestId}`, finished ? "completed" : "in_progress");
  const items: OutputItem[] = [
    tool("web_search", { query: "four-day week" }, { results: [{ title: "A study", url: "https://example.com/a" }] }, "completed", { agentName: "debate-moderator" } as never, requestId),
    component("debate-decision", { round: 1, nextSpeakers: ["pro", "con"], briefing: "Open with evidence.", newAngle: null, done: false }, requestId),
    component("debate-turn", { round: 1, agentName: "pro", stance: "for", text: "Output held steady." }, requestId),
    component("debate-turn", { round: 1, agentName: "con", stance: "against", text: "The sample was small." }, requestId),
  ];
  if (finished) {
    items.push(component("debate-verdict", { verdict: "Pro made the stronger case.", winner: "pro", reasoning: "Better evidence." }, requestId));
  } else {
    items.push(component("debate-decision", { round: 2, nextSpeakers: ["pro"], briefing: null, newAngle: "Cost", done: false }, requestId));
    items.push(component("debate-turn-pending", { round: 2, agentName: "pro", stance: "for" }, requestId));
    items.push(message("assistant", "Drafting a reply", { agentName: "pro", requestId } as never));
  }
  return { item, items };
}

/** Evented actors: in progress (the analyst working) or finished (all three reported). */
export function eventedActors(requestId: string, finished: boolean): { item: ContainerItem; items: OutputItem[] } {
  const item = container("evented-actors", requestId, `ea-${requestId}`, finished ? "completed" : "in_progress");
  const items: OutputItem[] = [
    tool("web_search", { query: "tide tables" }, { results: [{ title: "Tides", url: "https://example.com/t" }] }, "completed", {}, requestId),
    component("rb-entry", { type: "observation", topic: "Tides", body: "Two a day." }, requestId),
  ];
  if (finished) {
    items.push(component("rb-entry", { type: "finding", topic: "Pattern", body: "Lunar." }, requestId));
    items.push(component("rb-entry", { type: "challenge", topic: "Caveat", body: "Local effects." }, requestId));
  }
  return { item, items };
}

/** Routed specialists: working (a specialist picked) or done. */
export function routedSpecialists(requestId: string, done: boolean): { item: ContainerItem; items: OutputItem[] } {
  const blockInstanceId = `rs-${requestId}`;
  const item = container("routed-specialists", requestId, blockInstanceId, done ? "completed" : "in_progress");
  const state = component(
    "routed-specialists",
    { state: { summary: "Refund approved", owner: "billing" }, iteration: 2, specialist: done ? null : "billing", done },
    requestId,
    { ownedBy: blockInstanceId }
  );
  return { item, items: [state] };
}
