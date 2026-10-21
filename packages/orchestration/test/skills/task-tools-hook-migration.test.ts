/**
 * Pins the tool-observability consequence of soft-failing a refused task
 * write (FIX-950; `updateTask`'s field table since FIX-2081).
 *
 * A refused write RETURNS `{ ok: false, error: "<rule>: …" }` instead of
 * throwing. That moves the call across a branch in the core tool executor
 * (`packages/core/src/blocks/internal/tool-executor.ts`):
 *
 * - line ~129 — `onToolCompleted` fires inside `callTool`'s `try`, once the
 *   tool's `run` RESOLVES;
 * - line ~179 — `onToolErrored` fires in `callToolWithErrorObserver`'s `catch`,
 *   only after a THROW.
 *
 * A refused call resolves and lands on `onToolCompleted`, not on
 * `onToolErrored`. That is an observability migration, not a silent
 * refactor: operators counting tool errors see their error count drop and
 * their completion count rise for a call that still did no work. This test
 * fixes that contract in place so a future revert (or a widened `catch`)
 * cannot move it back unnoticed.
 *
 * The assertion drives the REAL `updateTask` tool through the REAL executor
 * — `buildToolExecutor` is not on core's public surface, so the test reaches it
 * the way production does: a `generator` compiles its `tools:` into
 * execute-closures, and a mock model invokes one. Calling the handler directly
 * (`runForTest(tool, …)`) would bypass the executor and prove nothing about the
 * hooks.
 */
import { describe, expect, it, vi } from "vitest";
import { generator, type GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { buildTaskToolsList } from "../../src/skills/task-tools-capability";
import { BOARD_FIELD, buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

/** The real `updateTask` task tool, built from the real tool list. */
function updateTaskTool(): GeneratorTool {
  const tool = buildTaskToolsList(ownStateResolver).find((t) => t.config?.name === "updateTask");
  if (!tool) throw new Error("tool not found: updateTask");
  return tool as GeneratorTool;
}

/**
 * A generator execution context whose `ctx.parent` carries an own-state
 * delegation board holding one running task — the state
 * `ownStateResolver` reads, and one whose goal can no longer change. The parent shape comes from the shared delegation fixture; this adds
 * only the model resolver, which the tool executor needs to compile and run the
 * generator's `tools:`.
 */
function buildHookMigrationCtx(generate: (options: any) => Promise<unknown>): BlockContext {
  const resolveModel = (() => ({ modelId: "test-model", generate })) as any;
  resolveModel.resolveId = (modelId: string) => modelId;
  return buildDelegationCtx({
    preTasks: {
      a: {
        id: "a",
        goal: "write the brief",
        status: "in_progress",
        attempts: 1,
        startedAt: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
    resolveModel,
  }).ctx as BlockContext;
}

describe("taskTools — tool lifecycle hooks on a refused status transition", () => {
  it("fires onToolCompleted and not onToolErrored when updateTask is refused", async () => {
    const onToolStarted = vi.fn();
    const onToolCompleted = vi.fn();
    const onToolErrored = vi.fn();
    let toolResult: unknown;
    let toolThrew: unknown;

    const executive = generator({
      name: "executive",
      model: "test-model",
      prompt: "delegate",
      inputSchema: z.object({}),
      tools: [updateTaskTool()],
      flowTools: { onToolStarted, onToolCompleted, onToolErrored },
      stateSchema: z.object({ [BOARD_FIELD]: z.record(z.string(), z.unknown()).default({}) }),
    });

    const ctx = buildHookMigrationCtx(async (options: any) => {
      const tool = (options.tools as any[])?.find((t: any) => t.name === "updateTask");
      // The tool now RESOLVES on a refused transition, so the result comes back
      // as a value rather than a throw. Capture it — it is the evidence that the
      // observed call is the rejected one. The `catch` is deliberate: a
      // regression that reinstates the throw must fail on the hook assertions
      // below (which name the migration) rather than blowing up the whole run
      // with an opaque error.
      try {
        toolResult = await tool.execute({ id: "a", goal: "write another brief" });
      } catch (err) {
        toolThrew = err;
      }
      return { text: "ok" };
    });

    await runForTest(executive, {}, ctx);

    expect(onToolStarted).toHaveBeenCalledTimes(1);
    expect(onToolCompleted).toHaveBeenCalledTimes(1);
    expect(onToolErrored).not.toHaveBeenCalled();
    expect(toolThrew).toBeUndefined();

    // The completion the hook observed is the REFUSED call, not some other one:
    // the output handed to `onToolCompleted` is the soft-error result itself.
    const event = onToolCompleted.mock.calls[0]![0] as {
      toolName: string;
      output: { ok: boolean; error?: string };
    };
    expect(event.toolName).toBe("updateTask");
    expect(event.output.ok).toBe(false);
    expect(event.output.error).toContain("field_locked_after_start");
    expect(toolResult).toEqual(event.output);

    // The task is unchanged — the refusal is reported, not applied.
    const board = (ctx as unknown as { parent: { state: Record<string, any> } }).parent.state[
      BOARD_FIELD
    ];
    expect(board.a.goal).toBe("write the brief");
  });
});
