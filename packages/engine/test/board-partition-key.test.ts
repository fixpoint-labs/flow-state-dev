// FIX-2750.
/**
 * A board-insert notice names its ledger partition to a browser only as an
 * opaque key, and a view's answer names the partitions it read by the same
 * key, so the client's rule (`hearsNotice`) skips a row filed in another
 * conversation without either side naming a session.
 *
 * Inside the server the partition is raw (the bus, the run's answer); the two
 * places it leaves for a browser, the push socket and the view route, key it
 * with the router's push secret. A host with no push names no partition.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, defineView, handler, topic, type ViewHearing } from "@flow-state-dev/core";
import { publishBoardInsert, recordBoardRead, type PushMintAnswer, type PushServerFrame } from "@flow-state-dev/core/internal";
import type { WireNotice } from "@flow-state-dev/contracts";
import { hearsNotice } from "@flow-state-dev/contracts/types/view-hearing";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../src";
import { createInMemoryBus, createInMemoryStores, enablePushDelivery, type FlowApiRouter } from "../src/host";
import { boardPartitionKey } from "../src/push/partition-key";

const SECRET = "test-secret";
const ALICE = { "x-user": "alice", "x-org": "acme" };

const desk = defineResourceCollection({ scope: "user", pattern: "desk/**", stateSchema: z.object({}).passthrough() });

/** A user board kept per conversation: `file` adds a row to the partition it names, `board` reads its own. */
const flow = defineFlow({
  kind: "desk",
  resources: { desk },
  actions: {
    file: {
      block: handler({
        name: "file",
        inputSchema: z.object({ id: z.string(), partition: z.string() }),
        outputSchema: z.object({}),
        resources: { desk },
        execute: (input, ctx) => {
          publishBoardInsert(ctx, { board: "desk", taskId: input.id, ledger: ctx.resources.desk, partition: input.partition });
          return {};
        }
      })
    }
  },
  views: {
    board: defineView({
      scope: "session",
      block: handler({
        name: "read-board",
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        resources: { desk },
        execute: (_input, ctx) => {
          const own = ctx.session.identity.id;
          recordBoardRead(ctx, { board: "desk", sessionIds: [own], ledger: ctx.resources.desk, partition: own });
          return {};
        }
      })
    })
  }
});

function app(options: { push: boolean; secret?: () => string }) {
  const registry = createFlowRegistry();
  registry.register(flow());
  const bus = createInMemoryBus();
  const stores: StoreRegistry = { ...createInMemoryStores(), bus };
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context) => {
      const user = context.request?.headers.get("x-user");
      return user == null ? null : { userId: user, orgId: context.request?.headers.get("x-org") ?? "acme" };
    }
  });
  const delivery = options.push ? enablePushDelivery(router, { secret: options.secret ?? SECRET }) : undefined;
  return { router, delivery };
}

async function post(router: FlowApiRouter, path: string[], body: unknown): Promise<Response> {
  return router.POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ALICE },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
}

/** File a row in `partition` from session `from`. */
async function file(router: FlowApiRouter, from: string, id: string, partition: string): Promise<void> {
  const response = await post(router, ["desk", "actions", "file"], { userId: "alice", sessionId: from, input: { id, partition } });
  expect(response.status).toBeLessThan(300);
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** The board view's answer for conversation `sessionId`, as the browser gets it. */
async function view(router: FlowApiRouter, sessionId: string): Promise<{ hears: ViewHearing[] }> {
  const response = await post(router, ["desk", sessionId, "views", "board"], { userId: "alice", input: {} });
  expect(response.status).toBe(200);
  return (await response.json()) as { hears: ViewHearing[] };
}

/** A socket on the user topic: the board-insert notices it was sent. */
async function userSocket(router: FlowApiRouter, delivery: NonNullable<ReturnType<typeof app>["delivery"]>) {
  const minted = await post(router, ["users", "alice", "stream"], { topics: [topic.user()] });
  const answer = (await minted.json()) as PushMintAnswer;
  if (answer.transport !== "websocket") throw new Error("expected a websocket answer");
  const frames: PushServerFrame[] = [];
  const session = delivery.openSocket("alice", { send: (frame) => frames.push(frame), close: () => undefined });
  session.receive(JSON.stringify({ type: "subscribe", ticket: answer.ticket }));
  const notices = () => frames.filter((frame): frame is { type: "notice" } & WireNotice => frame.type === "notice");
  return Object.assign(() => notices().filter((notice) => notice.kind === "board"), { notices });
}

describe("a board-insert notice's partition, at the push edge", () => {
  it("reaches a browser as a key that matches the view of that partition only, and never as the raw partition", async () => {
    const { router, delivery } = app({ push: true });
    await file(router, "conv-a", "seed", "conv-a");
    const answer = await view(router, "conv-a");
    const sent = await userSocket(router, delivery!);

    await file(router, "conv-b", "b1", "conv-b");
    await file(router, "task-of-a", "a1", "conv-a");

    const [fromB, intoA] = sent();
    expect(fromB?.partition).toBeDefined();
    expect(intoA?.partition).toBeDefined();
    expect(fromB?.partition).not.toBe(intoA?.partition);
    // The view of conversation A skips B's filing and hears the row filed into A.
    expect(hearsNotice(answer.hears, fromB!)).toBe(false);
    expect(hearsNotice(answer.hears, intoA!)).toBe(true);
    // No notice names a partition's session, and the answer names none as a
    // partition (its own session's topic is the caller's to name).
    const notices = JSON.stringify(sent());
    const partitions = JSON.stringify(answer.hears.map((hearing) => hearing.partitions));
    for (const raw of ["conv-a", "conv-b", "task-of-a"]) {
      expect(notices).not.toContain(raw);
      expect(partitions).not.toContain(raw);
    }
    expect(JSON.stringify(answer.hears)).not.toContain("conv-b");
    // The secret never changed: nothing told the browser to read again.
    expect(sent.notices().filter((notice) => notice.kind === "resync")).toEqual([]);
  });

  // Greptile on #5306: the push secret is read on each use, so it can change
  // while a board is open. Its answer holds keys made under the old secret;
  // the socket tells the browser to read again before it sends a key made
  // under the new one, so the board's next answer holds the new keys.
  it("tells an open socket to read everything again when the push secret changes, before a key under the new one", async () => {
    let secret = "one";
    const { router, delivery } = app({ push: true, secret: () => secret });
    await file(router, "conv-a", "seed", "conv-a");
    await view(router, "conv-a");
    const sent = await userSocket(router, delivery!);
    await file(router, "conv-b", "b1", "conv-b");

    secret = "two";
    await file(router, "task-of-a", "a1", "conv-a");
    // The board and resync notices after B's filing (the user topic also carries each session write's `run`).
    const after = sent.notices().filter((notice) => notice.kind === "board" || notice.kind === "resync").slice(1);
    expect(after.map((notice) => notice.kind)).toEqual(["resync", "board"]);
    expect(after[0]!.topic).toEqual(topic.user());
    // The board's next answer, read on that resync, hears the notice keyed under the new secret.
    expect(hearsNotice((await view(router, "conv-a")).hears, after[1]!)).toBe(true);
  });

  it("on a host with no push, the view's answer names no partition and hears every board notice", async () => {
    const { router } = app({ push: false });
    await file(router, "conv-a", "seed", "conv-a");
    const answer = await view(router, "conv-a");
    const board = answer.hears.find((hearing) => hearing.kinds.includes("board"));
    expect(board).toBeDefined();
    expect(answer.hears.every((hearing) => hearing.partitions === undefined)).toBe(true);
  });
});

describe("boardPartitionKey", () => {
  it("is keyed: a plain hash of the partition doesn't match it, and another secret makes another key", () => {
    const key = boardPartitionKey(SECRET, "", "conv-a");
    expect(key).not.toContain("conv-a");
    expect(key).not.toBe(createHash("sha256").update("conv-a").digest("base64url"));
    expect(boardPartitionKey("another-secret", "", "conv-a")).not.toBe(key);
    expect(boardPartitionKey(SECRET, "", "conv-a")).toBe(key);
  });

  it("differs per tenant, so one tenant's keys can't be matched against another's", () => {
    expect(boardPartitionKey(SECRET, "t1", "conv-a")).not.toBe(boardPartitionKey(SECRET, "t2", "conv-a"));
  });
});
