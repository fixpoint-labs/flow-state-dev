/**
 * A run that starts with no session id runs in a one-off session the context
 * mints. Its request record must name that session: every reader that finds a
 * session's requests (the session request listing, the DevTool Trace tab,
 * request recovery) looks them up by `sessionId`, so a record that names none
 * leaves the session with no history and the request with no session.
 *
 * The record is written before the session id exists: `runAction` claims it
 * first, and a transport host writes its stub at enqueue. The context adopts
 * that stored record instead of writing its own, so the adopted path is the
 * one these drive.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { isOneOffSessionId } from "@flow-state-dev/core/helpers";
import { createExecutionContext, runAction } from "../src";
import { createInMemoryStores, createResponseEmitter } from "../src/host";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import { stampAdoptedRequestSession } from "../src/context/request-principal";

function makeFlow(seen: { sessionId?: string }) {
  return defineFlow({
    kind: "sessionless-run",
    actions: {
      run: handler({
        name: "probe",
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: (_input, ctx) => {
          seen.sessionId = ctx.session.identity.id;
          return {};
        }
      })
    }
  })();
}

describe("a run with no session id records the session it ran in", () => {
  it("stamps the minted session id on the request record runAction claimed", async () => {
    const seen: { sessionId?: string } = {};
    const stores = createInMemoryStores();

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: makeFlow(seen),
      actionName: "run",
      input: {},
      userId: "u",
      stores,
      requestId: "req_sessionless",
      responseEmitter: createResponseEmitter({ requestId: "req_sessionless" }),
      runtimeConfig: {}
    });

    expect(seen.sessionId !== undefined && isOneOffSessionId(seen.sessionId)).toBe(true);
    const record = await stores.request.get("req_sessionless");
    expect(record?.status).toBe("completed");
    expect(record?.sessionId).toBe(seen.sessionId);
    // The read a session's request history goes through.
    const listed = await stores.request.list({ sessionId: seen.sessionId });
    expect(listed.map((r) => r.id)).toEqual(["req_sessionless"]);
  });

  it("stamps it on a stub a transport host wrote at enqueue", async () => {
    const seen: { sessionId?: string } = {};
    const stores = createInMemoryStores();
    const flow = makeFlow(seen);
    // A host's enqueue-time stub for a dispatch that carries no session (a
    // scheduled fire's envelope carries none).
    const stub = createInitialRequestRecord(
      {
        requestId: "req_stub",
        flowKind: flow.kind,
        flowId: flow.id,
        actionName: "run",
        userId: "u",
        orgId: DEFAULT_ORG_ID,
        input: {}
      },
      Date.now()
    );
    expect((await stores.request.set(stub.id, stub, "absent")).ok).toBe(true);

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u",
      stores,
      requestId: "req_stub",
      responseEmitter: createResponseEmitter({ requestId: "req_stub" }),
      runtimeConfig: {}
    });

    const record = await stores.request.get("req_stub");
    expect(record?.status).toBe("completed");
    expect(record?.sessionId).toBe(seen.sessionId);
    // Adopted, not replaced: the request keeps the incarnation the stub minted.
    expect(record?.incarnation).toBe(stub.incarnation);
  });

  it("leaves a continued request's record as it was, so its old gates stay findable", async () => {
    // A request parked before records named one-off sessions: its record and
    // its gate both name none. A continuation mints a new one-off session;
    // stamping that on the record would hide the gate from a stop, which
    // looks gates up by the record's session.
    const stores = createInMemoryStores();
    const flow = makeFlow({});
    const legacy = {
      ...createInitialRequestRecord(
        { requestId: "req_parked", flowKind: flow.kind, flowId: flow.id, actionName: "run", userId: "u", orgId: DEFAULT_ORG_ID, input: {} },
        Date.now()
      ),
      status: "suspended" as const
    };
    await stores.request.set(legacy.id, legacy, "absent");

    await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_parked",
      userId: "u",
      stores,
      continuesRequest: true
    });

    expect((await stores.request.get("req_parked"))?.sessionId).toBeUndefined();
  });

  it("keeps a cancel recorded after the record was read", async () => {
    const stores = createInMemoryStores();
    const stub = createInitialRequestRecord(
      { requestId: "req_raced", flowKind: "sessionless-run", actionName: "run", userId: "u", input: {} },
      Date.now()
    );
    await stores.request.set(stub.id, stub, "absent");
    const held = (await stores.request.get("req_raced"))!;
    // A cancel lands between the run's read and its stamp.
    await stores.request.setFieldsIfStatus("req_raced", { abortRequested: true }, ["in_progress"], Date.now());

    await stampAdoptedRequestSession(stores, held, "ephemeral_x");

    const stored = await stores.request.get("req_raced");
    expect(stored?.sessionId).toBe("ephemeral_x");
    expect(await stores.request.isAbortRequested("req_raced")).toBe(true);
  });

  it("keeps reading a record stored before the fix, which names no session (BP-030)", async () => {
    const stores = createInMemoryStores();
    const legacy = {
      ...createInitialRequestRecord(
        { requestId: "req_legacy", flowKind: "sessionless-run", actionName: "run", userId: "u", input: {} },
        Date.now()
      ),
      status: "completed" as const
    };
    await stores.request.set(legacy.id, legacy, "absent");

    expect((await stores.request.get("req_legacy"))?.sessionId).toBeUndefined();
    expect((await stores.request.list({ userId: "u" })).map((r) => r.id)).toEqual(["req_legacy"]);
  });
});
