/**
 * FIX-1337: what a DELEGATED agent actually emits, and what survives the board.
 *
 * `materialize-agent.test.ts` asserts what the generator was *handed*. That is
 * configuration, and configuration can be right while the promise is false, so
 * the two behaviours here are the ones that read the other end:
 *
 *  - **Through the real seam.** `materializeWorker` resolves an `agent-ref`
 *    seat through the agent registry and the injected materializer — the path a
 *    delegation skill takes, and the one FIX-1327's `skill-forced-worker.test.ts`
 *    already exercises. The worker is then run with a scripted model, so the
 *    assertion is on the value a delegated seat emits.
 *  - **Across a durable board's persist and resume.** A structured result is
 *    written onto a task, the rows are serialized the way a durable adapter
 *    serializes them, and a fresh collection reads them back. This is where
 *    refusing output transforms earns its place: nothing else in the suite can
 *    fail when that rule is dropped.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import {
  createResourceBackedTaskCollection,
  materializeWorker,
} from "@flow-state-dev/orchestration";
import { defineAgent } from "../src/define-agent";
import { createAgentRegistry } from "../src/agent-registry";
import { materializeAgent } from "../src/materialize-agent";

const decision = z.object({ ticker: z.string(), sizePct: z.number() });

const sizer = defineAgent({
  name: "position-sizer",
  description: "Sizes a position into a typed decision.",
  persona: "You size positions.",
  outputSchema: decision,
});

/** Seat an agent on a skill board the way a delegation skill does. */
async function seat(agent: ReturnType<typeof defineAgent>, workerKey: string) {
  return materializeWorker(
    workerKey,
    { agentRef: agent.name },
    {
      catalog: {},
      agentRegistry: createAgentRegistry([agent]),
      materializeAgent,
      skillName: "desk",
    } as never,
  );
}

/**
 * A resource collection that persists rows as JSON text, keyed by a `rows` map
 * the caller owns.
 *
 * Serializing on write and parsing on read is what a durable adapter does — the
 * filesystem store writes JSON, and both SQL adapters stringify on write and
 * parse per read (see the header of
 * `engine/src/stores/memory/resource-state-store.ts`, which documents itself as
 * the exception: it is the one adapter that keeps the caller's object graph
 * alive, and so the one that cannot show this). Handing the same `rows` map to
 * a second collection is the resume: a fresh process reading committed bytes.
 *
 * Only the surface `createResourceBackedTaskCollection` uses is implemented.
 */
function serializingCollection(rows: Map<string, string>): ResourceCollectionRef<JsonObject> {
  const read = (key: string): JsonObject => JSON.parse(rows.get(key) ?? "{}") as JsonObject;
  const write = (key: string, value: JsonObject) => rows.set(key, JSON.stringify(value));

  const instanceRef = (key: string) => ({
    path: key,
    scope: "session",
    uri: `session/${key}`,
    config: { scope: "session" },
    get state() {
      return read(key);
    },
    async patchState(updates: Partial<JsonObject>) {
      write(key, { ...read(key), ...updates });
    },
    async setState(next: JsonObject) {
      write(key, next);
    },
    async updateState(updater: (current: JsonObject) => JsonObject | Promise<JsonObject>) {
      write(key, await updater(read(key)));
    },
    async readContentRaw() {
      return null;
    },
    async readContent() {
      return null;
    },
    async writeContent() {},
  });

  return {
    pattern: "tasks/{id}",
    scope: "session",
    config: { pattern: "tasks/{id}", scope: "session" },
    async get(key: string | Record<string, string>) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      if (!rows.has(k)) throw new Error(`Resource instance "${k}" not found`);
      return instanceRef(k);
    },
    async getOptional(key: string | Record<string, string>) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      return rows.has(k) ? instanceRef(k) : undefined;
    },
    async create(key: string | Record<string, string>, initial?: JsonObject) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      write(k, initial ?? {});
      return instanceRef(k);
    },
    async getOrCreate(key: string | Record<string, string>, initial?: JsonObject) {
      const k = typeof key === "string" ? key : Object.values(key).join("/");
      if (!rows.has(k)) write(k, initial ?? {});
      return instanceRef(k);
    },
    async list(prefix?: string) {
      return [...rows.keys()]
        .filter((k) => prefix === undefined || k.startsWith(prefix))
        .map(instanceRef);
    },
    async delete(key: string | Record<string, string>) {
      rows.delete(typeof key === "string" ? key : Object.values(key).join("/"));
    },
    async count() {
      return rows.size;
    },
  } as unknown as ResourceCollectionRef<JsonObject>;
}

describe("a delegated agent's declared result shape (FIX-1337)", () => {
  it("emits the declared shape from a seat materialized through the agent-ref seam", async () => {
    const block = await seat(sizer, "sizer");
    const model = mockGenerator({
      name: "sizer-model",
      script: [{ structuredOutput: { ticker: "NVDA", sizePct: 4 } }],
    });

    const run = await testBlock(block as never, {
      input: { taskId: "t1", goal: "Size NVDA", attempts: 0 } as never,
      generators: { skillWorker_desk_sizer: model },
    });

    expect(run.error).toBeNull();
    // The value the seat emits, not the schema it was handed: typed data the
    // coordinator reads off the task, where it used to get prose.
    expect(run.output).toEqual({ ticker: "NVDA", sizePct: 4 });
  });

  it("still emits text from a seat whose agent declares no shape", async () => {
    const plain = defineAgent({
      name: "briefer",
      description: "Writes a short briefing.",
      persona: "You brief.",
    });
    const block = await seat(plain, "briefer");
    const model = mockGenerator({ name: "briefer-model", script: [{ text: "NVDA looks rich." }] });

    const run = await testBlock(block as never, {
      input: { taskId: "t1", goal: "Brief me", attempts: 0 } as never,
      generators: { skillWorker_desk_briefer: model },
    });

    expect(run.error).toBeNull();
    expect(run.output).toBe("NVDA looks rich.");
  });

  it("reads a structured result back as the same shape after a durable board resumes", async () => {
    const rows = new Map<string, string>();
    const result = decision.parse({ ticker: "NVDA", sizePct: 4 });

    const board = await createResourceBackedTaskCollection({
      collectionId: "desk",
      collection: serializingCollection(rows),
    });
    await board.addTask({ id: "t1", goal: "Size NVDA" });
    await board.claim("w1");
    await board.complete("t1", result);

    // Resume: a fresh collection over the committed rows, as a later request
    // (or a later process) resolves it.
    const resumed = await createResourceBackedTaskCollection({
      collectionId: "desk",
      collection: serializingCollection(rows),
    });

    expect(resumed.get("t1")?.status).toBe("completed");
    expect(resumed.get("t1")?.output).toEqual({ ticker: "NVDA", sizePct: 4 });
  });

  it("would not read back the same had a declared field transformed on parse", async () => {
    // Why the transform rule exists, measured rather than asserted. A field
    // that parses to a Date is a different value after the round-trip, so the
    // declared shape and the resumed shape would disagree — which is the same
    // defect this issue closes, one layer down. `materializeAgent` refuses such
    // a shape (see materialize-agent.test.ts), so it never reaches a board.
    const rows = new Map<string, string>();
    const transformed = z
      .object({ asOf: z.string().transform((v) => new Date(v)) })
      .parse({ asOf: "2026-09-10T00:00:00.000Z" });
    expect(transformed.asOf).toBeInstanceOf(Date);

    const board = await createResourceBackedTaskCollection({
      collectionId: "desk",
      collection: serializingCollection(rows),
    });
    await board.addTask({ id: "t1", goal: "Stamp it" });
    await board.claim("w1");
    await board.complete("t1", transformed);

    const resumed = await createResourceBackedTaskCollection({
      collectionId: "desk",
      collection: serializingCollection(rows),
    });

    const asOf = (resumed.get("t1")?.output as { asOf: unknown }).asOf;
    expect(asOf).not.toBeInstanceOf(Date);
    expect(asOf).toBe("2026-09-10T00:00:00.000Z");
  });
});
