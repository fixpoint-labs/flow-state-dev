/**
 * A scripted Codex for test mode: the Codex SDK's client replaced, through the
 * block's own `resolveCodexClient` seam, by a script that answers in the SDK's
 * own event shapes. Everything past the seam is the real block: its
 * translation, items, `resume`, `onSession` and error classification.
 *
 * Server only, and only under `KITCHEN_SINK_TEST_MODE=1` (see
 * `lib/codex-mode.ts`). No model, no process, no network.
 *
 * A turn's prompt may carry directives in square brackets, so a browser test
 * can drive each path:
 *
 * | Directive | What the script does |
 * |---|---|
 * | (none) | names the thread (the asked one, or a new one), runs a command with a pause, replies, completes |
 * | `[slow]` | after the command and the reply have shown, holds long enough for a stop to land |
 * | `[slow-start]` | pauses before naming the thread, so a stop lands before it is confirmed |
 * | `[long]` | after the command and the reply have shown, holds past the engine's 30 s `queue` wait budget, then replies again |
 * | `[new]` | names a new thread even when asked to continue one |
 * | `[refuse]` | refuses the asked thread the way Codex does: no thread named, then the SDK's throw with Codex's `no rollout found` error |
 * | `[fail]` | names the thread, then Codex fails the turn (`turn.failed`, a result rather than a throw) |
 * | `[fail-early]` | fails before naming any thread, with a sign-in error |
 *
 * The reply names how many turns the thread has had, which is how a test sees
 * a second turn continue the first's thread.
 */
import type { CodexThreadEvent, CodexThreadLike, ResolveCodexClient } from "@flow-state-dev/codex";

import { scriptedReceived } from "./scripted-received";

/**
 * The script's pauses, in milliseconds: between steps, the long one a
 * `[slow]` or `[slow-start]` turn takes, long enough to press stop, and the
 * one a `[long]` turn takes, longer than a turn sent behind it would wait
 * under `queue`. Unit tests shorten them.
 */
export const scriptedCodexPauses = { stepMs: 400, slowMs: 20_000, longMs: 35_000 };

/** What a `[long]` turn replies once its hold is over. */
export const SCRIPTED_LONG_DONE = "Scripted Codex, done after the long hold.";

/** The command every scripted turn runs, as Codex reports it. */
export const SCRIPTED_COMMAND = "ls";

/** A pause that ends early when the run is stopped. */
async function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal?.aborted === true) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** What the SDK throws when its process exits non-zero, in its own words. */
function exited(stderr: string): Error {
  return new Error(`Codex Exec exited with code 1: Reading prompt from stdin...\n${stderr}\n`);
}

/** Codex's own resume error, measured on the real CLI at 0.152.1. */
function noRollout(threadId: string): Error {
  return exited(`Error: thread/resume: thread/resume failed: no rollout found for thread id ${threadId} (code -32600)`);
}

/** One scripted Codex's threads: turns per thread, and how many it has started. */
interface Threads {
  readonly turns: Map<string, number>;
  minted: number;
}

/** One thread, started (`asked` null) or resumed. */
function scriptedThread(threads: Threads, asked: string | null): CodexThreadLike {
  let id: string | null = asked;
  return {
    get id() {
      return id;
    },
    runStreamed: async (prompt, turnOptions) => {
      const signal = turnOptions?.signal;
      const has = (directive: string) => prompt.includes(`[${directive}]`);
      const stopped = () => signal?.aborted === true;
      const step = scriptedCodexPauses.stepMs;
      scriptedReceived.push(prompt);

      async function* events(): AsyncGenerator<CodexThreadEvent> {
        if (has("fail-early")) {
          throw exited("Error: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header");
        }
        if (asked !== null && has("refuse")) throw noRollout(asked);
        if (has("slow-start")) await pause(scriptedCodexPauses.slowMs, signal);
        if (stopped()) throw new Error("The operation was aborted");

        if (asked === null || has("new")) {
          threads.minted += 1;
          id = `scripted-codex-${Date.now().toString(36)}-${threads.minted}`;
        }
        const thread = id as string;
        const turn = (threads.turns.get(thread) ?? 0) + 1;
        threads.turns.set(thread, turn);

        yield { type: "thread.started", thread_id: thread };
        yield { type: "turn.started" };
        const command = { id: "cmd_1", type: "command_execution" as const, command: SCRIPTED_COMMAND, aggregated_output: "" };
        yield { type: "item.started", item: { ...command, status: "in_progress" as const } };
        await pause(step, signal);
        yield {
          type: "item.completed",
          item: { ...command, aggregated_output: "README.md\n", exit_code: 0, status: "completed" as const },
        };
        yield {
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: `Scripted Codex, turn ${turn} of thread ${thread}.` },
        };
        // A slow turn holds here, after its command and reply have shown and its thread is confirmed.
        await pause(has("slow") ? scriptedCodexPauses.slowMs : step, signal);
        if (has("long")) {
          await pause(scriptedCodexPauses.longMs, signal);
          if (!stopped()) yield { type: "item.completed", item: { id: "msg_2", type: "agent_message", text: SCRIPTED_LONG_DONE } };
        }
        if (stopped()) throw new Error("The operation was aborted");
        if (has("fail")) {
          yield { type: "turn.failed", error: { message: "scripted turn Codex failed" } };
          return;
        }
        yield {
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        };
      }

      return { events: events() };
    },
  };
}

/**
 * A scripted Codex, for `codexAgent`'s `resolveCodexClient`. Each one keeps
 * its own threads, for as long as the block holding it.
 */
export function scriptedCodex(): ResolveCodexClient {
  const threads: Threads = { turns: new Map(), minted: 0 };
  return () => ({
    startThread: () => scriptedThread(threads, null),
    resumeThread: (id) => scriptedThread(threads, id),
  });
}
