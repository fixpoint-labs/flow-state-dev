/**
 * On a BullMQ host, a flow delivers work into an existing session, and the
 * recipient runs under that session's concurrency policy, even when its runs
 * land in different worker processes, while another user still cannot
 * deliver into it.
 *
 * The deployment is a web runtime that only enqueues, served over HTTP, and
 * two worker runtimes, each with its own arbiter, on a real Redis and one
 * SQLite file. Everything is asked over HTTP with ids learned from responses:
 * each run's window comes back as the handler's output, read from the
 * session's request list.
 *
 * Four signals. **delivers**: alice's two deliveries both complete.
 * **one-at-a-time**: those two and two HTTP actions into the same session
 * never overlap, and start in the order they were accepted. (Two, so the
 * commit before the fix, which refuses the deliveries, still has runs that
 * can overlap.) **other-user**:
 * bob's delivery naming alice's session is refused `session-not-found`, and
 * alice's requests are unchanged. **refusal-kept**: an adapter that cannot
 * arbitrate across processes still refuses `external-dispatcher`.
 *
 * Controls, which must fail: the commit before the fix fails **delivers**
 * and **one-at-a-time**; setting `LEASES` below to `"local"`, where each
 * runtime keeps its own lines in memory, fails **one-at-a-time**. (A constant,
 * not an environment switch: nothing under `packages/` reads a control.)
 *
 * Needs `REDIS_URL`. Without it the case skips locally and fails in CI.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  REDIS_URL,
  startQueueDeployment,
  waitFor,
  type QueueDeployment,
  type QueueDeploymentOptions
} from "./harness";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

/** How long each run holds its session, so runs that could overlap do. */
const HOLD_MS = 1_500;

const workInput = z.object({ tag: z.string() });
const deliverInput = z.object({ to: z.string(), tag: z.string() });

/** A session flow under `policy`, whose `deliver` hands `work` into a session by id. */
function inboxFlow(kind: string, policy: "queue" | "reject") {
  const work = handler({
    name: "work",
    inputSchema: workInput,
    outputSchema: z.object({ tag: z.string(), start: z.number(), end: z.number() }),
    execute: async (input) => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, HOLD_MS));
      return { tag: input.tag, start, end: Date.now() };
    }
  });
  return defineFlow({
    kind,
    actions: {
      work: { block: work, inputSchema: workInput },
      deliver: {
        block: dispatcher({
          name: "deliver-work",
          type: "internal",
          action: "work",
          inputSchema: deliverInput,
          session: { id: (input) => input.to },
          payload: (input) => ({ tag: input.tag })
        }),
        inputSchema: deliverInput
      }
    },
    internal: { actions: { work: { block: work } } },
    request: { concurrency: { policy, key: "session" } }
  })();
}

type Caller = ReturnType<QueueDeployment["as"]>;
type Listed = {
  id: string;
  status: string;
  result?: { output?: { tag: string; start: number; end: number }; error?: { message?: string; code?: string } };
};

async function post(caller: Caller, kind: string, sessionId: string, action: string, input: unknown) {
  const response = await caller(`/${kind}/${sessionId}/actions/${action}`, {
    method: "POST",
    body: JSON.stringify({ input })
  });
  const body = (await response.json()) as { request?: { id?: string } };
  return { status: response.status, requestId: body.request?.id };
}

async function requestsOf(caller: Caller, kind: string, sessionId: string): Promise<Listed[]> {
  const response = await caller(`/sessions/${sessionId}/requests?include_result_output=true`);
  if (response.status === 404) return [];
  return ((await response.json()) as { requests: Listed[] }).requests;
}

const settled = (r: Listed) => r.status !== "in_progress";

/** The request `sender` made in `outbox`, once it has settled. */
async function settledIn(caller: Caller, kind: string, sessionId: string, requestId: string) {
  return waitFor(
    async () => (await requestsOf(caller, kind, sessionId)).find((r) => r.id === requestId && settled(r)),
    `request ${requestId} to settle`,
    30_000
  );
}

const describeWithRedis =
  REDIS_URL !== undefined && REDIS_URL !== ""
    ? describe
    : process.env.CI
      ? (name: string, _body: () => void) =>
          describe(name, () => {
            it("needs a Redis", () => {
              throw new Error("REDIS_URL is not set. In CI this case fails rather than skips.");
            });
          })
      : describe.skip;

/** `"local"` runs the control that must fail **one-at-a-time**. */
const LEASES: QueueDeploymentOptions["leases"] = "shared";

describeWithRedis("a delivery into an existing session, on a BullMQ host", () => {
  let deployment: QueueDeployment | undefined;
  afterEach(async () => {
    await deployment?.close();
    deployment = undefined;
  });

  it("delivers, one at a time with the session's own runs, and not for another user", async () => {
    deployment = await startQueueDeployment([inboxFlow("inbox", "queue")], { leases: LEASES });
    const alice = deployment.as("alice");
    const bob = deployment.as("bob");

    // Every signal is judged, and the ones that fail are named together, so a
    // control run says which of them it broke.
    const broken: Record<string, string> = {};

    // Alice's session exists: she has used it once.
    const seed = await post(alice, "inbox", "s_alice", "work", { tag: "seed" });
    expect(seed.status).toBe(202);
    await settledIn(alice, "inbox", "s_alice", seed.requestId!);

    // Two deliveries and two HTTP actions into it, each accepted before the
    // next is sent, so the order they were accepted in is known. Each runs
    // long enough that all three are in flight at once.
    const accepted: string[] = [];
    const acceptedInto = async (id: string) =>
      waitFor(
        async () => ((await requestsOf(alice, "inbox", "s_alice")).some((r) => r.id === id) ? true : undefined),
        `request ${id} to be accepted`
      );
    const sendDelivery = async (tag: string) => {
      const sent = await post(alice, "inbox", "s_alice_outbox", "deliver", { to: "s_alice", tag });
      expect(sent.status).toBe(202);
      const sender = await settledIn(alice, "inbox", "s_alice_outbox", sent.requestId!);
      if (sender.status !== "completed") {
        broken.delivers = `${tag} was not accepted: ${JSON.stringify(sender.result?.error)}`;
        return;
      }
      const deliveredId = (sender.result?.output as unknown as { requestId: string }).requestId;
      await acceptedInto(deliveredId);
      accepted.push(tag);
    };
    const sendAction = async (tag: string) => {
      const direct = await post(alice, "inbox", "s_alice", "work", { tag });
      expect(direct.status).toBe(202);
      await acceptedInto(direct.requestId!);
      accepted.push(tag);
    };
    await sendDelivery("delivery-1");
    await sendAction("http-1");
    await sendDelivery("delivery-2");
    await sendAction("http-2");

    const expected = 1 + accepted.length;
    const runs = await waitFor(async () => {
      const listed = await requestsOf(alice, "inbox", "s_alice");
      return listed.length === expected && listed.every(settled) ? listed : undefined;
    }, "alice's runs to settle", 45_000);

    // **delivers**: both deliveries ran to completion.
    const unfinished = runs.filter((r) => r.status !== "completed");
    if (unfinished.length > 0) {
      broken.delivers ??= `${unfinished.length} run(s) did not complete: ${JSON.stringify(
        unfinished.map((r) => r.result?.error?.message)
      )}`;
    }

    // **one-at-a-time**: no two windows overlap, and they start in acceptance order.
    const windows = runs.flatMap((r) => (r.result?.output && r.result.output.tag !== "seed" ? [r.result.output] : []));
    const overlaps = windows.flatMap((a, i) =>
      windows.slice(i + 1).filter((b) => a.start < b.end && b.start < a.end).map((b) => `${a.tag}/${b.tag}`)
    );
    const order = [...windows].sort((a, b) => a.start - b.start).map((w) => w.tag);
    if (overlaps.length > 0) broken["one-at-a-time"] = `overlapping: ${overlaps.join(", ")}`;
    else if (order.join() !== accepted.join()) {
      broken["one-at-a-time"] = `started ${order.join(", ")}; accepted ${accepted.join(", ")}`;
    }

    // **other-user**: bob names alice's session and is refused.
    const before = (await requestsOf(alice, "inbox", "s_alice")).map((r) => r.id);
    const bobs = await post(bob, "inbox", "s_bob_outbox", "deliver", { to: "s_alice", tag: "from-bob" });
    const bobSender = await settledIn(bob, "inbox", "s_bob_outbox", bobs.requestId!);
    const after = (await requestsOf(alice, "inbox", "s_alice")).map((r) => r.id);
    if (
      bobSender.status !== "failed" ||
      !JSON.stringify(bobSender.result?.error).includes("session-not-found") ||
      after.join() !== before.join()
    ) {
      broken["other-user"] = `bob's delivery ended ${bobSender.status}: ${JSON.stringify(bobSender.result?.error)}`;
    }

    expect(broken).toEqual({});
  });

  it("refuses a `reject` recipient's second delivery while the first holds the session", async () => {
    deployment = await startQueueDeployment([inboxFlow("hook", "reject")], { leases: LEASES });
    const alice = deployment.as("alice");
    const seed = await post(alice, "hook", "s_hook", "work", { tag: "seed" });
    await settledIn(alice, "hook", "s_hook", seed.requestId!);

    const holding = await post(alice, "hook", "s_hook", "work", { tag: "holding" });
    expect(holding.status).toBe(202);
    const sent = await post(alice, "hook", "s_hook_outbox", "deliver", { to: "s_hook", tag: "second" });
    const sender = await settledIn(alice, "hook", "s_hook_outbox", sent.requestId!);
    expect(sender.status).toBe("failed");
    expect(JSON.stringify(sender.result?.error)).toContain("dispatch-rejected");
  });

  it("still refuses `external-dispatcher` when the adapter cannot arbitrate across processes", async () => {
    deployment = await startQueueDeployment([inboxFlow("inbox", "queue")], { leases: "none" });
    const alice = deployment.as("alice");
    const seed = await post(alice, "inbox", "s_alice", "work", { tag: "seed" });
    await settledIn(alice, "inbox", "s_alice", seed.requestId!);

    const sent = await post(alice, "inbox", "s_alice_outbox", "deliver", { to: "s_alice", tag: "refused" });
    const sender = await settledIn(alice, "inbox", "s_alice_outbox", sent.requestId!);
    // **refusal-kept**
    expect(sender.status).toBe("failed");
    expect(JSON.stringify(sender.result?.error), "refusal-kept").toContain("external-dispatcher");
    expect((await requestsOf(alice, "inbox", "s_alice")).length).toBe(1);
  });
});
