/**
 * `dispatchTask`'s post form (`post: true`): offered only on a turn its layer
 * says is routing a post, handed to that layer with `assignee` and `target`
 * and nothing else, and refused everywhere else.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { getOrCreateTaskCollection } from "../../src/tasks";
import { taskToolsForTurn, type AssigneeRoster, type DispatchPostForm } from "../../src/skills/task-tools-capability";
import { createFakeSequencerState } from "../helpers";

const ctxOf = (routing: boolean): BlockContext =>
  ({
    _blockIdentity: { blockName: "dispatchTask", blockInstanceId: "req_1:root/step[0]/tool[dispatchTask][0%3Ac1]:0" },
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" }, state: {} },
    request: { identity: { type: "request", id: "req_1" }, state: { routing } },
    runOnce: async <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn()
  }) as unknown as BlockContext;

const roster: AssigneeRoster = { has: (name) => name === "eng.a", describe: () => "eng.a", soleAssignee: () => "eng.a" };

/** The tools for a turn, and every call the post form was handed. */
async function toolsFor(routing: boolean) {
  const filed: Array<{ assignee?: string; target?: string }> = [];
  const posts: DispatchPostForm = {
    routing: (ctx) => (ctx.request as unknown as { state: { routing: boolean } }).state.routing,
    description: "On this turn you are routing a post.",
    file: async (_ctx, call) => {
      filed.push(call);
      return { ok: true, note: `Handed to ${call.assignee}.` };
    }
  };
  const collection = await getOrCreateTaskCollection({
    ctx: ctxOf(routing),
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "desk"
  });
  const ctx = ctxOf(routing);
  const tools = taskToolsForTurn(async () => collection, () => roster, { dispatches: true, posts })(ctx);
  const dispatch = tools.find((tool) => (tool as { name?: string }).name === "dispatchTask") as GeneratorTool;
  const call = (input: Record<string, unknown>) =>
    runForTest(dispatch as never, input as never, ctx) as Promise<{ ok: boolean; error?: string; note?: string }>;
  return { dispatch, call, filed, collection };
}

describe("dispatchTask's post form", () => {
  it("on a routing turn, hands post: true with assignee and target to the layer, and files nothing itself", async () => {
    const { dispatch, call, filed, collection } = await toolsFor(true);
    expect((dispatch as { description?: string }).description).toContain("On this turn you are routing a post.");
    expect(await call({ post: true, assignee: "eng.a", target: "shared/apollo/checkout" })).toEqual({ ok: true, note: "Handed to eng.a." });
    expect(filed).toEqual([{ assignee: "eng.a", target: "shared/apollo/checkout" }]);
    expect(collection.list()).toEqual([]);
  });

  it("refuses a post that carries any other field, naming it", async () => {
    const { call, filed } = await toolsFor(true);
    const refused = await call({ post: true, assignee: "eng.a", goal: "do it" });
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/^post_takes_assignee_and_target: .*\(not goal\)/) });
    expect(filed).toEqual([]);
  });

  it("refuses target on a call that files a task", async () => {
    const { call, collection } = await toolsFor(true);
    expect(await call({ goal: "do it", assignee: "eng.a", target: "x" })).toEqual({
      ok: false,
      error: expect.stringMatching(/^target_without_post: /)
    });
    expect(collection.list()).toEqual([]);
  });

  it("isn't offered on a turn that routes no post: post and target are refused there", async () => {
    const { dispatch, call, filed, collection } = await toolsFor(false);
    expect((dispatch as { description?: string }).description).not.toContain("routing a post");
    for (const input of [{ post: true, assignee: "eng.a" }, { goal: "do it", target: "x" }]) {
      expect(await call(input)).toEqual({ ok: false, error: expect.stringMatching(/^post_unavailable: /) });
    }
    expect(filed).toEqual([]);
    expect(collection.list()).toEqual([]);
  });
});
