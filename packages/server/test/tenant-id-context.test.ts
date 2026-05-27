/**
 * FIX-406 6D (context axis + header extraction): an optional `tenantId` is
 * exposed on request/session/block context and extracted from a configurable
 * HTTP header (default `x-tenant-id`). Store-key isolation by tenant is a
 * separate, deferred change — this only threads the axis.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

function buildCapturingFlow(capture: { tenantId?: string; sessionTenantId?: string }) {
  const probe = handler({
    name: "probe",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: (_input, ctx) => {
      capture.tenantId = ctx.request.identity.tenantId;
      capture.sessionTenantId = ctx.session.identity.tenantId;
      return {};
    }
  });
  return defineFlow({
    kind: "tenant-flow",
    actions: { run: { inputSchema: z.object({}), block: probe } }
  });
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("tenantId context axis", () => {
  it("threads tenantId onto request and session identity (runAction)", async () => {
    const capture: { tenantId?: string; sessionTenantId?: string } = {};
    await runAction({
      flow: buildCapturingFlow(capture),
      actionName: "run",
      input: {},
      userId: "u",
      sessionId: "s",
      stores: createInMemoryStores(),
      responseEmitter: createResponseEmitter({ requestId: "req_tenant" }),
      tenantId: "tenant-a"
    });

    expect(capture.tenantId).toBe("tenant-a");
    expect(capture.sessionTenantId).toBe("tenant-a");
  });

  it("leaves tenantId undefined when not provided", async () => {
    const capture: { tenantId?: string; sessionTenantId?: string } = {};
    await runAction({
      flow: buildCapturingFlow(capture),
      actionName: "run",
      input: {},
      userId: "u",
      sessionId: "s",
      stores: createInMemoryStores(),
      responseEmitter: createResponseEmitter({ requestId: "req_no_tenant" })
    });

    expect(capture.tenantId).toBeUndefined();
  });

  it("extracts tenantId from the default x-tenant-id header", async () => {
    const capture: { tenantId?: string; sessionTenantId?: string } = {};
    const registry = createFlowRegistry();
    registry.register(buildCapturingFlow(capture));
    const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });

    const res = await router.POST(
      new Request("http://localhost/api/flows/tenant-flow/actions/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-tenant-id": "tenant-b"
        },
        body: JSON.stringify({ userId: "u", sessionId: "s2", input: {} })
      }),
      { params: { path: ["tenant-flow", "actions", "run"] } }
    );
    await drain(res.body);

    expect(capture.tenantId).toBe("tenant-b");
  });

  it("honors a configurable tenant header name", async () => {
    const capture: { tenantId?: string; sessionTenantId?: string } = {};
    const registry = createFlowRegistry();
    registry.register(buildCapturingFlow(capture));
    const router = createFlowApiRouter({
      registry,
      stores: createInMemoryStores(),
      tenantIdHeader: "x-org-tenant"
    });

    const res = await router.POST(
      new Request("http://localhost/api/flows/tenant-flow/actions/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-org-tenant": "tenant-c"
        },
        body: JSON.stringify({ userId: "u", sessionId: "s3", input: {} })
      }),
      { params: { path: ["tenant-flow", "actions", "run"] } }
    );
    await drain(res.body);

    expect(capture.tenantId).toBe("tenant-c");
  });
});
