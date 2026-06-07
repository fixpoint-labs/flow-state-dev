/**
 * `claudeRemoteDispatch` — handler block that dispatches a Claude Code cloud
 * task by shelling out to `claude --remote "<instructions>"`, persists the
 * returned handle in session state, and emits a status item with the task URL.
 *
 * v0 is fire-and-forget: it captures the dispatch handle and returns. The CLI
 * exposes no headless way to poll or stream cloud-task progress, so there is no
 * polling loop here (see the FIX-672 spec, Non-Goals).
 *
 * The same definition is used two ways: as a deterministic sequencer step, and
 * as a generator-invocable tool via `createClaudeCliCapability`.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { claudeRemoteHandleSchema, type ClaudeRemoteHandle } from "./types";
import { parseRemoteDispatchOutput } from "./parse-output";
import { defaultResolveClaudeCli, type ResolveClaudeCli } from "./resolve-cli";
import { ClaudeCliNotFoundError, ClaudeRemoteDispatchError } from "./errors";

/** Session-state key under which dispatched handles accumulate. */
export const CLAUDE_REMOTE_TASKS_KEY = "claudeRemoteTasks" as const;

/** Session-state schema the dispatch block declares and appends to. */
export const claudeRemoteTasksSchema = z.object({
  [CLAUDE_REMOTE_TASKS_KEY]: z.array(claudeRemoteHandleSchema).default([]),
});

const inputSchema = z.object({
  /** The coding task to dispatch to the cloud session. */
  instructions: z.string().min(1),
});

export interface ClaudeRemoteDispatchOptions {
  /** Host hook resolving how to run `claude`. Default: PATH lookup. */
  resolveClaudeCli?: ResolveClaudeCli;
  /** Derive the instruction string from input/ctx. Default: `input.instructions`. */
  instructions?: (input: { instructions: string }, ctx: BlockContext) => string;
  /** Working directory for the dispatch (the host repo). Overrides the resolver's cwd. */
  cwd?: string;
  /** Timeout for the dispatch call itself (not the cloud task). Default 60s. */
  timeoutMs?: number;
  /** Block name. Default `"claude-remote-dispatch"`. */
  name?: string;
}

/**
 * Create a `claude --remote` dispatch handler block.
 *
 * On success the block appends a {@link ClaudeRemoteHandle} to
 * `ctx.session.state.claudeRemoteTasks`, emits a persisted status item, and
 * returns the handle. It throws {@link ClaudeCliNotFoundError} when the binary
 * can't be launched and {@link ClaudeRemoteDispatchError} on non-zero exit,
 * timeout, or empty instructions. Exit 0 with unparseable stdout is treated as
 * a successful dispatch with a null URL (the raw stdout is retained).
 */
export function claudeRemoteDispatch(options: ClaudeRemoteDispatchOptions = {}) {
  const {
    resolveClaudeCli = defaultResolveClaudeCli,
    instructions: pickInstructions,
    cwd,
    timeoutMs = 60_000,
    name = "claude-remote-dispatch",
  } = options;

  return handler({
    name,
    description: "Dispatch a Claude Code cloud task via `claude --remote` and persist its handle.",
    inputSchema,
    outputSchema: claudeRemoteHandleSchema,
    sessionStateSchema: claudeRemoteTasksSchema,
    execute: async (input, ctx): Promise<ClaudeRemoteHandle> => {
      const instructions = (pickInstructions ? pickInstructions(input, ctx) : input.instructions)?.trim();
      if (!instructions) {
        throw new ClaudeRemoteDispatchError("claudeRemoteDispatch requires non-empty instructions.");
      }

      const resolved = await resolveClaudeCli(ctx as unknown as BlockContext);
      const dispatchedAt = Date.now();

      let result;
      try {
        result = await resolved.exec(resolved.bin, ["--remote", instructions], {
          cwd: cwd ?? resolved.cwd,
          env: resolved.env,
          timeoutMs,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          throw new ClaudeCliNotFoundError();
        }
        throw new ClaudeRemoteDispatchError(
          `Failed to invoke \`${resolved.bin} --remote\`: ${(err as Error).message}`,
          { cause: (err as Error).message },
        );
      }

      if (result.code !== 0) {
        ctx.emit.status(`Claude remote dispatch failed (exit ${result.code}).`, { transient: false });
        throw new ClaudeRemoteDispatchError(`\`claude --remote\` exited with code ${result.code}.`, {
          exitCode: result.code,
          stderr: result.stderr,
        });
      }

      const { url, sessionId } = parseRemoteDispatchOutput(result.stdout);
      const handle: ClaudeRemoteHandle = {
        source: "cli-remote",
        status: "dispatched",
        sessionId,
        url,
        dispatchedAt,
        instructions,
        raw: result.stdout,
      };

      await ctx.session.patchState(CLAUDE_REMOTE_TASKS_KEY, (prev) => [...(prev ?? []), handle]);

      ctx.emit.status(
        url || sessionId
          ? `Dispatched Claude cloud task${url ? ` → ${url}` : ` (${sessionId})`}.`
          : "Dispatched Claude cloud task (no session URL found in CLI output).",
        { transient: false },
      );

      return handle;
    },
  });
}
