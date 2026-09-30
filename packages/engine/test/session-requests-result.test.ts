/**
 * `GET /sessions/:id/requests` lists each request's action result (FIX-1661).
 *
 * The listing is a summary, as with items: every entry says whether its
 * request failed and why (`result.error`) and whether it answered
 * (`result.hasOutput`), but carries the answer itself (`result.output`) only
 * when the caller asks with `include_result_output=true`. A caller that polls
 * a long session pays for every output only when it opted in.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { handleListSessionRequests } from "../src/routes/session-routes";
import { createInMemoryStores } from "../src";
import type { FlowRegistry } from "../src/registry/flow-registry";
import type { ParsedFlowRoute } from "../src/routes/parseFlowRoute";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../src/stores/types";

const registry = { get: () => undefined, list: () => [] } as unknown as FlowRegistry;
const route: Extract<ParsedFlowRoute, { kind: "list_session_requests" }> = {
  kind: "list_session_requests",
  sessionId: "sess_1"
};

const refusal = { ok: false, error: "task is cancelled, which is terminal" };
const hookError = { code: "execution_error", message: "notification hook failed" };

function session(): SessionRecord {
  return {
    orgId: DEFAULT_ORG_ID,
    id: "sess_1",
    flowKind: "demo",
    userId: "u1",
    state: {},
    resources: {},
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    journal: []
  };
}

function request(id: string, status: RequestRecord["status"], result?: RequestRecord["result"]): RequestRecord {
  return {
    id,
    orgId: DEFAULT_ORG_ID,
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1,
    flowKind: "demo",
    actionName: "act",
    userId: "u1",
    sessionId: "sess_1",
    source: "http",
    status,
    startedAtMs: 1,
    items: [],
    ...(result !== undefined ? { result } : {})
  };
}

async function seeded(): Promise<StoreRegistry> {
  const stores = createInMemoryStores();
  await stores.session.set("sess_1", session(), "any");
  await stores.request.set("req_refused", request("req_refused", "completed", { output: refusal }), "absent");
  await stores.request.set(
    "req_hook_failed",
    request("req_hook_failed", "failed", { output: refusal, error: hookError }),
    "absent"
  );
  await stores.request.set("req_nothing", request("req_nothing", "completed", {}), "absent");
  await stores.request.set("req_legacy", request("req_legacy", "completed"), "absent");
  return stores;
}

async function list(stores: StoreRegistry, query: string): Promise<Record<string, Record<string, unknown>>> {
  const response = await handleListSessionRequests(
    new Request(`https://x/api/flows/sessions/sess_1/requests${query}`),
    route,
    { registry, stores }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { requests: Array<Record<string, unknown> & { id: string }> };
  return Object.fromEntries(body.requests.map((entry) => [entry.id, entry]));
}

describe("session request list: action results", () => {
  for (const query of ["", "?include_items=true"]) {
    it(`carries the error and whether there was an output, but not the output, by default (${query || "no flags"})`, async () => {
      const listed = await list(await seeded(), query);
      expect(listed.req_refused!.result).toEqual({ hasOutput: true });
      expect(listed.req_hook_failed!.result).toEqual({ error: hookError, hasOutput: true });
      expect(listed.req_nothing!.result).toEqual({ hasOutput: false });
      // A record from before results were stored lists as it always did (BP-030).
      expect(listed.req_legacy!.result).toBeUndefined();
    });
  }

  for (const query of ["?include_result_output=true", "?include_result_output=true&include_items=true"]) {
    it(`carries each output as stored when asked (${query})`, async () => {
      const listed = await list(await seeded(), query);
      expect(listed.req_refused!.result).toEqual({ output: refusal, hasOutput: true });
      expect(listed.req_hook_failed!.result).toEqual({ output: refusal, error: hookError, hasOutput: true });
      expect(listed.req_nothing!.result).toEqual({ hasOutput: false });
      expect(listed.req_legacy!.result).toBeUndefined();
    });
  }

  it("says an output that could not be recorded was not, without claiming one", async () => {
    const stores = await seeded();
    await stores.request.set(
      "req_bigint",
      request("req_bigint", "completed", { outputNotRecorded: true }),
      "absent"
    );
    const listed = await list(stores, "");
    expect(listed.req_bigint!.result).toEqual({ outputNotRecorded: true, hasOutput: false });
  });
});
