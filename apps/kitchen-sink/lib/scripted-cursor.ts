/**
 * A scripted Cursor for test mode: the Cursor SDK's `Agent` replaced, through
 * the block's own `resolveCursorClient` seam, by a script that answers in the
 * SDK's own message shapes. Everything past the seam is the real block: its
 * translation, items, plan record, `resume` and `onSession`.
 *
 * Server only, and only under `KITCHEN_SINK_TEST_MODE=1` (see
 * `lib/cursor-mode.ts`). No model, no process, no network.
 *
 * A turn's prompt may carry directives in square brackets, so a browser test
 * can drive each path:
 *
 * | Directive | What the script does |
 * |---|---|
 * | (none) | opens the agent (the asked one, or a new one), streams a reply with a pause, finishes |
 * | `[plan]` | also sends a to-do update naming two items, which Cursor confirms as the whole list of four |
 * | `[plan-fail]` | also sends a to-do update Cursor rejects, so nothing is recorded |
 * | `[plan-empty]` | also sends a to-do update Cursor confirms as an empty list |
 * | `[slow]` | after the reply and the plan have shown, holds long enough for a stop to land |
 * | `[refuse]` | refuses the asked agent the way Cursor does: `Agent.resume` throws `agent_not_found` |
 * | `[fail]` | opens the agent, then the run's stream fails with another error |
 * | `[errored]` | opens the agent and streams its reply, then Cursor reports the run as errored (a result, not a throw) |
 * | `[fail-early]` | fails before opening any agent |
 * | `[steer-refuse]` | the run answers a steer the way a run that can't take one does: "send it as a follow-up" |
 *
 * Every run has a `steer`, as a local Cursor run does: while its stream runs
 * it takes a line into the turn and answers `complete_delivered`; after, or
 * under `[steer-refuse]`, it answers `revert_to_followup`.
 * The reply names how many turns the agent has had, which is how a test sees
 * a second turn continue the first's agent.
 */
import type {
  CursorAgentLike,
  CursorRunLike,
  CursorRunResult,
  CursorSdkMessage,
  ResolveCursorClient,
} from "@flow-state-dev/cursor";

import { scriptedReceived } from "./scripted-received";

/**
 * The script's pauses, in milliseconds: between steps, and the long one a
 * `[slow]` turn takes, long enough to press stop. Unit tests shorten them.
 */
export const scriptedCursorPauses = { stepMs: 400, slowMs: 20_000 };

/** The to-do update the script sends: two of the four items, which alone can't be placed. */
const PARTIAL_UPDATE = [
  { content: "Read the request", status: "completed" },
  { content: "Answer it", status: "inProgress" },
];

/** The whole list Cursor confirms after that update. */
export const SCRIPTED_WHOLE_LIST = [
  { content: "Read the request", status: "completed" },
  { content: "Answer it", status: "inProgress" },
  { content: "Check the answer", status: "pending" },
  { content: "Say what changed", status: "pending" },
] as const;

/** One scripted Cursor's agents: turns per agent, and how many it has opened. */
interface Agents {
  readonly turns: Map<string, number>;
  minted: number;
}

/** A pause that ends early when the run is cancelled. */
async function pause(ms: number, cancelled: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (cancelled.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    cancelled.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** The error Cursor's SDK throws when it doesn't know the agent, as its code reaches the block. */
function agentNotFound(agentId: string): Error {
  const error = new Error(`Agent ID not found: ${agentId}`) as Error & { code: string };
  error.name = "AgentNotFoundError";
  error.code = "agent_not_found";
  return error;
}

/** The settled `updateTodos` call: the partial update as its args, and `list` as the whole list on success. */
function todos(callId: string, status: "completed" | "error", list: readonly { content: string; status: string }[]): CursorSdkMessage {
  return {
    type: "tool_call",
    call_id: callId,
    name: "updateTodos",
    status,
    args: { todos: PARTIAL_UPDATE },
    result:
      status === "completed"
        ? { status: "success", value: { todos: list, totalCount: list.length } }
        : { status: "error", error: { message: "scripted to-do store unavailable" } },
  };
}

/** One run of the scripted agent: its messages, and how it ended. */
function scriptedRun(agentId: string, turn: number, prompt: string): CursorRunLike {
  const has = (directive: string) => prompt.includes(`[${directive}]`);
  const cancel = new AbortController();
  const step = scriptedCursorPauses.stepMs;
  const reply = `Scripted Cursor, turn ${turn} of agent ${agentId}.`;
  let outcome: CursorRunResult = { status: "finished", result: reply };

  async function* stream(): AsyncGenerator<CursorSdkMessage> {
    yield { type: "system", subtype: "init", model: { id: "composer-2.5" } };
    yield { type: "status", status: "RUNNING" };
    await pause(step, cancel.signal);
    if (has("fail")) throw new Error("scripted failure after Cursor opened the agent");
    if (has("plan") || has("plan-fail") || has("plan-empty")) {
      yield { type: "tool_call", call_id: "todo_1", name: "updateTodos", status: "running", args: { todos: PARTIAL_UPDATE } };
      await pause(step, cancel.signal);
      if (has("plan")) yield todos("todo_1", "completed", SCRIPTED_WHOLE_LIST);
      if (has("plan-fail")) yield todos("todo_1", "error", []);
      if (has("plan-empty")) yield todos("todo_1", "completed", []);
    }
    yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } };
    yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 } };
    // A slow turn holds here, after its reply and plan have shown and its agent is confirmed.
    await pause(has("slow") ? scriptedCursorPauses.slowMs : step, cancel.signal);
    if (cancel.signal.aborted) {
      outcome = { status: "cancelled" };
      return;
    }
    if (has("errored")) {
      outcome = { status: "error", error: { message: "scripted run Cursor reports as errored" } };
      yield { type: "status", status: "ERROR", message: "scripted run Cursor reports as errored" };
      return;
    }
    yield { type: "status", status: "FINISHED" };
  }

  let finished!: () => void;
  let running = true;
  const ended = new Promise<void>((resolve) =>
    (finished = () => {
      running = false;
      resolve();
    }),
  );
  async function* streamed(): AsyncGenerator<CursorSdkMessage> {
    try {
      yield* stream();
    } finally {
      finished();
    }
  }
  return {
    id: `run-scripted-${turn}`,
    stream: streamed,
    // The SDK's terminal record, once the stream has ended.
    wait: async () => {
      await ended;
      return outcome;
    },
    cancel: async () => {
      cancel.abort();
    },
    steer: async (text: string) => {
      if (!running || cancel.signal.aborted || has("steer-refuse")) return "revert_to_followup";
      scriptedReceived.push(text);
      return "complete_delivered";
    },
  };
}

/**
 * A scripted Cursor, for `cursorAgent`'s `resolveCursorClient`. Each one keeps
 * its own agents, for as long as the block holding it.
 */
export function scriptedCursor(): ResolveCursorClient {
  const agents: Agents = { turns: new Map(), minted: 0 };
  const open = (agentId: string): CursorAgentLike => ({
    agentId,
    send: async (prompt) => {
      const turn = (agents.turns.get(agentId) ?? 0) + 1;
      agents.turns.set(agentId, turn);
      scriptedReceived.push(prompt);
      return scriptedRun(agentId, turn, prompt);
    },
  });
  // Cursor's seam hands `create` and `resume` no prompt: the block sends it
  // after `onSession`. So the two directives that act before an agent opens,
  // `[refuse]` and `[fail-early]`, are read off the turn's own input, which the
  // block context carries as its parent's.
  return (ctx) => {
    const prompt = promptOf(ctx);
    return {
      create: async () => {
        if (prompt.includes("[fail-early]")) throw new Error("scripted failure before Cursor opened an agent");
        agents.minted += 1;
        return open(`scripted-cursor-${Date.now().toString(36)}-${agents.minted}`);
      },
      resume: async (agentId) => {
        if (prompt.includes("[fail-early]")) throw new Error("scripted failure before Cursor opened an agent");
        if (prompt.includes("[refuse]")) throw agentNotFound(agentId);
        return open(agentId);
      },
    };
  };
}

/** The turn's prompt: the input the block's parent (the session flow's turn) was called with. */
function promptOf(ctx: unknown): string {
  const input = (ctx as { parent?: { input?: { prompt?: unknown } } } | undefined)?.parent?.input;
  return typeof input?.prompt === "string" ? input.prompt : "";
}
