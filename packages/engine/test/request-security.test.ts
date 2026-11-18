/** Browser request guards on the public HTTP router. */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry } from "../src";
import { disposeFlowApiRouter } from "../src/routes/createFlowApiRouter";

const routers: ReturnType<typeof createFlowApiRouter>[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
});

function makeRouter() {
  const registry = createFlowRegistry();
  registry.register(defineFlow({
    kind: "security",
    actions: { run: handler({ name: "run", execute: () => ({ ok: true }) }) }
  })());
  const router = createFlowApiRouter({ registry, resolvePrincipal: () => ({ userId: "test", orgId: "test" }) });
  routers.push(router);
  return router;
}

function actionRequest(body?: string, contentType?: string) {
  const request = new Request("http://localhost/api/flows/security/actions/run", {
    method: "POST", body,
    headers: contentType === undefined ? {} : { "content-type": contentType }
  });
  if (contentType === undefined) request.headers.delete("content-type");
  return request;
}

const actionContext = { params: { path: ["security", "actions", "run"] } };

describe("JSON request media type", () => {
  it.each([undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])(
    "refuses a non-empty action body sent as %s",
    async (contentType) => {
      const response = await makeRouter().POST(actionRequest("{}", contentType), actionContext);
      expect(response.status).toBe(415);
    }
  );
  it.each(["application/json", "application/json; charset=utf-8", "Application/JSON"])("accepts %s", async (contentType) => {
    expect((await makeRouter().POST(actionRequest("{}", contentType), actionContext)).status).toBe(202);
  });
  it("accepts an empty body with no content type", async () => {
    expect((await makeRouter().POST(actionRequest(), actionContext)).status).toBe(202);
  });
});

describe("browser fetch metadata", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses cross-site %s before dispatch", async (method) => {
    const request = new Request("http://localhost/api/flows/security/actions/run", {
      method, headers: { "sec-fetch-site": "cross-site" }
    });
    expect((await makeRouter().POST(request, actionContext)).status).toBe(403);
  });
  it.each([undefined, "same-origin", "same-site", "none"])("allows %s action requests", async (site) => {
    const request = actionRequest("{}", "application/json");
    if (site !== undefined) request.headers.set("sec-fetch-site", site);
    expect((await makeRouter().POST(request, actionContext)).status).toBe(202);
  });
  it("allows cross-site reads", async () => {
    const response = await makeRouter().GET(new Request("http://localhost/api/flows", {
      headers: { "sec-fetch-site": "cross-site" }
    }), { params: { path: [] } });
    expect(response.status).toBe(200);
  });
});


it("leaves inbound transport POSTs to their adapter", async () => {
  const router = createFlowApiRouter({
    registry: createFlowRegistry(),
    adapters: [{
      source: "test",
      createBindings: () => ({ routes: [{
        method: "POST",
        path: "/api/flows/inbound",
        handler: async (request) => new Response(await request.text(), { status: 202 })
      }] })
    }]
  });
  routers.push(router);
  const response = await router.POST(new Request("http://localhost/api/flows/inbound", {
    method: "POST", body: "provider payload",
    headers: { "sec-fetch-site": "cross-site", "content-type": "text/plain" }
  }), { params: { path: ["inbound"] } });
  expect(response.status).toBe(202);
  expect(await response.text()).toBe("provider payload");
});
