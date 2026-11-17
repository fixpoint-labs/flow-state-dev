// FIX-2771 D1.
/**
 * The worker messages view: a worker's open messages, and the row and the
 * answer of each message on screen, read through the message log's two
 * declared indexes, never the whole log. Real engine; the caller is a
 * verified user. Rows are written through a flow that declares the log, so
 * every write passes the engine's index writer, as a send's does.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceRef } from "@flow-state-dev/core/types";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { z } from "zod";
import { messageLogOf, workerMessagesResources, type WorkerMessageResourceState } from "../src/messages/message-log";
import { readWorkerMessages, type WorkerMessageLog } from "../src/messages/worker-messages-view";
import { workerMessagesViewRef } from "../src/messages/worker-messages-view-ref";
import { bootBoardHost, ORG, type BoardHost } from "./conversation-board-harness";

const LEAD = "lead";
const RESEARCHER = "researcher";

/** A log row with what every row carries; `fields` says the rest. */
function logged(id: string, fields: Partial<WorkerMessageResourceState>): WorkerMessageResourceState {
  return {
    id,
    from: LEAD,
    to: RESEARCHER,
    text: `text of ${id}`,
    exchange: id,
    fromSession: "s-from",
    fromFlow: "agent",
    toSession: "s-to",
    toFlow: "agent",
    hop: 1,
    status: "delivered",
    at: Number(id.replace(/\D/g, "")),
    ...fields
  };
}

/** A flow that writes log rows as given, through the engine: what a send writes, with no model. */
const logWriter = defineFlow({
  kind: "log-writer",
  resources: workerMessagesResources,
  actions: {
    write: {
      inputSchema: z.object({ rows: z.array(z.record(z.unknown())) }),
      block: handler({
        name: "write-log-rows",
        inputSchema: z.object({ rows: z.array(z.record(z.unknown())) }),
        resources: workerMessagesResources,
        execute: async (input, ctx) => {
          const log = messageLogOf(ctx);
          for (const next of input.rows as WorkerMessageResourceState[]) {
            const held = await log.getOptional(next.id);
            if (held === undefined) await log.getOrCreate(next.id, next);
            else await held.setState(next);
          }
          return { written: input.rows.length };
        }
      })
    }
  }
})({ id: "log-writer" });

function boot(): BoardHost {
  return bootBoardHost({ plainFlows: { "log-writer": logWriter } });
}

/** Write `rows` as `userId`, in `orgId`. */
async function write(h: BoardHost, messages: WorkerMessageResourceState[], userId = "alice", orgId = ORG): Promise<void> {
  const done = await h.act(userId, `writer-${userId}`, "write", { rows: messages }, "log-writer", orgId);
  expect(done.error).toBeUndefined();
}

/** The view's rows' ids for `worker`, with `ids` on screen, as `userId` in `orgId`. */
async function read(h: BoardHost, worker: string, ids?: string[], userId = "alice", orgId = ORG) {
  const inProcess = createInProcessFetch(h.state);
  const client = createClient({
    userId,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-user", userId);
      headers.set("x-org", orgId);
      return inProcess(input, { ...init, headers });
    }
  });
  return client.view(workerMessagesViewRef(), { worker, ...(ids === undefined ? {} : { ids }) });
}

const idsOf = (listed: readonly { id: string }[]) => listed.map((m) => m.id);

describe("a worker's open messages", () => {
  it("answers each message to or from the worker still on its way, or still owed an answer, oldest first, and no closed one", async () => {
    const h = boot();
    try {
      await write(h, [
        // On its way to researcher: pending for researcher.
        logged("m1", { status: "unconfirmed" }),
        // Lead asked researcher for a reply, delivered, none yet: Lead is "Messaging researcher".
        logged("m2", { status: "delivered", replyRequested: true }),
        // Answered, refused, undeliverable, or delivered with no reply asked: closed.
        logged("m3", { status: "delivered", replyRequested: true, answeredBy: "m9" }),
        logged("m4", { status: "refused", replyRequested: true }),
        logged("m5", { status: "undeliverable" }),
        logged("m6", { status: "delivered" }),
        // Between two other workers: not lead's.
        logged("m7", { from: "writer", to: "editor", status: "unconfirmed" })
      ]);
      expect(idsOf((await read(h, LEAD)).value)).toEqual(["m1", "m2"]);
      expect(idsOf((await read(h, RESEARCHER)).value)).toEqual(["m1", "m2"]);
      expect(idsOf((await read(h, "writer")).value)).toEqual(["m7"]);
      // Rows are the log's own schema.
      expect((await read(h, LEAD)).value[1]).toMatchObject({ id: "m2", from: LEAD, to: RESEARCHER, status: "delivered", replyRequested: true });
    } finally {
      await h.dispose();
    }
  });

  it("drops a message once it lands, and once its answer comes", async () => {
    const h = boot();
    try {
      await write(h, [logged("m1", { status: "unconfirmed" }), logged("m2", { status: "delivered", replyRequested: true })]);
      expect(idsOf((await read(h, LEAD)).value)).toEqual(["m1", "m2"]);
      await write(h, [logged("m1", { status: "delivered" }), logged("m2", { status: "delivered", replyRequested: true, answeredBy: "m3" })]);
      expect((await read(h, LEAD)).value).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the messages on screen", () => {
  it("answers each id's row and its answer, so an old line reads replied or no answer", async () => {
    const h = boot();
    try {
      await write(h, [
        logged("m1", { status: "delivered", replyRequested: true, answeredBy: "m2" }),
        logged("m2", { from: RESEARCHER, to: LEAD, inReplyTo: "m1", exchange: "m1", status: "delivered" }),
        logged("m3", { status: "delivered", replyRequested: true, answeredBy: "m4" }),
        logged("m4", { from: RESEARCHER, to: LEAD, inReplyTo: "m3", exchange: "m3", status: "delivered", noAnswer: true }),
        logged("m5", { status: "delivered" })
      ]);
      // None is open: the ids alone bring them.
      expect((await read(h, LEAD)).value).toEqual([]);
      const { value } = await read(h, LEAD, ["m1", "m3", "m5"]);
      expect(idsOf(value)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      expect(value.find((r) => r.inReplyTo === "m3")?.noAnswer).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("takes at most 50 ids", async () => {
    const h = boot();
    try {
      await expect(read(h, LEAD, Array.from({ length: 51 }, (_, i) => `m${i}`))).rejects.toThrow();
      expect((await read(h, LEAD, Array.from({ length: 50 }, (_, i) => `m${i}`))).value).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("is heard on a write to the log, so a new open row and a new answer each reach a watching view", async () => {
    const h = boot();
    try {
      await write(h, [logged("m1", { status: "delivered", replyRequested: true })]);
      const before = await read(h, LEAD, ["m1"]);
      // A write of a new row anywhere in the log is a resource notice under the log's root, on the user's topic: heard.
      const heard = before.hears?.find((hearing) => hearing.topic.scope === "user" && hearing.kinds.includes("resource"));
      expect(heard?.paths).toEqual(["workforce/messages"]);
      // And the read that follows it has the row.
      await write(h, [logged("m2", { from: RESEARCHER, to: LEAD, inReplyTo: "m1", exchange: "m1", status: "delivered" }), logged("m3", { status: "unconfirmed" })]);
      expect(idsOf((await read(h, LEAD, ["m1"])).value)).toEqual(["m1", "m2", "m3"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("another user's messages", () => {
  it("another user, and the same user in another organization, passing the first user's worker and a live id get what an unknown id gets", async () => {
    const h = boot();
    try {
      await write(h, [logged("m1", { status: "unconfirmed" }), logged("m2", { from: RESEARCHER, to: LEAD, inReplyTo: "m1", status: "delivered" })]);
      expect(idsOf((await read(h, LEAD, ["m1"])).value)).toEqual(["m1", "m2"]);
      const unknown = (await read(h, LEAD, ["nope"], "bob")).value;
      expect(unknown).toEqual([]);
      expect((await read(h, LEAD, ["m1"], "bob")).value).toEqual(unknown);
      expect((await read(h, LEAD, ["m1"], "alice", "other-org")).value).toEqual(unknown);
    } finally {
      await h.dispose();
    }
  });
});

describe("what it reads", () => {
  it("reads through the indexes and by id, never the whole log", async () => {
    const stored = [
      logged("m1", { status: "unconfirmed" }),
      logged("m2", { from: RESEARCHER, to: LEAD, inReplyTo: "m5", status: "delivered" }),
      logged("m5", { status: "delivered" })
    ];
    const refOf = (state: WorkerMessageResourceState) => ({ state }) as unknown as ResourceRef<WorkerMessageResourceState>;
    const lookups: string[] = [];
    const log: WorkerMessageLog & { list(): Promise<never> } = {
      findBy: async (index, value) => {
        lookups.push(`${index}=${String(value)}`);
        if (index === "open") return stored.filter((r) => r.status === "unconfirmed" && (r.from === value || r.to === value)).map(refOf);
        return stored.filter((r) => r.inReplyTo === value).map(refOf);
      },
      getOptional: async (key) => {
        lookups.push(`get=${String(key)}`);
        const found = stored.find((r) => r.id === key);
        return found === undefined ? undefined : refOf(found);
      },
      list: async () => {
        throw new Error("the whole log was read");
      }
    };
    expect(idsOf(await readWorkerMessages(log, { worker: LEAD, ids: ["m5"] }))).toEqual(["m1", "m2", "m5"]);
    expect(lookups.sort()).toEqual(["get=m5", "inReplyTo=m5", "open=lead"]);
  });
});
