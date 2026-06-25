/**
 * Unit tests for the concurrency arbiter (FIX-837): key resolution across the
 * preset/custom key forms, the per-policy decision shapes, the synchronous
 * `reject` admission (gate throws on a held key, releases on settle), and that
 * a reject names the in-flight requestId. The keyed-gate mechanics themselves
 * are covered separately.
 */
import { describe, expect, it } from "vitest";
import {
  createConcurrencyArbiter,
  type ConcurrencyFlowView
} from "../../../src/transports/concurrency/arbiter";
import { ConcurrencyRejectedError } from "../../../src/transports/errors";
import type { DispatchEnvelope } from "../../../src/transports/dispatcher";

function envelope(overrides: Partial<DispatchEnvelope> = {}): DispatchEnvelope {
  return {
    requestId: "req_1",
    flowKind: "chat",
    actionName: "respond",
    input: {},
    userId: "u_1",
    sessionId: "s_1",
    ...overrides
  };
}

function flow(view: Partial<ConcurrencyFlowView> = {}): ConcurrencyFlowView {
  return { actions: {}, ...view };
}

describe("arbiter.resolve — policy resolution", () => {
  it("defaults to allow on the session key when nothing is configured", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(flow(), "respond", envelope());
    expect(d.policy).toBe("allow");
    expect(d.key).toBe("s_1");
  });

  it("per-action concurrency wins over the flow request default", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(
      flow({ actions: { respond: { concurrency: "reject" } }, request: { concurrency: "queue" } }),
      "respond",
      envelope()
    );
    expect(d.policy).toBe("reject");
  });

  it("falls back to the flow request default when the action has none", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(flow({ request: { concurrency: "queue" } }), "respond", envelope());
    expect(d.policy).toBe("queue");
  });
});

describe("arbiter.resolve — key resolution", () => {
  it("tenant-namespaces the session key", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(flow(), "respond", envelope({ tenantId: "t_1" }));
    expect(d.key).toBe("t_1:s_1");
  });

  it("resolves the user key (tenant-namespaced)", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(
      flow({ actions: { respond: { concurrency: { policy: "queue", key: "user" } } } }),
      "respond",
      envelope({ tenantId: "t_1" })
    );
    expect(d.key).toBe("t_1:u_1");
  });

  it("resolves key 'none' to undefined (no arbitration)", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(
      flow({ actions: { respond: { concurrency: { policy: "queue", key: "none" } } } }),
      "respond",
      envelope()
    );
    expect(d.key).toBeUndefined();
  });

  it("resolves an undefined session (MCP / ephemeral) to undefined for the session key", () => {
    const arbiter = createConcurrencyArbiter();
    const d = arbiter.resolve(flow(), "respond", envelope({ sessionId: undefined }));
    expect(d.key).toBeUndefined();
  });

  it("invokes a custom key function with the dispatch context", () => {
    const arbiter = createConcurrencyArbiter();
    const seen: string[] = [];
    const d = arbiter.resolve(
      flow({
        actions: {
          respond: {
            concurrency: {
              policy: "reject",
              key: (ctx) => {
                seen.push(ctx.actionName);
                return (ctx.metadata?.deliveryId as string) ?? undefined;
              }
            }
          }
        }
      }),
      "respond",
      envelope({ metadata: { deliveryId: "d_99" } })
    );
    expect(d.key).toBe("d_99");
    expect(seen).toEqual(["respond"]);
  });
});

describe("arbiter — reject policy", () => {
  it("admits the first request and rejects a concurrent second, naming the in-flight requestId", async () => {
    const arbiter = createConcurrencyArbiter();
    const f = flow({ actions: { respond: { concurrency: "reject" } } });

    const d1 = arbiter.resolve(f, "respond", envelope({ requestId: "req_1" }));
    let release1!: () => void;
    const held = new Promise<void>((r) => (release1 = r));
    const run1 = arbiter.gate(d1, "req_1")(() => held);

    const d2 = arbiter.resolve(f, "respond", envelope({ requestId: "req_2" }));
    expect(() => arbiter.gate(d2, "req_2")).toThrow(ConcurrencyRejectedError);
    try {
      arbiter.gate(d2, "req_2");
    } catch (e) {
      expect((e as ConcurrencyRejectedError).inFlightRequestId).toBe("req_1");
      expect((e as ConcurrencyRejectedError).status).toBe(409);
    }

    // Once the first run finishes, a later request is admitted again.
    release1();
    await run1;
    const d3 = arbiter.resolve(f, "respond", envelope({ requestId: "req_3" }));
    expect(() => arbiter.gate(d3, "req_3")).not.toThrow();
  });

  it("gate for allow and queue never throws on construction", () => {
    const arbiter = createConcurrencyArbiter();
    const allowDecision = arbiter.resolve(flow(), "respond", envelope());
    const queueDecision = arbiter.resolve(
      flow({ actions: { respond: { concurrency: "queue" } } }),
      "respond",
      envelope()
    );
    expect(() => arbiter.gate(allowDecision, "r1")).not.toThrow();
    expect(() => arbiter.gate(queueDecision, "r2")).not.toThrow();
  });
});

describe("arbiter — queue policy", () => {
  it("serializes two dispatches on one key with no temporal overlap", async () => {
    const arbiter = createConcurrencyArbiter();
    const f = flow({ actions: { respond: { concurrency: "queue" } } });
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;

    const dispatch = (n: number) => {
      const env = envelope({ requestId: `req_${n}` });
      const d = arbiter.resolve(f, "respond", env);
      return arbiter.gate(d, `req_${n}`)(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(n);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    };

    await Promise.all([dispatch(1), dispatch(2)]);
    expect(order).toEqual([1, 2]);
    expect(maxActive).toBe(1);
  });
});

describe("arbiter — allow policy", () => {
  it("gate is a passthrough (no serialization)", async () => {
    const arbiter = createConcurrencyArbiter();
    const f = flow();
    let active = 0;
    let maxActive = 0;

    const dispatch = (n: number) => {
      const env = envelope({ requestId: `req_${n}` });
      const d = arbiter.resolve(f, "respond", env);
      return arbiter.gate(d, `req_${n}`)(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    };

    await Promise.all([dispatch(1), dispatch(2)]);
    expect(maxActive).toBe(2);
  });
});
