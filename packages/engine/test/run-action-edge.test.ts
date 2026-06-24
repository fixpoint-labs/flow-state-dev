import { defineFlow, generator, handler } from "@flow-state-dev/core";
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
        stores: createInMemoryStores(),
        runtimeConfig: {}
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      stores,
      runtimeConfig: {}
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
            execute: () => "ok"
          })
        }
      },
      request: {
        onStarted: handler({
          name: "request-started-observer",
          inputSchema: z.any(),
          outputSchema: z.any(),
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
        stores: createInMemoryStores(),
        runtimeConfig: {}
      })
    ).rejects.toThrow("observer start failure");
  });

  it("suppresses onErrored/onFinished observer failures and still returns failed result", async () => {
    const flow = defineFlow({
      kind: "errored-observer-fail",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
            execute: () => {
              throw new Error("primary failure");
            }
          }),
          onErrored: handler({
            name: "action-errored-observer",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: () => {
              throw new Error("action observer failed");
            }
          })
        }
      },
      request: {
        onErrored: handler({
          name: "request-errored-observer",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => {
            throw new Error("request errored observer failed");
          }
        }),
        onFinished: handler({
          name: "request-finished-observer",
          inputSchema: z.any(),
          outputSchema: z.any(),
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
      stores: createInMemoryStores(),
      runtimeConfig: {}
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      runtimeConfig: {},
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      runtimeConfig: {},
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      stores: createInMemoryStores(),
      runtimeConfig: {}
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      stores,
      runtimeConfig: {}
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
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error?.code).toBe("validation_error");
    expect(result.error?.message).toContain("schema validation failed");
  });



  it("enforces token budget with onExceeded=error", async () => {
    const block = generator({
      name: "budget-generator-error",
      model: "openai/gpt-5-mini",
      prompt: () => "prompt",
      user: () => "hello"
    });

    const flow = defineFlow({
      kind: "budget-error-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block,
          tokenBudget: {
            maxTotalTokens: 5,
            onExceeded: "error"
          }
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: 1 },
      userId: "user_budget_error",
      sessionId: "sess_budget_error",
      requestId: "req_budget_error",
      stores: createInMemoryStores(),
      runtimeConfig: {
        modelResolver: () => ({
          modelId: "openai/gpt-5-mini",
          async generate() {
            return {
              text: "ok",
              usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 }
            };
          }
        })
      }
    });

    expect(result.error?.code).toBe("validation_error");
    expect(result.error?.message).toContain("Token budget exceeded");
  });

  it("emits a single exceeded warning when onExceeded=warn", async () => {
    const block = generator({
      name: "budget-generator-warn",
      model: "openai/gpt-5-mini",
      prompt: () => "prompt",
      user: () => "hello"
    });

    const flow = defineFlow({
      kind: "budget-warn-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block,
          tokenBudget: {
            maxTotalTokens: 5,
            warnAt: 0.5,
            onExceeded: "warn"
          }
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: 1 },
      userId: "user_budget_warn",
      sessionId: "sess_budget_warn",
      requestId: "req_budget_warn",
      stores: createInMemoryStores(),
      runtimeConfig: {
        modelResolver: () => ({
          modelId: "openai/gpt-5-mini",
          async generate() {
            return {
              text: "ok",
              usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 }
            };
          }
        })
      }
    });

    const warnings = result.items.filter((item) => item.type === "status" && (item as { message?: string }).message?.includes("Token budget"));
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as { message: string }).message).toContain("exceeded");
  });

  it("marks request incomplete when onExceeded=stop", async () => {
    const block = generator({
      name: "budget-generator-stop",
      model: "openai/gpt-5-mini",
      prompt: () => "prompt",
      user: () => "hello"
    });

    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "budget-stop-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block,
          tokenBudget: {
            maxTotalTokens: 5,
            onExceeded: "stop"
          },
          onCompleted: handler({
            name: "should-not-run",
            execute: () => {
              throw new Error("onCompleted should not execute for stop");
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: 1 },
      userId: "user_budget_stop",
      sessionId: "sess_budget_stop",
      requestId: "req_budget_stop",
      stores,
      runtimeConfig: {
        modelResolver: () => ({
          modelId: "openai/gpt-5-mini",
          async generate() {
            return {
              text: "ok",
              usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 }
            };
          }
        })
      }
    });

    expect(result.error).toBeUndefined();
    expect((await stores.request.get("req_budget_stop"))?.status).toBe("incomplete");
  });

  it("skips terminal error item emission when response is unavailable", async () => {
    const flow = defineFlow({
      kind: "terminal-error-guard",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "run",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
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
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error?.message).toBe("primary failure");
    expect(result.items.some((item) => item.type === "error")).toBe(false);
  });
});
