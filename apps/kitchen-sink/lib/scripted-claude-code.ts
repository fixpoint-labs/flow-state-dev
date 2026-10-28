/**
 * A scripted Claude Code for test mode: the Agent SDK's `query` replaced, through
 * the block's own `resolveClaudeAgent` seam, by a script that answers in the
 * SDK's own message shapes. Everything past the seam is the real block: its
 * translation, items, plan record, `resume` and `onSession`.
 *
 * Server only, and only under `KITCHEN_SINK_TEST_MODE=1` (see
 * `lib/claude-code-mode.ts`). No model, no process, no network.
 *
 * A turn's prompt may carry directives in square brackets, so a browser test
 * can drive each path:
 *
 * | Directive | What the script does |
 * |---|---|
 * | (none) | names the conversation (the asked one, or a new one), streams a reply with a pause, succeeds |
 * | `[plan]` | also records two to-do items and moves the first to `in_progress`, when the run is offered the to-do tools (see below) |
 * | `[plan-next]` | moves on through that plan by id alone, the way a later turn does: the first item to `completed`, the second to `in_progress` |
 * | `[bash]` | also runs five shell commands, each with its `description` |
 * | `[slow]` | after the reply and plan have shown, holds long enough for a stop to land |
 * | `[slow-start]` | pauses before naming the conversation, so a stop lands before it is confirmed |
 * | `[new]` | names a new conversation even when asked to continue one |
 * | `[refuse]` | refuses the asked conversation the way Claude Code does: a `result` naming it, then the SDK's throw |
 * | `[fail]` | names the conversation, then fails with another error |
 * | `[fail-early]` | fails before naming any conversation |
 * | `[errored]` | names the conversation and streams its reply, then ends on a `result` Claude Code marks as an error (a result, not a throw) |
 *
 * The reply names how many turns the conversation has had, which is how a
 * test sees a second turn continue the first's conversation.
 */
import type { ClaudeAgentQueryOptions, ResolveClaudeAgent, SdkMessageLike } from "@flow-state-dev/claude-code/sdk";

import { scriptedReceived } from "./scripted-received";

/**
 * The script's pauses, in milliseconds: between steps, and the long one a
 * `[slow]` or `[slow-start]` turn takes, long enough to press stop. Unit tests
 * shorten them.
 */
export const scriptedPauses = { stepMs: 400, slowMs: 20_000 };

/** Claude Code's gate: it offers its to-do tools only when `allowedTools` names one. */
const PLAN_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TodoWrite"]);

/** One scripted Claude Code's conversations: turns per conversation, and how many it has started. */
interface Conversations {
  readonly turns: Map<string, number>;
  minted: number;
}

/** A pause that ends the run when it is stopped, as the SDK does: by throwing the stop's reason. */
async function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
  if (signal?.aborted) throw signal.reason ?? new Error("The run was stopped.");
}

function textDelta(text: string): SdkMessageLike {
  return { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } } as SdkMessageLike;
}

function toolUse(id: string, name: string, input: Record<string, unknown>): SdkMessageLike {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } } as SdkMessageLike;
}

function toolResult(id: string, result: Record<string, unknown>, content: string): SdkMessageLike {
  return {
    type: "user",
    tool_use_result: result,
    message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
  } as SdkMessageLike;
}

/** The scripted turn, as SDK messages. */
async function* scriptedTurn(
  conversations: Conversations,
  prompt: string,
  options: ClaudeAgentQueryOptions | undefined,
): AsyncGenerator<SdkMessageLike> {
  const signal = options?.abortController?.signal;
  const has = (directive: string) => prompt.includes(`[${directive}]`);
  const asked = options?.resume;
  const step = scriptedPauses.stepMs;
  scriptedReceived.push(prompt);

  if (has("fail-early")) throw new Error("scripted failure before Claude Code named a conversation");
  if (has("slow-start")) await pause(scriptedPauses.slowMs, signal);

  if (has("refuse") && asked !== undefined) {
    const refusal = `No conversation found with session ID: ${asked}`;
    yield { type: "result", subtype: "error_during_execution", is_error: true, session_id: asked, errors: [refusal] } as SdkMessageLike;
    throw new Error(`Claude Code returned an error result: ${refusal}`);
  }

  const sessionId = asked !== undefined && !has("new") ? asked : `scripted-${Date.now().toString(36)}-${(conversations.minted += 1)}`;
  const turn = (conversations.turns.get(sessionId) ?? 0) + 1;
  conversations.turns.set(sessionId, turn);
  yield { type: "system", subtype: "init", session_id: sessionId } as SdkMessageLike;
  await pause(step, signal);

  if (has("fail")) throw new Error("scripted failure after Claude Code named the conversation");

  if (has("plan") && options?.allowedTools?.some((tool) => PLAN_TOOLS.has(tool))) {
    yield toolUse("toolu_plan_1", "TaskCreate", { subject: "Read the request", description: "…", activeForm: "Reading" });
    yield toolResult("toolu_plan_1", { task: { id: "1", subject: "Read the request" } }, "Task #1 created successfully: Read the request");
    yield toolUse("toolu_plan_2", "TaskCreate", { subject: "Answer it", description: "…", activeForm: "Answering" });
    yield toolResult("toolu_plan_2", { task: { id: "2", subject: "Answer it" } }, "Task #2 created successfully: Answer it");
    yield toolUse("toolu_plan_3", "TaskUpdate", { taskId: "1", status: "in_progress" });
    yield toolResult("toolu_plan_3", { success: true, taskId: "1" }, "Updated task #1 status");
    await pause(step, signal);
  }

  if (has("plan-next") && options?.allowedTools?.some((tool) => PLAN_TOOLS.has(tool))) {
    yield toolUse("toolu_next_1", "TaskUpdate", { taskId: "1", status: "completed" });
    yield toolResult("toolu_next_1", { success: true, taskId: "1" }, "Updated task #1 status");
    yield toolUse("toolu_next_2", "TaskUpdate", { taskId: "2", status: "in_progress" });
    yield toolResult("toolu_next_2", { success: true, taskId: "2" }, "Updated task #2 status");
    await pause(step, signal);
  }

  if (has("bash")) {
    const commands = ["git status", "ls", "cat package.json", "pnpm test", "pnpm typecheck"];
    const descriptions = ["Check git status", "List files", "Read the package manifest", "Run the tests", "Typecheck"];
    for (const [i, command] of commands.entries()) {
      const id = `toolu_bash_${i + 1}`;
      yield toolUse(id, "Bash", { command, description: descriptions[i] });
      yield toolResult(id, { stdout: "ok", stderr: "", interrupted: false }, "ok");
    }
    await pause(step, signal);
  }

  const reply = `Scripted Claude Code, turn ${turn} of conversation ${sessionId}.`;
  for (const word of reply.split(/(?<= )/)) {
    yield textDelta(word);
  }
  yield { type: "assistant", message: { content: [{ type: "text", text: reply }] } } as SdkMessageLike;
  // A slow turn holds here, after its reply and plan have shown and its conversation is confirmed.
  await pause(has("slow") ? scriptedPauses.slowMs : step, signal);
  yield {
    type: "result",
    subtype: "success",
    ...(has("errored") ? { is_error: true } : {}),
    result: reply,
    session_id: sessionId,
    usage: { input_tokens: 1, output_tokens: 1 },
    total_cost_usd: 0,
  } as SdkMessageLike;
}

/**
 * A scripted Claude Code, for `claudeCodeAgent`'s `resolveClaudeAgent`. Each
 * one keeps its own conversations, for as long as the block holding it.
 */
export function scriptedClaudeCode(): ResolveClaudeAgent {
  const conversations: Conversations = { turns: new Map(), minted: 0 };
  return () => ({
    query: (args) => scriptedTurn(conversations, typeof args.prompt === "string" ? args.prompt : "", args.options),
  });
}
