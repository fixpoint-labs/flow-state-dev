/**
 * `hold` and `defer` through the real `host.dispatch` seam.
 *
 * A `hold` request occupies its key while it runs, and never waits for it or
 * is refused on it. A `defer` request waits until nothing holds or waits on the
 * key, then runs. The flow below models a conversation: `reply` is a person's
 * turn (`hold`), `notify` is a follow-up the app wants after the turn
 * (`defer`). Each case asserts what a person in that conversation would see:
 * whether a run starts, and in what order.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { ConcurrencyConfig } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
import { abortRequest } from "../../src/execution/abort-registry";
import {
  createConcurrencyArbiter,
  type ConcurrencyArbiter
} from "../../src/transports/concurrency/arbiter";
import { ConcurrencyDeferLimitError } from "../../src/transports/errors";

type Gate = { id: string; release: () => void; fail: (error: Error) => void };

/**
 * One flow, two actions that block until the test releases them, so timing
 * is deterministic. `live` is what is running now; `started` is start order.
 */
function buildHost(
  policies: { reply: ConcurrencyConfig; notify: ConcurrencyConfig },
  arbiter?: ConcurrencyArbiter
) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const gates: Gate[] = [];
  const live: string[] = [];
  const started: string[] = [];

  const block = (name: string) =>
    handler<{ value: string }, { ok: true }>({
      name,
      execute: async (input, ctx) => {
        const id = input.value;
        live.push(id);
        started.push(id);
        try {
          await new Promise<void>((resolve, reject) => {
            gates.push({ id, release: resolve, fail: reject });
            ctx.signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          });
        } finally {
          live.splice(live.indexOf(id), 1);
        }
        return { ok: true };
      }
    });

  registry.register(
    defineFlow({
      kind: "conversation",
      actions: {
        reply: {
          concurrency: policies.reply,
          inputSchema: z.object({ value: z.string() }),
          block: block("reply")
        },
        notify: {
          concurrency: policies.notify,
          inputSchema: z.object({ value: z.string() }),
          block: block("notify")
        },
        strict: {
          concurrency: "reject",
          inputSchema: z.object({ value: z.string() }),
          block: block("strict")
        }
      }
    })({ id: "conversation" })
  );

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    ...(arbiter !== undefined ? { arbiter } : {})
  });

  const gate = (id: string): Gate => {
    const found = gates.find((g) => g.id === id);
    if (found === undefined) throw new Error(`"${id}" is not running`);
    gates.splice(gates.indexOf(found), 1);
    return found;
  };

  return {
    host,
    live,
    started,
    release: (id: string) => gate(id).release(),
    fail: (id: string, error: Error) => gate(id).fail(error),
    dispatch: (action: "reply" | "notify" | "strict", value: string, sessionId = "s_1", userId = "u_1") =>
      host.dispatch({
        source: "http" as const,
        flowKind: "conversation",
        action,
        input: { value },
        sessionId,
        principal: { userId, orgId: DEFAULT_ORG_ID }
      })
  };
}

const HOLD_DEFER = { reply: "hold", notify: "defer" } as const;

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("a defer request that arrives while a hold request runs", () => {
  it("waits for the hold to end, then runs", async () => {
    const h = buildHost(HOLD_DEFER);
    const reply = h.dispatch("reply", "reply-1");
    await tick();
    const notice = h.dispatch("notify", "notice-1");
    await tick();

    // The notice's handle is live while it waits, and nothing of it has run.
    expect(notice.requestId).toBeTypeOf("string");
    expect(h.live).toEqual(["reply-1"]);

    h.release("reply-1");
    await reply.finished;
    await tick();
    expect(h.live).toEqual(["notice-1"]);

    h.release("notice-1");
    await notice.finished;
    expect(h.started).toEqual(["reply-1", "notice-1"]);
  });

  it("keeps waiting while any hold is running, including one that started after it", async () => {
    // A person may write again while a notice waits. The notice must not start
    // while either reply is still streaming.
    const h = buildHost(HOLD_DEFER);
    const first = h.dispatch("reply", "reply-1");
    await tick();
    const notice = h.dispatch("notify", "notice-1");
    await tick();
    const second = h.dispatch("reply", "reply-2");
    await tick();
    expect(h.live).toEqual(["reply-1", "reply-2"]);

    h.release("reply-1");
    await first.finished;
    await tick();
    expect(h.live).toEqual(["reply-2"]);

    h.release("reply-2");
    await second.finished;
    await tick();
    expect(h.live).toEqual(["notice-1"]);
    h.release("notice-1");
    await notice.finished;
  });

  it("runs several waiting defer requests one at a time", async () => {
    const h = buildHost(HOLD_DEFER);
    const reply = h.dispatch("reply", "reply-1");
    await tick();
    const n1 = h.dispatch("notify", "notice-1");
    const n2 = h.dispatch("notify", "notice-2");
    await tick();

    h.release("reply-1");
    await reply.finished;
    await tick();
    expect(h.live).toHaveLength(1);
    const firstNotice = h.live[0]!;
    h.release(firstNotice);
    await tick();
    expect(h.live).toHaveLength(1);
    expect(h.live[0]).not.toBe(firstNotice);
    h.release(h.live[0]!);
    await Promise.all([n1.finished, n2.finished]);
  });

  it("runs at once when nothing holds the key", async () => {
    const h = buildHost(HOLD_DEFER);
    const notice = h.dispatch("notify", "notice-1");
    await tick();
    expect(h.live).toEqual(["notice-1"]);
    h.release("notice-1");
    await notice.finished;
  });

  it("does not wait on a hold in another session", async () => {
    const h = buildHost(HOLD_DEFER);
    const reply = h.dispatch("reply", "reply-1", "s_1");
    await tick();
    const notice = h.dispatch("notify", "notice-1", "s_2");
    await tick();
    expect(h.live).toEqual(["reply-1", "notice-1"]);
    h.release("reply-1");
    h.release("notice-1");
    await Promise.all([reply.finished, notice.finished]);
  });
});

describe("a person's request under hold behaves as it does under allow", () => {
  /**
   * The same script under both policies: a reply, a second reply mid-reply,
   * and a third reply while a notice waits and while it runs. What a person
   * sees (every reply starts at once, none refused) must not differ.
   */
  async function script(policies: { reply: ConcurrencyConfig; notify: ConcurrencyConfig }) {
    const h = buildHost(policies);
    const seen: string[][] = [];
    const r1 = h.dispatch("reply", "reply-1");
    await tick();
    const r2 = h.dispatch("reply", "reply-2");
    await tick();
    seen.push([...h.live]);
    const notice = h.dispatch("notify", "notice-1");
    await tick();
    const r3 = h.dispatch("reply", "reply-3");
    await tick();
    // Every reply is running, whatever the notice is doing.
    seen.push(h.live.filter((id) => id.startsWith("reply")));

    h.release("reply-1");
    h.release("reply-2");
    h.release("reply-3");
    await Promise.all([r1.finished, r2.finished, r3.finished]);
    await tick();
    const r4 = h.dispatch("reply", "reply-4");
    await tick();
    seen.push(h.live.filter((id) => id.startsWith("reply")));
    h.release("reply-4");
    h.release("notice-1");
    await Promise.all([r4.finished, notice.finished]);
    return seen;
  }

  it("starts every reply at once, mid-reply and around a notice, exactly as allow does", async () => {
    const asToday = await script({ reply: "allow", notify: "allow" });
    const withHold = await script(HOLD_DEFER);
    expect(withHold).toEqual(asToday);
    expect(withHold).toEqual([["reply-1", "reply-2"], ["reply-1", "reply-2", "reply-3"], ["reply-4"]]);
  });
});

describe("a hold that ends badly still lets waiting defer requests run", () => {
  it("runs the waiting notice after the reply is aborted", async () => {
    const h = buildHost(HOLD_DEFER);
    const reply = h.dispatch("reply", "reply-1");
    await tick();
    const notice = h.dispatch("notify", "notice-1");
    await tick();
    expect(h.live).toEqual(["reply-1"]);

    expect(abortRequest(reply.requestId)).toBe(true);
    await reply.finished.catch(() => undefined);
    await tick();
    expect(h.live).toEqual(["notice-1"]);
    h.release("notice-1");
    await notice.finished;
  });

  it("runs the waiting notice after the reply throws", async () => {
    const h = buildHost(HOLD_DEFER);
    const reply = h.dispatch("reply", "reply-1");
    await tick();
    const notice = h.dispatch("notify", "notice-1");
    await tick();

    h.fail("reply-1", new Error("model provider went away"));
    await reply.finished.catch(() => undefined);
    await tick();
    expect(h.live).toEqual(["notice-1"]);
    h.release("notice-1");
    await notice.finished;
  });
});

describe("who chooses hold and defer", () => {
  /** Dispatch with caller-controlled body and metadata naming another policy. */
  const forged = (h: ReturnType<typeof buildHost>, action: "reply" | "notify", value: string, claim: string) =>
    h.host.dispatch({
      source: "http" as const,
      flowKind: "conversation",
      action,
      input: { value, concurrency: claim },
      metadata: { concurrency: claim, policy: claim },
      sessionId: "s_1",
      principal: { userId: "u_1", orgId: DEFAULT_ORG_ID }
    });

  it("ignores a caller that claims defer for an action the flow declares hold", async () => {
    const h = buildHost(HOLD_DEFER);
    const r1 = h.dispatch("reply", "reply-1");
    await tick();
    const r2 = forged(h, "reply", "reply-2", "defer");
    await tick();
    // Declared `hold`, so it starts at once despite the claim.
    expect(h.live).toEqual(["reply-1", "reply-2"]);
    h.release("reply-1");
    h.release("reply-2");
    await Promise.all([r1.finished, r2.finished]);
  });

  it("ignores a caller that claims allow or hold for an action the flow declares defer", async () => {
    const h = buildHost(HOLD_DEFER);
    const r1 = h.dispatch("reply", "reply-1");
    await tick();
    const n1 = forged(h, "notify", "notice-1", "allow");
    const n2 = forged(h, "notify", "notice-2", "hold");
    await tick();
    // Declared `defer`, so both still wait for the reply.
    expect(h.live).toEqual(["reply-1"]);
    h.release("reply-1");
    await r1.finished;
    await tick();
    h.release(h.live[0]!);
    await tick();
    h.release(h.live[0]!);
    await Promise.all([n1.finished, n2.finished]);
  });

  it("ignores a caller that claims hold or defer for an action the flow leaves as allow", async () => {
    const h = buildHost({ reply: "allow", notify: "allow" });
    const r1 = forged(h, "reply", "reply-1", "hold");
    await tick();
    const n1 = forged(h, "notify", "notice-1", "defer");
    await tick();
    expect(h.live).toEqual(["reply-1", "notice-1"]);
    h.release("reply-1");
    h.release("notice-1");
    await Promise.all([r1.finished, n1.finished]);
  });
});

describe("too many notices behind one reply", () => {
  it("refuses the request past the cap at dispatch, with nothing created for it, and the waiting ones still run", async () => {
    const h = buildHost(HOLD_DEFER, createConcurrencyArbiter({ maxDeferredPerKey: 2 }));
    const reply = h.dispatch("reply", "reply-1");
    await tick();
    const n1 = h.dispatch("notify", "notice-1");
    const n2 = h.dispatch("notify", "notice-2");
    await tick();
    // Refused once its ownership is checked, through the handle, not by a
    // throw: a defer takes its place only after the session is authorized.
    const n3 = h.dispatch("notify", "notice-3");
    await expect(n3.finished).rejects.toBeInstanceOf(ConcurrencyDeferLimitError);

    h.release("reply-1");
    await reply.finished;
    await tick();
    h.release(h.live[0]!);
    await tick();
    h.release(h.live[0]!);
    await Promise.all([n1.finished, n2.finished]);
    expect(h.started).not.toContain("notice-3");
  });
});

describe("a caller who does not own the session", () => {
  /** u_1 owns s_1 once its first request has run there. */
  async function ownedSession(h: ReturnType<typeof buildHost>) {
    const first = h.dispatch("reply", "owner-first");
    await tick();
    h.release("owner-first");
    await first.finished;
  }

  it("cannot use up the owner's defer cap", async () => {
    const h = buildHost(HOLD_DEFER, createConcurrencyArbiter({ maxDeferredPerKey: 2 }));
    await ownedSession(h);
    const reply = h.dispatch("reply", "reply-1");
    await tick();

    // Another user fires defers at the owner's session, then the owner's
    // notice arrives in the same tick.
    const foreign = [h.dispatch("notify", "x-1", "s_1", "u_2"), h.dispatch("notify", "x-2", "s_1", "u_2")];
    const notice = h.dispatch("notify", "notice-1");
    for (const f of foreign) await expect(f.finished).rejects.not.toBeInstanceOf(ConcurrencyDeferLimitError);

    h.release("reply-1");
    await reply.finished;
    await tick();
    expect(h.live).toEqual(["notice-1"]);
    h.release("notice-1");
    await notice.finished;
    expect(h.started).not.toContain("x-1");
  });

  it("cannot hold the owner's session, even for a moment", async () => {
    const h = buildHost(HOLD_DEFER);
    await ownedSession(h);

    const foreign = h.dispatch("reply", "x-1", "s_1", "u_2");
    // A `reject` action of the owner's in the same tick must find the key free.
    let strict: ReturnType<typeof h.dispatch> | undefined;
    expect(() => {
      strict = h.dispatch("strict", "strict-1");
    }).not.toThrow();
    await expect(foreign.finished).rejects.toBeDefined();
    await tick();
    h.release("strict-1");
    await strict!.finished;
    expect(h.started).not.toContain("x-1");
  });
});
