/**
 * A seat's answer into a project's room survives a crash and a failed
 * watermark step, and a woken seat is shown only the room's committed lines.
 *
 * Driven through a flow's handlers over the real resource collections, as the
 * room store's own tests are:
 *   · a run that died after its claim is finished by the next delivery, with
 *     exactly one line, in the claimed words;
 *   · a run whose watermark step failed after the line landed is finished by a
 *     retry that writes no second line;
 *   · wake context stops at the watermark: a line written past a stalled gap
 *     is not shown.
 */

import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineRoomAnswersCollection,
  defineRoomLinesCollection,
  defineRoomSeqCollection,
  ROOM_ANSWERS_RESOURCE,
  ROOM_LINES_RESOURCE,
  ROOM_SEQ_RESOURCE,
  type RoomAnswer,
  type RoomLine,
  type RoomSeq
} from "../src/projects/collections";
import { answerInRoom, claimAnswer, type AnswerDraft } from "../src/projects/room-answer";
import { allocateSeq, readRoom, writeLineAt, type RoomCollections } from "../src/projects/room-store";
import { recentRoomLines } from "../src/projects/talk";

const ORG = "lab";

type Refs = { rooms: RoomCollections; claims: ResourceCollectionRef<RoomAnswer> };

const refsOf = (ctx: unknown): Refs => {
  const resources = (ctx as { resources: Record<string, unknown> }).resources;
  return {
    rooms: {
      lines: resources[ROOM_LINES_RESOURCE] as ResourceCollectionRef<RoomLine>,
      seq: resources[ROOM_SEQ_RESOURCE] as ResourceCollectionRef<RoomSeq>
    },
    claims: resources[ROOM_ANSWERS_RESOURCE] as ResourceCollectionRef<RoomAnswer>
  };
};

/**
 * The room's collections with the watermark step failing once: the second
 * counter write of the run (allocate is the first, advance the second).
 */
function failingAdvance(rooms: RoomCollections): RoomCollections {
  let writes = 0;
  const bind = (target: object, key: PropertyKey) => {
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  };
  const seq = new Proxy(rooms.seq, {
    get(target, key) {
      if (key !== "getOrCreate") return bind(target, key);
      return async (...args: Parameters<typeof target.getOrCreate>) => {
        const ref = await target.getOrCreate(...args);
        return new Proxy(ref, {
          get(refTarget, refKey) {
            if (refKey !== "updateState") return bind(refTarget, refKey);
            return async (mutator: never) => {
              writes += 1;
              if (writes === 2) throw new Error("the watermark write failed");
              return refTarget.updateState(mutator);
            };
          }
        });
      };
    }
  });
  return { lines: rooms.lines, seq };
}

const step = (name: string, run: (input: any, refs: Refs) => Promise<unknown>) =>
  handler({
    name,
    inputSchema: z.record(z.unknown()),
    outputSchema: z.unknown(),
    resources: {
      [ROOM_LINES_RESOURCE]: defineRoomLinesCollection(),
      [ROOM_SEQ_RESOURCE]: defineRoomSeqCollection(),
      [ROOM_ANSWERS_RESOURCE]: defineRoomAnswersCollection()
    },
    execute: (input, ctx) => run(input, refsOf(ctx))
  });

const draftOf = (input: any): AnswerDraft => ({
  projectId: "apollo",
  postId: "apollo/000000000001",
  author: "eng.em",
  userId: "alice",
  body: input.body
});

const labFlow = defineFlow({
  kind: "lab",
  actions: {
    // A run that claimed and then died: the claim lands, nothing after it.
    claimOnly: { block: step("claim-only", async (input, { rooms, claims }) => (await claimAnswer(rooms, claims, draftOf(input))).state) },
    answer: { block: step("answer", (input, { rooms, claims }) => answerInRoom(rooms, claims, draftOf(input))) },
    answerFailingAdvance: {
      block: step("answer-failing-advance", (input, { rooms, claims }) =>
        answerInRoom(failingAdvance(rooms), claims, draftOf(input))
      )
    },
    allocate: { block: step("allocate", (input, { rooms }) => allocateSeq(rooms, input.projectId)) },
    writeAt: {
      block: step("write-at", (input, { rooms }) =>
        writeLineAt(rooms, { projectId: input.projectId, userId: "alice", author: null, body: input.body }, input.seq)
      )
    },
    readRoom: { block: step("read-room", (input, { rooms }) => readRoom(rooms, input.projectId, 0)) },
    wakeContext: { block: step("wake-context", (input, { rooms }) => recentRoomLines(rooms, input.projectId, input.seq)) }
  }
});

async function boot() {
  const state = createFlowState({
    flows: { lab: labFlow() },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: () => ({ userId: "alice", orgId: ORG })
  } as never);
  const router = (await state.getRouter()) as any;
  const call = async (method: "GET" | "POST", path: string[], body?: unknown, query = "") => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    const text = await response.text();
    return text.length > 0 ? JSON.parse(text) : undefined;
  };
  const session = (await call("POST", ["lab", "sessions"], { userId: "alice" })).session.id as string;
  /** Run an action and return how it settled, with its output or error. */
  const run = async (action: string, input: unknown): Promise<{ status: string; output?: any; error?: any }> => {
    const requestId = (await call("POST", ["lab", session, "actions", action], { userId: "alice", input })).request.id;
    for (let i = 0; i < 1000; i += 1) {
      const polled = await call("GET", ["lab", "requests", requestId, "status"]);
      if (["completed", "errored", "failed", "cancelled"].includes(polled?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const json = await call("GET", ["sessions", session, "requests"], undefined, "?include_result_output=true");
    const found = (json.requests as Array<Record<string, any>>).find((r) => r.id === requestId)!;
    return { status: found.status, output: found.result?.output, error: found.result?.error };
  };
  const ok = async (action: string, input: unknown) => {
    const result = await run(action, input);
    if (result.status !== "completed") throw new Error(`${action}: ${result.status} ${JSON.stringify(result.error)}`);
    return result.output;
  };
  const seatLines = async (): Promise<RoomLine[]> =>
    ((await ok("readRoom", { projectId: "apollo" })).lines as RoomLine[]).filter((line) => line.author !== null);
  return { run, ok, seatLines };
}

describe("a seat's answer into a project's room", () => {
  it("finishes an answer whose run died after its claim: the next delivery lands exactly one line, in the claimed words", async () => {
    const h = await boot();
    const claim = await h.ok("claimOnly", { body: "first words" });
    // The crashed run allocated and claimed; no line, nothing committed.
    expect(claim).toMatchObject({ seq: 1, body: "first words" });
    expect(await h.seatLines()).toEqual([]);

    // The replay finishes it: the line lands at the claimed seq, and the room's watermark moves.
    const landed = await h.ok("answer", { body: "second words" });
    expect(landed).toMatchObject({ seq: 1, author: "eng.em", body: "first words" });
    expect(await h.ok("answer", { body: "third words" })).toBeNull();
    const lines = await h.seatLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ seq: 1, body: "first words", userId: "alice" });
  });

  it("finishes an answer whose watermark step failed after its line landed, writing no second line", async () => {
    const h = await boot();
    const failed = await h.run("answerFailingAdvance", { body: "once" });
    expect(failed.status).not.toBe("completed");
    // The line is written but not yet committed: a reader sees nothing.
    expect(await h.seatLines()).toEqual([]);

    // The retry finds the claim and its line, advances the watermark, and writes nothing.
    expect(await h.ok("answer", { body: "once" })).toBeNull();
    const lines = await h.seatLines();
    expect(lines.map((line) => line.seq)).toEqual([1]);
  });
});

describe("a woken seat's context", () => {
  it("stops at the room's watermark: a line written past a stalled gap is not shown", async () => {
    const h = await boot();
    // Seq 1 is allocated and never written (its writer stalled); seq 2 is written.
    expect(await h.ok("allocate", { projectId: "apollo" })).toBe(1);
    expect(await h.ok("allocate", { projectId: "apollo" })).toBe(2);
    expect(await h.ok("writeAt", { projectId: "apollo", seq: 2, body: "past the gap" })).toBe(true);

    // A post at seq 3 wakes its seats: line 2 is not committed, so it is not context.
    expect(await h.ok("wakeContext", { projectId: "apollo", seq: 3 })).toEqual([]);

    // Once the gap fills, both lines are committed and both are shown.
    expect(await h.ok("writeAt", { projectId: "apollo", seq: 1, body: "the stalled one" })).toBe(true);
    await h.ok("answer", { body: "commits the room" });
    const context = await h.ok("wakeContext", { projectId: "apollo", seq: 3 });
    expect(context.map((line: { body: string }) => line.body)).toEqual(["the stalled one", "past the gap"]);
  });
});
