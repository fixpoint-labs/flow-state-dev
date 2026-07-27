/**
 * Pins the tool-observability consequence of soft-failing an illegal task
 * status transition (FIX-950).
 *
 * `withTask` now catches `IllegalTaskTransitionError` and RETURNS
 * `{ ok: false, error: "illegal_status_transition: …" }` instead of letting it
 * throw. That moves the call across a branch in the core tool executor
 * (`packages/core/src/blocks/internal/tool-executor.ts`):
 *
 * - line ~129 — `onToolCompleted` fires inside `callTool`'s `try`, once the
 *   tool's `run` RESOLVES;
 * - line ~179 — `onToolErrored` fires in `callToolWithErrorObserver`'s `catch`,
 *   only after a THROW.
 *
 * Before the change, `completeTask` on a `pending` task threw and landed on
 * `onToolErrored`. After it, the same call resolves and lands on
 * `onToolCompleted`. That is an observability migration, not a silent
 * refactor: operators counting tool errors see their error count drop and
 * their completion count rise for a call that still did no work. This test
 * fixes that contract in place so a future revert (or a widened `catch`)
 * cannot move it back unnoticed.
 *
 * The assertion drives the REAL `completeTask` tool through the REAL executor
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
import {
  buildTaskToolsList,
  delegationBoardSchema,
  DELEGATION_BOARD_FIELD,
} from "../../src/skills/task-tools-capability";

/** The real `completeTask` task tool, built from the real tool list. */
function completeTaskTool(): GeneratorTool {
  const tool = buildTaskToolsList().find((t) => t.config?.name === "completeTask");
  if (!tool) throw new Error("tool not found: completeTask");
  return tool as GeneratorTool;
}

/**
 * A generator execution context whose `ctx.parent` carries an own-state
 * delegation board holding one `pending` task — the state
 * `defaultOwnStateResolver` reads, and the status from which `complete()` is
 * refused. Mirrors the parent shape used across the other skills tests: a live
 * `state` getter plus a CAS-shaped `atomicState` that merges the returned patch.
 */
function buildExecCtx(generate: (options: any) => Promise<unknown>): BlockContext {
  const parentState: Record<string, unknown> = {
    [DELEGATION_BOARD_FIELD]: {
      a: {
        id: "a",
        goal: "write the brief",
        status: "pending",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  };
  const parent = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return parentState;
    },
    atomicState: async (
      fn: (
        state: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ): Promise<void> => {
      Object.assign(parentState, await fn(parentState));
    },
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(parentState, updates);
    },
  };
  const resolveModel = (() => ({ modelId: "test-model", generate })) as any;
  resolveModel.resolveId = (modelId: string) => modelId;

  return {
    parent,
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: {},
      patchState: async () => {},
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: { get: () => undefined, list: () => [] },
    signal: new AbortController().signal,
    response: { emit: async () => {}, getItems: () => [] },
    cap: {},
    resolveModel,
    _peekStatus: () => "",
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}

describe("taskTools — tool lifecycle hooks on a refused status transition", () => {
  it("fires onToolCompleted and not onToolErrored when completeTask is refused", async () => {
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
      tools: [completeTaskTool()],
      flowTools: { onToolStarted, onToolCompleted, onToolErrored },
      stateSchema: { [DELEGATION_BOARD_FIELD]: delegationBoardSchema },
    });

    const ctx = buildExecCtx(async (options: any) => {
      const tool = (options.tools as any[])?.find((t: any) => t.name === "completeTask");
      // The tool now RESOLVES on a refused transition, so the result comes back
      // as a value rather than a throw. Capture it — it is the evidence that the
      // observed call is the rejected one. The `catch` is deliberate: a
      // regression that reinstates the throw must fail on the hook assertions
      // below (which name the migration) rather than blowing up the whole run
      // with an opaque `IllegalTaskTransitionError`.
      try {
        toolResult = await tool.execute({ taskId: "a", output: "done" });
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
    expect(event.toolName).toBe("completeTask");
    expect(event.output.ok).toBe(false);
    expect(event.output.error).toContain("illegal_status_transition");
    expect(toolResult).toEqual(event.output);

    // The task did not move — the refusal is reported, not applied.
    const board = (ctx as unknown as { parent: { state: Record<string, any> } }).parent.state[
      DELEGATION_BOARD_FIELD
    ];
    expect(board.a.status).toBe("pending");
  });
});
