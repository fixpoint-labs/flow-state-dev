/**
 * dispatchAndExecute tests — covers happy path (claim → worker →
 * complete), the rescue path (worker throw → fail), and registry
 * routing by `task.assignee`.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSequencerBackedTaskCollection,
  dispatchAndExecuteBlock,
  fifoDispatcher,
  type TaskCollectionRef,
} from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeSequencerState,
} from "../helpers";

function buildCollection(): TaskCollectionRef {
  const captured = createCapturedChanges();
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createSequencerBackedTaskCollection({
    collectionId: "tasks",
    sequencer,
    onChange: captured.onChange,
  });
}

const fakeCtx = {} as BlockContext;

describe("dispatchAndExecuteBlock", () => {
  it("claims, runs the worker, calls complete on success", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "do thing", input: { x: 2 } });

    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { input?: { x: number } }) => ({ y: (input.input?.x ?? 0) * 2 }),
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(result.claimed).toBe(true);
    expect(result.taskId).toBe("t");
    expect(result.output).toEqual({ y: 4 });
    expect(c.get("t")?.status).toBe("completed");
    expect(c.get("t")?.output).toEqual({ y: 4 });
  });

  it("packs title and context onto the worker input (FIX-827)", async () => {
    const c = buildCollection();
    await c.addTask({
      id: "t",
      goal: "research the listed subdomains",
      title: "Subdomain research",
      context: "Subdomains: a.example.com, b.example.com, c.example.com",
    });

    let seen: { title?: string; context?: string; goal?: string } | undefined;
    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { title?: string; context?: string; goal?: string }) => {
        seen = input;
        return { ok: true };
      },
    });

    await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(seen?.goal).toBe("research the listed subdomains");
    expect(seen?.title).toBe("Subdomain research");
    expect(seen?.context).toBe("Subdomains: a.example.com, b.example.com, c.example.com");
  });

  it("returns claimed=false when nothing is pending", async () => {
    const c = buildCollection();
    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(result.claimed).toBe(false);
  });

  it("rescues worker throw → fails the task with the error message (onError: skip)", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "boom" });

    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("worker died");
      },
    });

    const result = await runForTest(
      dispatchAndExecuteBlock({ collection: c, dispatcher: fifoDispatcher, workers: worker }),
      undefined,
      fakeCtx
    );

    expect(result.claimed).toBe(true);
    expect(result.error).toBe("worker died");
    expect(c.get("t")?.status).toBe("errored");
    expect(c.get("t")?.error).toBe("worker died");
  });

  it("rethrows after fail when onError: fail", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "boom" });

    const worker = handler({
      name: "worker",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => {
        throw new Error("propagate");
      },
    });

    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: worker,
          onError: "fail",
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/propagate/);
    // The task is still marked errored even though the call rethrew.
    expect(c.get("t")?.status).toBe("errored");
  });

  it("registry: routes by task.assignee", async () => {
    const c = buildCollection();
    await c.addTask({ id: "r1", goal: "research", assignee: "researcher" });
    await c.addTask({ id: "w1", goal: "write", assignee: "writer" });

    const calls: string[] = [];
    const researcher = handler({
      name: "researcher",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { taskId: string }) => {
        calls.push(`researcher:${input.taskId}`);
        return "research-result";
      },
    });
    const writer = handler({
      name: "writer",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: { taskId: string }) => {
        calls.push(`writer:${input.taskId}`);
        return "write-result";
      },
    });
    const registry = { researcher, writer };

    const block = dispatchAndExecuteBlock({
      collection: c,
      dispatcher: fifoDispatcher,
      workers: registry,
      workerId: "w-1",
    });
    await runForTest(block, undefined, fakeCtx);
    await runForTest(block, undefined, fakeCtx);

    expect(calls).toEqual(["researcher:r1", "writer:w1"]);
    expect(c.get("r1")?.output).toBe("research-result");
    expect(c.get("w1")?.output).toBe("write-result");
  });

  it("registry: throws when task has no assignee", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "no-assignee" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no assignee/);
  });

  it("registry: throws when no worker registered for assignee", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t", goal: "missing", assignee: "ghost" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no worker registered/);
  });

  it("registry: a prototype-named assignee (FIX-943) does not resolve to Object.prototype", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t1", goal: "evil", assignee: "constructor" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no worker registered/);
  });

  it("registry: another prototype key (toString) also takes the 'no worker registered' path (FIX-943)", async () => {
    const c = buildCollection();
    await c.addTask({ id: "t2", goal: "evil", assignee: "toString" });
    const worker = handler({
      name: "x",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: () => null,
    });
    await expect(
      runForTest(
        dispatchAndExecuteBlock({
          collection: c,
          dispatcher: fifoDispatcher,
          workers: { x: worker },
        }),
        undefined,
        fakeCtx
      )
    ).rejects.toThrow(/no worker registered/);
  });
});
