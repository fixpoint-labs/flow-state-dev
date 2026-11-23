// FIX-2886.
/**
 * A dispatch from inside a run can't name a schedule's session. An `{ id,
 * state }` target births its session in the request host before the
 * operation reaches the inbound host, so a refusal there alone would leave a
 * row behind under the dispatching user, and the schedule's next fire would
 * be refused as a user mismatch. The request host refuses the id first, for
 * `{ id }` and `{ id, state }` targets alike, bare and tenant-namespaced.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { markDispatcher } from "@flow-state-dev/core/types";
import { dispatchThroughSeam } from "@flow-state-dev/core/internal";
import { z } from "zod";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import { scheduleSessionId } from "../../src/transports/scheduled/schedule-session-id";
import { DEFAULT_WRITE_FLOW, writeSessionId } from "../../src/resources/default-write-flow";

const USER_ID = "u_dispatcher";

function dispatchingFlow(kind: string, runs: string[]) {
  const work = handler({
    name: "work",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async (_input, ctx) => {
      runs.push(ctx.session.identity.id);
      return {};
    }
  });
  const send = markDispatcher(
    handler({
      name: "send-work",
      inputSchema: z.object({ to: z.string(), born: z.boolean() }),
      outputSchema: z.unknown(),
      execute: async (input, ctx) =>
        dispatchThroughSeam(ctx, {
          type: "internal",
          action: "work",
          session: input.born ? { id: input.to, state: {} } : { id: input.to },
          payload: {},
          from: "send-work"
        })
    }),
    { type: "internal", action: "work" }
  );
  return defineFlow({
    kind,
    actions: { send: { block: send } },
    internal: { actions: { work: { block: work } } }
  })({ id: kind });
}

describe("a dispatch target naming a schedule's session", () => {
  it("is refused before any birth, for { id } and { id, state }, bare and namespaced, and leaves no row", async () => {
    const runs: string[] = [];
    const flow = dispatchingFlow("dispatching", runs);
    const state = createFlowState({ flows: [flow], stores: { default: { primary: inMemoryStores() } } });
    try {
      const runtime = await state.getRuntime();
      const target = scheduleSessionId({ orgId: DEFAULT_ORG_ID, userId: USER_ID, flowId: "dispatching", scheduleId: "poll" });
      for (const to of [target, `t1:${target}`]) {
        for (const born of [true, false]) {
          const result = await runAction({
            orgId: DEFAULT_ORG_ID,
            flow,
            actionName: "send",
            input: { to, born },
            userId: USER_ID,
            sessionId: "s_sender",
            stores: runtime.stores,
            runtimeConfig: { ...runtime.runtimeConfig }
          });
          expect(result.error?.message ?? JSON.stringify(result.output), `${to} born=${born}`).toMatch(/session-not-addressable/);
          expect(result.error?.message ?? JSON.stringify(result.output)).toMatch(/schedule session/);
        }
      }
      // The write prefix has the same gap at the same line, closed with it.
      const write = writeSessionId({ scope: "user", key: "pins", writer: DEFAULT_WRITE_FLOW }, { userId: USER_ID, orgId: DEFAULT_ORG_ID });
      for (const born of [true, false]) {
        const result = await runAction({
          orgId: DEFAULT_ORG_ID,
          flow,
          actionName: "send",
          input: { to: write, born },
          userId: USER_ID,
          sessionId: "s_sender",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });
        expect(result.error?.message ?? JSON.stringify(result.output), `write born=${born}`).toMatch(/write session/);
      }
      const sessions = (await runtime.stores.session.list({})).map((session) => session.id);
      expect(sessions).toEqual(["s_sender"]);
      expect(runs).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});
