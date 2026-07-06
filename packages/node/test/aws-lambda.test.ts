import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FlowApiRouter } from "@flow-state-dev/engine";
import { createLambdaHandler } from "../src/aws-lambda";

// `streamHandle` reads the `awslambda` global at construction time; the Lambda
// runtime injects it. Stub the contract it touches so we can verify the handler
// is built. End-to-end streaming is validated by the deploy spike, not CI.
const realAwsLambda = (globalThis as Record<string, unknown>).awslambda;
beforeAll(() => {
  (globalThis as Record<string, unknown>).awslambda = {
    streamifyResponse: (fn: unknown) => fn,
    HttpResponseStream: { from: (stream: unknown) => stream },
  };
});
afterAll(() => {
  (globalThis as Record<string, unknown>).awslambda = realAwsLambda;
});

const echoRouter: FlowApiRouter = {
  GET: async (_req, ctx) =>
    new Response(JSON.stringify({ path: ctx.params.path }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  POST: async () => new Response(null, { status: 202 }),
  PATCH: async () => new Response(null, { status: 200 }),
  DELETE: async () => new Response(null, { status: 204 }),
};

describe("createLambdaHandler", () => {
  // Full request/response behaviour runs through the same portable app covered
  // by app.test.ts; invoking the streaming handler end-to-end needs Lambda's
  // `awslambda` streaming runtime, which is validated by the deploy spike, not CI.
  it("returns a Lambda handler function for a raw router", () => {
    const handler = createLambdaHandler(echoRouter);
    expect(typeof handler).toBe("function");
  });

  it("returns a Lambda handler function for a FlowState-shaped app", () => {
    // construction must not require store init to have settled
    const handler = createLambdaHandler(echoRouter, { basePath: "/api/flows" });
    expect(typeof handler).toBe("function");
  });
});
