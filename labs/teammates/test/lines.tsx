/**
 * Items as the server stores them, and their lines as React's conversation
 * model reads them, for the tests that draw a conversation's lines. The lab
 * turns no item into a line itself: every line here is `conversationLines`'.
 */
import { conversationLines, type ItemLine, type LineTurn } from "@flow-state-dev/react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { FlowProvider } from "@flow-state-dev/react";
import { render } from "@testing-library/react";
import { Line, teammatesRenderers } from "../src/components/lines";
import { LineContext, type LineContextValue } from "../src/components/flow-state/conversation-lines";
import { TestProvider } from "./stub-server";
import { FILED_TASK_DATA_TYPE, RECEIVED_MESSAGE_DATA_TYPE, SENT_MESSAGE_DATA_TYPE, TASK_RESULT_DATA_TYPE } from "@flow-state-dev/workforce/browser";

const provenance = { blockName: "worker", blockInstanceId: "worker", phase: "main" };
const base = (id: string, requestId: string, status = "completed") => ({ id, requestId, status, itemIndex: 0, ts: 0, provenance });

/** What you said, or what the worker said. */
export const message = (id: string, requestId: string, role: "user" | "assistant", text: string, status = "completed") => ({
  ...base(id, requestId, status),
  type: "message",
  role,
  content: [{ type: role === "user" ? "input_text" : "output_text", text }],
});

/** A tool call the worker made. */
export const call = (id: string, requestId: string, name: string, args: Record<string, unknown> = {}, status = "completed", output: unknown = {}) => ({
  ...base(id, requestId, status),
  type: "tool_output",
  toolCall: { callId: `c-${id}`, name, arguments: JSON.stringify(args) },
  output,
});

/** What the worker thought, between its calls. */
export const thought = (id: string, requestId: string) => ({ ...base(id, requestId), type: "reasoning", summary: [{ type: "reasoning_text", text: "hm" }] });

/** A call parked on your answer. */
export const parked = (id: string, requestId: string, name: string) => ({ ...call(id, requestId, name, {}, "failed"), error: { code: "SUSPENSION", message: "waits on you" } });

/** An `error` item, as the engine writes one for a failed request. */
export const failure = (id: string, requestId: string, message: string, code = "PROVIDER_ERROR") => ({ ...base(id, requestId, "failed"), type: "error", message, code });

/** A `data` item of `dataType`. */
const data = (id: string, requestId: string, dataType: string, value: unknown) => ({ ...base(id, requestId), type: "data", dataType, value });

/** Workforce's lines, as the server writes them. */
export const sent = (id: string, requestId: string, value: Record<string, unknown>) => data(id, requestId, SENT_MESSAGE_DATA_TYPE, value);
export const received = (id: string, requestId: string, value: Record<string, unknown>) => data(id, requestId, RECEIVED_MESSAGE_DATA_TYPE, value);
export const filed = (id: string, requestId: string, value: Record<string, unknown>) => data(id, requestId, FILED_TASK_DATA_TYPE, value);
export const result = (id: string, requestId: string, value: Record<string, unknown>) => data(id, requestId, TASK_RESULT_DATA_TYPE, value);

/** A board pass's task change: a record, drawn as nothing. */
export const boardPass = (id: string, requestId: string) => data(id, requestId, "task-change", { task: { id: "t1", status: "pending" } });

/** A user's approval stop (under `reason`, the current one unless a test reads a stored older one), and its answer. */
export const approval = (id: string, requestId: string, suspensionId: string, text: string, reason = "user_approval") => ({ ...base(id, requestId), type: "suspension", reason, suspensionId, message: text });
export const answered = (id: string, requestId: string, suspensionId: string, resolution: string) => ({ ...base(id, requestId), type: "suspension_resume", suspensionId, resolution });

/** `items`' lines, as the model reads them with `turns` and the lab's registry, as the lab reads them. */
export const linesOf = (items: readonly object[], turns: readonly LineTurn[] = []): ItemLine[] =>
  conversationLines(items as unknown as OutputItem[], turns, { renderers: teammatesRenderers });

/** `lines` drawn as the conversation draws them, on a screen with `screen`'s line context, over an app with no data. */
export function LinesOf({ lines, screen = {} }: { lines: readonly ItemLine[]; screen?: LineContextValue }) {
  return (
    <TestProvider>
      <FlowProvider renderers={teammatesRenderers}>
        <LineContext.Provider value={screen}>
          {lines.map((line) => (
            <Line key={line.id} line={line} />
          ))}
        </LineContext.Provider>
      </FlowProvider>
    </TestProvider>
  );
}

/** {@link LinesOf}, rendered. */
export const drawLines = (lines: readonly ItemLine[], screen: LineContextValue = {}) => render(<LinesOf lines={lines} screen={screen} />);
