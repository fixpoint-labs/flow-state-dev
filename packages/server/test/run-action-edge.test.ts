import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction, ValidationError } from "../src";
import { runActionInternal } from "../src/execution/runAction";

describe("runAction edge behavior", () => {
  it("throws when requested action is missing", async () => {
    const flow = defineFlow({
      kind: "missing-action-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      }
    })();

    await expect(
      runAction({
        flow,
        actionName: "notReal" as "run",
        input: { value: 1 },
        userId: "user_missing",
        sessionId: "sess_missing",
        stores: createInMemoryStores()
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns failed result when action input validation fails", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "invalid-input-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "not-a-number" },
      requestId: "req_invalid_input",
      userId: "user_invalid_input",
      sessionId: "sess_invalid_input",
      stores
    });

    expect(result.error?.code).toBe("validation_error");
    expect((await stores.request.get("req_invalid_input"))?.status).toBe("failed");
  });

  it("propagates onStarted observer failures", async () => {
    const flow = defineFlow({
      kind: "started-observer-fail",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      },
      request: {
        onStarted: handler<any, void>({
          name: "request-started-observer",
          execute: () => {
            throw new Error("observer start failure");
          }
        })
      }
    })();

    await expect(
      runAction({
        flow,
        actionName: "run",
        input: { value: 1 },
        userId: "user_started_error",
        sessionId: "sess_started_error",
        stores: createInMemoryStores()
      })
    ).rejects.toThrow("observer start failure");
  });

  it("suppresses onErrored/onFinished observer failures and still returns failed result", async () => {
    const flow = defineFlow({
      kind: "errored-observer-fail",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => {
              throw new Error("primary failure");
            }
          }),
          onErrored: handler<any, void>({
            name: "action-errored-observer",
            execute: () => {
              throw new Error("action observer failed");
            }
          })
        }
      },
      request: {
        onErrored: handler<any, void>({
          name: "request-errored-observer",
          execute: () => {
            throw new Error("request errored observer failed");
          }
        }),
        onFinished: handler<any, void>({
          name: "request-finished-observer",
          execute: () => {
            throw new Error("request finished observer failed");
          }
        })
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_observer_fail",
      userId: "user_observer_fail",
      sessionId: "sess_observer_fail",
      stores: createInMemoryStores()
    });

    expect(result.error?.message).toBe("primary failure");
  });

  it("generates request ids when omitted and emits internal action seam lifecycle stages", async () => {
    const stores = createInMemoryStores();
    const lifecycleStages: string[] = [];

    const successFlow = defineFlow({
      kind: "internal-seam-success",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      }
    })();

    const success = await runActionInternal({
      flow: successFlow,
      actionName: "run",
      input: { value: 1 },
      userId: "user_generated_request",
      sessionId: "sess_generated_request",
      stores,
      internalSeams: {
        onActionLifecycle: (stage) => {
          lifecycleStages.push(stage);
        }
      }
    });

    expect(success.error).toBeUndefined();
    expect(lifecycleStages).toEqual(["started", "completed", "finished"]);

    const requests = await stores.request.list({});
    expect(requests).toHaveLength(1);
    expect(requests[0]?.id.startsWith("req_")).toBe(true);

    lifecycleStages.length = 0;

    const failureFlow = defineFlow({
      kind: "internal-seam-failure",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => {
              throw new Error("failure");
            }
          })
        }
      }
    })();

    const failed = await runActionInternal({
      flow: failureFlow,
      actionName: "run",
      input: { value: 1 },
      userId: "user_generated_request_2",
      sessionId: "sess_generated_request_2",
      stores: createInMemoryStores(),
      internalSeams: {
        onActionLifecycle: (stage) => {
          lifecycleStages.push(stage);
        }
      }
    });

    expect(failed.error?.message).toBe("failure");
    expect(lifecycleStages).toEqual(["started", "errored", "finished"]);
  });

  it("uses default internal seams when runActionInternal does not receive one", async () => {
    const flow = defineFlow({
      kind: "default-internal-seams",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      }
    })();

    const result = await runActionInternal({
      flow,
      actionName: "run",
      input: { value: 1 },
      userId: "user_default_seams",
      sessionId: "sess_default_seams",
      stores: createInMemoryStores()
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("ok");
  });

  it("skips request patch updates when request store returns undefined", async () => {
    const stores = createInMemoryStores();
    const originalGet = stores.request.get.bind(stores.request);
    let getCalls = 0;
    stores.request.get = async (id) => {
      getCalls += 1;
      if (getCalls > 1) {
        return undefined;
      }

      return originalGet(id);
    };

    const flow = defineFlow({
      kind: "request-patch-missing",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_patch_missing",
      userId: "user_patch_missing",
      sessionId: "sess_patch_missing",
      stores
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("ok");
  });

  it("handles malformed schema parse errors with no issue details", async () => {
    const malformedFlow = {
      kind: "malformed-schema-flow",
      actions: {
        run: {
          inputSchema: {
            safeParse: () => ({
              success: false as const,
              error: {
                issues: []
              }
            })
          },
          block: handler<{ value: number }, string>({
            name: "run",
            execute: () => "ok"
          })
        }
      }
    } as any;

    const result = await runAction({
      flow: malformedFlow,
      actionName: "run",
      input: {},
      requestId: "req_malformed_schema",
      userId: "user_malformed_schema",
      sessionId: "sess_malformed_schema",
      stores: createInMemoryStores()
    });

    expect(result.error?.code).toBe("validation_error");
    expect(result.error?.message).toContain("schema validation failed");
  });

  it("skips terminal error item emission when response is unavailable", async () => {
    const flow = defineFlow({
      kind: "terminal-error-guard",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler<{ value: number }, string>({
            name: "run",
            execute: (_input, ctx) => {
              (ctx as any).response = null;
              throw new Error("primary failure");
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_terminal_guard",
      userId: "user_terminal_guard",
      sessionId: "sess_terminal_guard",
      stores: createInMemoryStores()
    });

    expect(result.error?.message).toBe("primary failure");
    expect(result.items.some((item) => item.type === "fsd:error")).toBe(false);
  });
});
