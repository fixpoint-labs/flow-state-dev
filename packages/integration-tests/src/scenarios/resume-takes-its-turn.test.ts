/**
 * A resumed request takes its turn in its session.
 *
 * A request that parks on a person's approval gives its session's place back,
 * so another request on the session can run while the person decides. When the
 * person approves, the resumed run must wait for that request to finish rather
 * than start beside it: two runs in one session would write its state at once.
 *
 * Driven end to end through the shipped composition: `createFlowState`'s
 * router, the inbound host and its concurrency arbiter, and `runAction`. The
 * approval goes through the public resume route, as a person's client sends
 * it. The resume answers `202` at once; the resumed step does not start until
 * the running request ends, and then the parked request completes under its
 * own id.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";

const FLOW_KIND = "resume-turn";
const USER = "u_approver";
const SESSION = "s_shared";

/** Each blocking step records itself while it runs, until the test lets it finish. */
function harness() {
  const live = new Set<string>();
  const gates = new Map<string, () => void>();
  let overlapped = false;

  const blocking = (name: string) => async (): Promise<{ ok: true }> => {
    if (live.size > 0) overlapped = true;
    live.add(name);
    try {
      await new Promise<void>((resolve) => gates.set(name, resolve));
    } finally {
      live.delete(name);
    }
    return { ok: true };
  };

  const flow = defineFlow({
    kind: FLOW_KIND,
    actions: {
      // Parks on an approval, then runs a step that blocks.
      transfer: {
        concurrency: "queue",
        inputSchema: z.object({}).passthrough(),
        block: sequencer({ name: "transferTurn", durable: true })
          .step(
            handler({
              name: "approve",
              inputSchema: z.any(),
              outputSchema: z.unknown(),
              execute: async (_input, ctx) => ctx.suspend!({ reason: "user_approval", message: "Send it?" })
            })
          )
          .step(
            handler({ name: "afterApproval", inputSchema: z.any(), outputSchema: z.any(), execute: blocking("resumed") })
          )
      },
      // Blocks while it holds the session.
      work: {
        concurrency: "queue",
        inputSchema: z.object({}).passthrough(),
        block: handler({ name: "work", inputSchema: z.any(), outputSchema: z.any(), execute: blocking("work") })
      }
    }
  })({ id: FLOW_KIND });

  const release = (name: string): void => {
    const open = gates.get(name);
    gates.delete(name);
    open?.();
  };

  return {
    flow,
    live,
    release,
    get overlapped() {
      return overlapped;
    }
  };
}

const states: FlowState[] = [];

afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
});

async function post(state: FlowState, path: string[], body: unknown): Promise<Response> {
  const router = await state.getRouter();
  return router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
}

/** The request id an action route's `202` acknowledges. */
async function acceptedId(response: Response): Promise<string> {
  return ((await response.json()) as { request: { id: string } }).request.id;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Long enough for a resumed run that was wrongly let through to reach its step. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 200));

describe("a resumed request takes its turn in its session", () => {
  it("an approval that lands while another request runs waits for it, then completes the parked request", async () => {
    const h = harness();
    const state = createFlowState({
      flows: { [FLOW_KIND]: h.flow },
      stores: { default: { primary: inMemoryStores() } },
      durable: true
    });
    states.push(state);
    const { stores } = await state.getRuntime();
    const statusOf = async (requestId: string) => (await stores.request.get(requestId))?.status;

    // The transfer parks on its approval and gives the session back.
    const parked = await post(state, [FLOW_KIND, "actions", "transfer"], {
      userId: USER,
      sessionId: SESSION,
      input: {}
    });
    expect(parked.status).toBe(202);
    const requestId = await acceptedId(parked);
    await until(async () => (await statusOf(requestId)) === "suspended");
    const [gate] = await stores.suspensions.list({ sessionId: SESSION });
    expect(gate).toMatchObject({ requestId, status: "pending" });

    // Another request takes the session.
    const work = await post(state, [FLOW_KIND, "actions", "work"], { userId: USER, sessionId: SESSION, input: {} });
    expect(work.status).toBe(202);
    const workId = await acceptedId(work);
    await until(() => h.live.has("work"));

    // The person approves. The answer is accepted at once; the resumed step
    // does not start while `work` holds the session.
    const resumed = await post(state, [FLOW_KIND, "requests", requestId, "resume"], {
      userId: USER,
      suspensionId: gate!.suspensionId,
      action: "approve"
    });
    expect(resumed.status).toBe(202);
    await settle();
    expect(h.live.has("resumed")).toBe(false);
    expect(await statusOf(requestId)).toBe("suspended");
    expect((await stores.suspensions.list({ sessionId: SESSION }))[0]).toMatchObject({ status: "approved" });

    // `work` ends; the parked request takes its turn and completes in place.
    h.release("work");
    await until(async () => (await statusOf(workId)) === "completed");
    await until(() => h.live.has("resumed"));
    h.release("resumed");
    await until(async () => {
      const record = await stores.request.get(requestId);
      return record?.status === "completed" && record.finalizedAtMs != null;
    });
    expect(h.overlapped).toBe(false);
  });
});
