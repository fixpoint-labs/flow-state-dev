/**
 * The request-end seam (FIX-2077): a hook a framework package registers from a
 * block runs once the request's work is over, after the drain of what
 * `onFinished` started, on every way a request ends.
 *
 * Why it matters: the claim gate settles a dispatched task here. A hook that
 * ran before the last drain would tell a task's filer "done" while background
 * work the flow's end hooks started was still writing.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { onRequestEnded, type RequestEnding } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The terminal request statuses in a stored event list, in order: what a stream client is told. */
const terminalTypes = (events: ReadonlyArray<{ type: string }>) =>
  events.map((event) => event.type).filter((type) => type === "request.completed" || type === "request.failed");

/** A tap that registers a hook recording how the request ended, and what had happened by then. */
function registering(log: string[], endings: RequestEnding[]) {
  return handler({
    name: "register-end",
    inputSchema: z.any(),
    execute: (_input, ctx) => {
      const registered = onRequestEnded(ctx, (ending) => {
        // What the request spent is request-spend.test.ts's; these read how it ended.
        const { spend: _spend, ...ended } = ending;
        endings.push(ended as RequestEnding);
        log.push(`end:${ending.status}`);
      });
      log.push(`registered:${registered}`);
    }
  });
}

/** Background work that writes after a delay, the way a side chain outlives its request's return. */
function slowWrite(log: string[], label: string) {
  return handler({
    name: `slow-${label}`,
    inputSchema: z.any(),
    execute: async () => {
      await sleep(40);
      log.push(`wrote:${label}`);
    }
  });
}

describe("request-end seam", () => {
  it("runs after the action's side chain and after the side chain onFinished starts", async () => {
    const log: string[] = [];
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "request-end-success",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(log, endings))
            .sideChain(slowWrite(log, "action"))
            .step(handler({ name: "answer", inputSchema: z.any(), execute: () => ({ ok: true }) }))
        }
      },
      request: {
        onFinished: sequencer({ name: "finished" }).sideChain(slowWrite(log, "on-finished"))
      }
    })();

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(log).toEqual(["registered:true", "wrote:action", "wrote:on-finished", "end:completed"]);
    expect(endings).toEqual([{ status: "completed" }]);
  });

  it("runs on a failed request, after the side chain onErrored starts", async () => {
    const log: string[] = [];
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "request-end-failure",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(log, endings))
            .step(
              handler({
                name: "boom",
                inputSchema: z.any(),
                execute: () => {
                  throw new Error("boom");
                }
              })
            ),
          onErrored: sequencer({ name: "errored" }).sideChain(slowWrite(log, "on-errored"))
        }
      }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error?.message).toBe("boom");
    expect(log).toEqual(["registered:true", "wrote:on-errored", "end:failed"]);
    expect(endings).toEqual([{ status: "failed", error: { message: "boom" } }]);
  });

  it("runs on a suspended request and names the suspension's reason", async () => {
    const log: string[] = [];
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "request-end-suspended",
      actions: {
        run: {
          inputSchema: z.any(),
          durable: true,
          block: sequencer({ name: "run", durable: true })
            .tap(registering(log, endings))
            .step(
              handler({
                name: "ask",
                inputSchema: z.any(),
                outputSchema: z.unknown(),
                execute: (_input, ctx) => ctx.suspend!({ reason: "user_input", message: "Which one?" })
              })
            )
        }
      }
    })();
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(endings).toEqual([{ status: "suspended", suspension: expect.objectContaining({ reason: "user_input", suspensionId: expect.any(String) }) }]);
  });

  it("runs on a suspended request before the request can be resumed", async () => {
    // A resume admitted while the suspended run's hook still runs would have
    // that hook write over it ("waiting on a person") as the resume works.
    const statusAtHook: Array<string | undefined> = [];
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "request-end-before-resumable",
      actions: {
        run: {
          inputSchema: z.any(),
          durable: true,
          block: sequencer({ name: "run", durable: true })
            .tap(
              handler({
                name: "register",
                inputSchema: z.any(),
                execute: (_input, ctx) => {
                  onRequestEnded(ctx, async () => {
                    statusAtHook.push((await stores.request.get(ctx.request.identity.id))?.status);
                  });
                }
              })
            )
            .step(
              handler({
                name: "ask",
                inputSchema: z.any(),
                outputSchema: z.unknown(),
                execute: (_input, ctx) => ctx.suspend!({ reason: "user_input", message: "Which one?" })
              })
            )
        }
      }
    })();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(statusAtHook).toHaveLength(1);
    expect(statusAtHook[0]).not.toBe("suspended");
    expect((await stores.request.get(result.requestId!))?.status).toBe("suspended");
  });

  it("keeps the heartbeat going while a suspended request's hooks run, so no sweep takes the request for dead", async () => {
    // The hooks run before the record says `suspended`, with the record still
    // `in_progress`: a request with no heartbeat then reads as a crashed run.
    const beats: number[] = [];
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "request-end-heartbeat",
      request: { heartbeatIntervalMs: 20 },
      actions: {
        run: {
          inputSchema: z.any(),
          durable: true,
          block: sequencer({ name: "run", durable: true })
            .tap(
              handler({
                name: "register",
                inputSchema: z.any(),
                execute: (_input, ctx) => {
                  onRequestEnded(ctx, async () => {
                    const id = ctx.request.identity.id;
                    beats.push((await stores.activeRequests.get(id))!.lastHeartbeatAt);
                    await sleep(150);
                    beats.push((await stores.activeRequests.get(id))!.lastHeartbeatAt);
                  });
                }
              })
            )
            .step(
              handler({
                name: "ask",
                inputSchema: z.any(),
                outputSchema: z.unknown(),
                execute: (_input, ctx) => ctx.suspend!({ reason: "user_input", message: "Which one?" })
              })
            )
        }
      }
    })();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(beats).toHaveLength(2);
    expect(beats[1]!).toBeGreaterThan(beats[0]!);
  });

  it("logs a failure a hook hands back on a request that already failed", async () => {
    // On a failed request the engine has no outcome left to change, so the
    // failure (a task attempt whose fail could not be written) must not vanish.
    const warnings: Array<{ message: string; data?: unknown }> = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (message: string, data?: unknown) => void warnings.push({ message, data }),
      error: (message: string, data?: unknown) => void warnings.push({ message, data })
    };
    const flow = defineFlow({
      kind: "request-end-verdict-on-failure",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(
              handler({
                name: "register",
                inputSchema: z.any(),
                execute: (_input, ctx) => {
                  onRequestEnded(ctx, () => ({ fail: new Error("the attempt's failure could not be recorded") }));
                }
              })
            )
            .step(
              handler({
                name: "boom",
                inputSchema: z.any(),
                execute: () => {
                  throw new Error("boom");
                }
              })
            )
        }
      }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores(),
      runtimeConfig: { logger } as never
    });

    expect(result.error?.message).toBe("boom");
    expect(
      warnings.some(
        (w) => w.message.includes("request-end hook") && JSON.stringify(w.data).includes("the attempt's failure could not be recorded")
      )
    ).toBe(true);
  });

  it("a hook that hands back a failure fails a completed request, on its record and its result", async () => {
    const flow = defineFlow({
      kind: "request-end-verdict",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(
              handler({
                name: "register",
                inputSchema: z.any(),
                execute: (_input, ctx) => {
                  onRequestEnded(ctx, () => ({ fail: new Error("the result could not be recorded") }));
                }
              })
            )
            .step(handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" }))
        }
      }
    })();
    const stores = createInMemoryStores();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });

    expect(result.error?.message).toContain("the result could not be recorded");
    const record = await stores.request.get(result.requestId!);
    expect(record?.status).toBe("failed");
  });

  it("a stream client sees one terminal status, `failed`, when a hook hands back a failure: no `completed` before it", async () => {
    const flow = defineFlow({
      kind: "request-end-verdict-stream",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(
              handler({
                name: "register",
                inputSchema: z.any(),
                execute: (_input, ctx) => {
                  onRequestEnded(ctx, () => ({ fail: new Error("the result could not be recorded") }));
                }
              })
            )
            .step(handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" }))
        }
      }
    })();
    const stores = createInMemoryStores();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {}
    });

    expect(terminalTypes(await stores.request.getEvents(result.requestId!))).toEqual(["request.failed"]);
  });

  it("a request that owes no hook emits `completed` where it did, before `onFinished` runs; one that owes a hook emits it after", async () => {
    const seenAtOnFinished: Record<string, string[]> = {};
    const stores = createInMemoryStores();
    const flowWith = (kind: string, hook: boolean) =>
      defineFlow({
        kind,
        actions: {
          run: {
            inputSchema: z.any(),
            block: sequencer({ name: "run" })
              .tap(
                handler({
                  name: "register",
                  inputSchema: z.any(),
                  execute: (_input, ctx) => {
                    if (hook) onRequestEnded(ctx, () => {});
                  }
                })
              )
              .step(handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" }))
          }
        },
        request: {
          onFinished: handler({
            name: "finished",
            inputSchema: z.any(),
            execute: async (input: { requestId: string }) => {
              seenAtOnFinished[kind] = terminalTypes(await stores.request.getEvents(input.requestId));
            }
          })
        }
      })();

    const results: Record<string, string> = {};
    for (const [kind, hook] of [["no-hook", false], ["owes-hook", true]] as const) {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: flowWith(kind, hook),
        actionName: "run",
        input: {},
        userId: "u1",
        sessionId: `s-${kind}`,
        stores,
        runtimeConfig: {}
      });
      results[kind] = result.requestId!;
    }

    expect(seenAtOnFinished["no-hook"]).toEqual(["request.completed"]);
    expect(seenAtOnFinished["owes-hook"]).toEqual([]);
    expect(terminalTypes(await stores.request.getEvents(results["no-hook"]!))).toEqual(["request.completed"]);
    expect(terminalTypes(await stores.request.getEvents(results["owes-hook"]!))).toEqual(["request.completed"]);
  });

  it("a hook that throws leaves the request's outcome as it was", async () => {
    const flow = defineFlow({
      kind: "request-end-throws",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(
              handler({
                name: "register",
                inputSchema: z.any(),
                execute: (_input, ctx) => {
                  onRequestEnded(ctx, () => {
                    throw new Error("hook failed");
                  });
                }
              })
            )
            .step(handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" }))
        }
      }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("fine");
  });
});
