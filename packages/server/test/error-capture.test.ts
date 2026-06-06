import { describe, it, expect, vi } from "vitest";
import { FlowError } from "../src/errors/flow-error";
import {
  toErrorCaptureEvent,
  safeCaptureError,
  type ErrorCaptureEvent,
  type ErrorCaptureIdentity
} from "../src/errors/error-capture";

const identity: ErrorCaptureIdentity = {
  requestId: "req_1",
  flowKind: "demo",
  actionName: "run",
  userId: "user_1",
  sessionId: "sess_1",
  orgId: "org_1"
};

describe("toErrorCaptureEvent", () => {
  it("merges request identity with block overrides, preferring overrides", () => {
    const error = new FlowError("boom", {
      code: "tool_execution_error",
      retryable: false,
      blockName: "carried-on-error",
      blockInstanceId: "carried-instance",
      scope: "block"
    });

    const event = toErrorCaptureEvent(error, identity, {
      blockName: "fetch-news",
      blockKind: "generator",
      blockInstanceId: "req_1:root/step[0]",
      blockPath: "root/step[0]",
      attempt: 2,
      transient: false
    });

    expect(event).toMatchObject({
      error,
      requestId: "req_1",
      flowKind: "demo",
      actionName: "run",
      userId: "user_1",
      sessionId: "sess_1",
      orgId: "org_1",
      blockName: "fetch-news",
      blockKind: "generator",
      blockInstanceId: "req_1:root/step[0]",
      blockPath: "root/step[0]",
      attempt: 2,
      scope: "block",
      transient: false
    });
  });

  it("falls back to FlowError fields when no block override is given", () => {
    const error = new FlowError("boom", {
      code: "network_error",
      retryable: true,
      blockName: "root-block",
      scope: "block"
    });

    const event = toErrorCaptureEvent(error, identity);

    expect(event.blockName).toBe("root-block");
    expect(event.scope).toBe("block");
    expect(event.blockKind).toBeUndefined();
    expect(event.attempt).toBeUndefined();
  });

  it("uses the block-info scope only when the error carries none", () => {
    const error = new FlowError("boom", { code: "execution_error", retryable: false });
    const event = toErrorCaptureEvent(error, identity, { scope: "request" });
    expect(event.scope).toBe("request");
  });
});

describe("safeCaptureError", () => {
  it("delivers the event to the handler", async () => {
    const handler = vi.fn();
    const event = { requestId: "req_1" } as unknown as ErrorCaptureEvent;
    await safeCaptureError(handler, event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("swallows a synchronous throw and logs warn", async () => {
    const warn = vi.fn();
    const handler = () => {
      throw new Error("handler exploded");
    };
    await expect(
      safeCaptureError(handler, { requestId: "req_1" } as unknown as ErrorCaptureEvent, {
        warn
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("swallows an async rejection without surfacing it", async () => {
    const warn = vi.fn();
    const handler = async () => {
      throw new Error("async boom");
    };
    await expect(
      safeCaptureError(handler, { requestId: "req_1" } as unknown as ErrorCaptureEvent, {
        warn
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
