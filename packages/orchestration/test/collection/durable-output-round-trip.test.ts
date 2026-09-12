/**
 * A completed task's structured output survives a durable board's persist and
 * resume.
 *
 * A board round-trips a task result through `JSON.stringify` on write and
 * `JSON.parse` on read, so what a worker returned and what a later request
 * reads back are two different values unless the shape is JSON-carryable. This
 * pins the carryable case: a plain object goes in, and the same object comes
 * back out of a fresh collection built over the committed bytes.
 *
 * Moved here from `@flow-state-dev/workforce` when the Agent factory was
 * removed. It was written there because a delegated agent's declared
 * `outputSchema` was the thing being round-tripped, but the fact it pins
 * belongs to this collection — the code that does the serializing.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createResourceBackedTaskCollection } from "../../src/tasks";

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

describe("a durable board's completed-task output", () => {
  it("reads a structured result back as the same shape after a resume", async () => {
    const rows = new Map<string, string>();

    const board = await createResourceBackedTaskCollection({
      collectionId: "desk",
      collection: serializingCollection(rows),
    });
    await board.addTask({ id: "t1", goal: "Size NVDA" });
    await board.claim("w1");
    await board.complete("t1", { ticker: "NVDA", sizePct: 4 });

    // Resume: a fresh collection over the committed rows, as a later request
    // (or a later process) resolves it.
    const resumed = await createResourceBackedTaskCollection({
      collectionId: "desk",
      collection: serializingCollection(rows),
    });

    expect(resumed.get("t1")?.status).toBe("completed");
    expect(resumed.get("t1")?.output).toEqual({ ticker: "NVDA", sizePct: 4 });
  });
});
