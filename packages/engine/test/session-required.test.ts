/**
 * Every run names its session. `runAction` is where every writer converges,
 * so a call with no `sessionId` (from JavaScript, or a bag assembled at run
 * time, which the required type does not reach) is refused by name there,
 * before anything is registered or written: no request record, no
 * active-request entry and no session is left behind, and the engine never
 * makes up a session for it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createExecutionContext, runAction } from "../src";
import { createInMemoryStores, createResponseEmitter, SessionRequiredError } from "../src/host";

const noop = handler({
  name: "noop",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

const flow = defineFlow({ kind: "session-required-flow", actions: { turn: { block: noop } } })();

describe("runAction with no session id", () => {
  it.each([undefined, ""])("refuses sessionId %j by name and writes nothing", async (sessionId) => {
    const stores = createInMemoryStores();
    const requestId = "r_no_session";
    const run = runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "turn",
      input: {},
      userId: "u",
      requestId,
      stores,
      responseEmitter: createResponseEmitter({ requestId }),
      runtimeConfig: {},
      ...({ sessionId } as { sessionId: string }),
    });
    await expect(run).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(run).rejects.toMatchObject({ code: "session-required" });
    expect(await stores.request.get(requestId)).toBeUndefined();
    expect(await stores.activeRequests.listAll()).toEqual([]);
    expect(await stores.session.list()).toEqual([]);
  });

  it("runs the same call once it names a session", async () => {
    const stores = createInMemoryStores();
    const requestId = "r_named";
    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "turn",
      input: {},
      userId: "u",
      sessionId: "s-1",
      requestId,
      stores,
      responseEmitter: createResponseEmitter({ requestId }),
      runtimeConfig: {},
    });
    expect((await stores.request.get(requestId))?.sessionId).toBe("s-1");
  });
});

describe("createExecutionContext with no session id", () => {
  // The engine's late one-off mint is gone: a run's context is built only for
  // the session its entry point named, so the record it writes names it too.
  it("refuses a run with no session by name and writes no record", async () => {
    const stores = createInMemoryStores();
    const build = createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "turn",
      requestId: "r_ctx",
      userId: "u",
      stores,
    } as unknown as Parameters<typeof createExecutionContext>[0]);
    await expect(build).rejects.toBeInstanceOf(SessionRequiredError);
    expect(await stores.request.get("r_ctx")).toBeUndefined();
    expect(await stores.session.list()).toEqual([]);
  });

  it("builds a view with no session, and makes none", async () => {
    const stores = createInMemoryStores();
    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "turn",
      requestId: "r_view",
      userId: "u",
      stores,
      noSession: true,
    });
    expect(ctx).toBeDefined();
    expect(await stores.session.list()).toEqual([]);
  });
});
