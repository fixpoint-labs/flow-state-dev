/**
 * Proof: N subscribers wake on a board post. Without claim/address policy
 * they all reply. With L2 policy, only one (or the addressed subscriber) replies.
 *
 * L1 API under test: `TaskCollectionRef.claim(workerId, { eligibility })`
 * via `ctx.cap.replyBoard.tasks()` — the same CAS claim task-board drain uses.
 */
import { describe, expect, it } from "vitest";
import {
  createFlowState,
  createInMemoryStores,
  inMemoryStores,
  runAction,
} from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import {
  WORKFORCE_POC_B_KIND,
  workforcePocBFlow,
  type ReceiveOutput,
} from "../src/flow";

const USER = "board-tenant";
const SUBSCRIBERS = ["alice", "bob", "cara"] as const;

function run(options: {
  stores: ReturnType<typeof createInMemoryStores>;
  action: string;
  input: unknown;
  sessionId?: string;
}) {
  return testFlow({
    flow: workforcePocBFlow,
    action: options.action,
    userId: USER,
    input: options.input,
    stores: options.stores,
    sessionId: options.sessionId ?? "parent-board",
    unmockedGeneratorPolicy: "error",
  });
}

async function seed(
  stores: ReturnType<typeof createInMemoryStores>,
  input: {
    postId: string;
    body: string;
    addressedTo?: string;
    needsReply?: boolean;
  }
) {
  const result = await run({ stores, action: "seed", input });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe("completed");
  return result;
}

async function wakeAll(
  stores: ReturnType<typeof createInMemoryStores>,
  postId: string,
  policy: "on" | "off"
): Promise<ReceiveOutput[]> {
  const results = await Promise.all(
    SUBSCRIBERS.map((subscriberId) =>
      run({
        stores,
        action: "receive",
        sessionId: `sub-${subscriberId}`,
        input: { postId, subscriberId, policy },
      })
    )
  );
  for (const result of results) {
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
  }
  return results.map((result) => result.output as ReceiveOutput);
}

describe("reply-storm L2 on task-board claim", () => {
  it("without policy, every woken subscriber replies", async () => {
    const stores = createInMemoryStores();
    await seed(stores, { postId: "p-nopolicy", body: "status?" });

    const outputs = await wakeAll(stores, "p-nopolicy", "off");
    const replies = outputs.filter((o) => o.replied);

    expect(outputs).toHaveLength(SUBSCRIBERS.length);
    expect(replies).toHaveLength(SUBSCRIBERS.length);
    expect(replies.map((r) => r.reason)).toEqual([
      "no-policy",
      "no-policy",
      "no-policy",
    ]);
  });

  it("default quiet: unaddressed post, policy on, nobody replies", async () => {
    const stores = createInMemoryStores();
    await seed(stores, { postId: "p-quiet", body: "fyi — shipping Friday" });

    const outputs = await wakeAll(stores, "p-quiet", "on");
    const replies = outputs.filter((o) => o.replied);

    expect(replies).toHaveLength(0);
    expect(outputs.every((o) => o.reason === "unaddressed")).toBe(true);
  });

  it("addressed post: only the named subscriber replies", async () => {
    const stores = createInMemoryStores();
    await seed(stores, {
      postId: "p-addr",
      body: "hey @bob can you take the API review",
    });

    const outputs = await wakeAll(stores, "p-addr", "on");
    const replies = outputs.filter((o) => o.replied);

    expect(replies).toHaveLength(1);
    expect(replies[0]?.subscriberId).toBe("bob");
    expect(replies[0]?.reason).toBe("addressed-to-me");
    expect(
      outputs.filter((o) => !o.replied).every((o) => o.reason === "not-addressed-to-me")
    ).toBe(true);

    const inspect = await run({
      stores,
      action: "inspect",
      input: { postId: "p-addr" },
    });
    expect(inspect.status).toBe("completed");
    const row = inspect.output as { status: string; output?: { subscriberId?: string } };
    expect(row.status).toBe("completed");
    expect(row.output?.subscriberId).toBe("bob");
  });

  it("open-claim: N wake, existing claim CAS admits exactly one reply", async () => {
    const stores = createInMemoryStores();
    await seed(stores, {
      postId: "p-claim",
      body: "who can take the deploy?",
      needsReply: true,
    });

    const outputs = await wakeAll(stores, "p-claim", "on");
    const replies = outputs.filter((o) => o.replied);
    const lost = outputs.filter((o) => o.reason === "lost-claim");

    expect(replies).toHaveLength(1);
    expect(lost).toHaveLength(SUBSCRIBERS.length - 1);
    expect(replies[0]?.reason).toBe("open-claim");
    expect(SUBSCRIBERS).toContain(replies[0]?.subscriberId);

    const inspect = await run({
      stores,
      action: "inspect",
      input: { postId: "p-claim" },
    });
    const row = inspect.output as { status: string; output?: { subscriberId?: string } };
    expect(row.status).toBe("completed");
    expect(row.output?.subscriberId).toBe(replies[0]?.subscriberId);
  });

  it("post fans out one dispatcher wake per subscriber", async () => {
    const { posted, inspect } = await runHostedPost({
      postId: "p-fanout",
      body: "broadcast — stay quiet unless addressed",
      subscribers: [...SUBSCRIBERS],
      policy: "on",
    });

    const handles = posted.output as Array<{ sessionId: string; requestId: string }>;
    expect(handles).toHaveLength(SUBSCRIBERS.length);
    expect(new Set(handles.map((h) => h.sessionId)).size).toBe(SUBSCRIBERS.length);

    // Default quiet: every child stayed silent; the reply token is still pending.
    expect(inspect.status).toBe("pending");
  });

  it("post + open-claim: fan-out wakes N, claim still admits one", async () => {
    const { posted, inspect } = await runHostedPost({
      postId: "p-fanout-claim",
      body: "need one owner for the rollback",
      needsReply: true,
      subscribers: [...SUBSCRIBERS],
      policy: "on",
    });

    expect(posted.output).toHaveLength(SUBSCRIBERS.length);
    expect(inspect.status).toBe("completed");
    expect(SUBSCRIBERS).toContain(
      (inspect.output as { subscriberId?: string } | undefined)?.subscriberId
    );
  });
});

/**
 * `testFlow` / a bare `runAction` does not attach the dispatch seam.
 * Fan-out is `dispatcher()` × N — that needs the shipped host (`createFlowState`).
 */
async function runHostedPost(input: {
  postId: string;
  body: string;
  subscribers: string[];
  policy: "on" | "off";
  needsReply?: boolean;
}) {
  const state = createFlowState({
    flows: { [WORKFORCE_POC_B_KIND]: workforcePocBFlow },
    stores: { default: { primary: inMemoryStores() } },
  });
  try {
    const runtime = await state.getRuntime();
    const posted = await runAction({
      flow: workforcePocBFlow,
      actionName: "post",
      input,
      userId: USER,
      sessionId: "parent-board",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });
    expect(posted.error).toBeUndefined();

    const inspect = await waitForInspect(
      runtime,
      input.postId,
      input.needsReply === true ? "completed" : "pending"
    );
    return { posted, inspect };
  } finally {
    await state.dispose();
  }
}

async function waitForInspect(
  runtime: { stores: ReturnType<typeof createInMemoryStores>; runtimeConfig: object },
  postId: string,
  status: "pending" | "completed"
) {
  let last: { status: string; output?: { subscriberId?: string } } | undefined;
  // Quiet fan-out: give the N child receives time to run before asserting
  // the token is still pending. Open-claim: poll until one complete lands.
  const started = Date.now();
  const minWaitMs = status === "pending" ? 150 : 0;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await runAction({
      flow: workforcePocBFlow,
      actionName: "inspect",
      input: { postId },
      userId: USER,
      sessionId: "parent-board",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });
    last = result.output as typeof last;
    const waited = Date.now() - started;
    if (
      result.error === undefined &&
      last?.status === status &&
      waited >= minWaitMs
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`inspect stayed ${last?.status ?? "missing"}, wanted ${status}`);
}
