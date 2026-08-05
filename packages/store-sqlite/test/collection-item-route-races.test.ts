/**
 * Goal check for the collection-item write routes (FIX-992 D12), on a durable
 * store and through the real HTTP path.
 *
 * The engine's own route tests run against the in-memory adapter and call the
 * handlers directly. Both substitutions matter here, so this file removes them:
 * the store is a file-backed SQLite registry, where the compare-and-swap is a
 * SQL `WHERE` clause rather than the shared JS predicate, and the requests go
 * through `createFlowApiRouter` rather than into a handler by hand.
 *
 * What it proves is the outcome, not the mechanism: after two clients race for
 * one topic, the row that survived a restart holds the winner's content — and a
 * DELETE built against a generation that has since been replaced leaves the
 * replacement untouched in both stores.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/engine";
import type { SessionRecord } from "@flow-state-dev/engine";
import { createSQLiteStores } from "../src";

const notes = defineResourceCollection({
  scope: "session",
  pattern: "notes/*",
  stateSchema: z.object({ title: z.string().default("") }),
  client: {
    content: { read: true, create: true, update: true, delete: true },
    state: { read: true },
  },
});

const flow = defineFlow({
  kind: "notes-flow",
  actions: {
    run: {
      inputSchema: z.string(),
      block: handler({ name: "noop", resources: { notes }, execute: () => "ok" }),
    },
  },
})();

const SESSION_ID = "sess_1";
const KEY = "notes/a";

let dir: string;
let file: string;
let stores: ReturnType<typeof createSQLiteStores>;
let router: ReturnType<typeof createFlowApiRouter>;

async function openStores(): Promise<void> {
  stores = createSQLiteStores({ filename: file });
  const registry = createFlowRegistry();
  registry.register(flow);
  router = createFlowApiRouter({ registry, stores });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-route-race-"));
  file = path.join(dir, "store.db");
  await openStores();
  const session: SessionRecord = {
    id: SESSION_ID,
    flowKind: "notes-flow",
    userId: "user_1",
    state: {},
    version: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    journal: [],
  };
  await stores.session.set(SESSION_ID, session, "any");
});

afterEach(() => {
  stores.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Close and reopen the database file, so every read below is a durable read. */
async function restart(): Promise<void> {
  stores.close?.();
  await openStores();
}

const BASE = `http://x/api/flows/sessions/${SESSION_ID}/resources/notes`;
const CREATE_PATH = ["sessions", SESSION_ID, "resources", "notes"];

function post(topic: string, content: string): Promise<Response> {
  return router.POST(new Request(BASE, { method: "POST", body: JSON.stringify({ topic, content }) }), {
    params: { path: CREATE_PATH },
  });
}

function del(topic: string): Promise<Response> {
  return router.DELETE(new Request(`${BASE}/${topic}`, { method: "DELETE" }), {
    params: { path: [...CREATE_PATH, topic] },
  });
}

function storedContent(): Promise<string | undefined> {
  return stores.content.get("session", SESSION_ID, KEY);
}

/**
 * Hold the next resource-state read open, so a test can move the key while a
 * route is mid-request.
 *
 * `whenRead` races a turn of the event loop rather than waiting outright: a
 * route that never reads must fail its assertions, not hang the suite.
 */
function gateNextStateRead() {
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let markRead!: () => void;
  const read = new Promise<void>((r) => {
    markRead = r;
  });

  let armed = true;
  const real = stores.resourceState.get.bind(stores.resourceState);
  stores.resourceState.get = async (...args) => {
    const value = await real(...args);
    if (!armed) return value;
    armed = false;
    markRead();
    await released;
    return value;
  };

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return {
    whenRead: async () => {
      await Promise.race([read, tick().then(tick)]);
      armed = false;
    },
    release,
  };
}

describe("collection-item write routes on a durable store", () => {
  it("two clients racing one topic: the surviving content is the winner's", async () => {
    const [first, second] = await Promise.all([post("a", "from-first"), post("a", "from-second")]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? "from-first" : "from-second";

    await restart();
    expect(await storedContent()).toBe(winner);
    expect(await stores.resourceState.get("session", SESSION_ID, KEY)).toBeDefined();
  });

  it("a DELETE against a replaced generation leaves the replacement intact", async () => {
    expect((await post("a", "first-generation")).status).toBe(201);

    // Hold the DELETE route between its version read and its state delete, and
    // replace the generation underneath it. The request goes through the
    // router, so what is under test is the version the route carries and the
    // order it writes in — not the store's predicate, which is already pinned
    // by the conformance suite.
    const gate = gateNextStateRead();
    const inFlight = del("a");
    await gate.whenRead();

    expect((await del("a")).status).toBe(200);
    expect((await post("a", "second-generation")).status).toBe(201);

    gate.release();
    expect((await inFlight).status).toBe(409);

    await restart();
    expect(await storedContent()).toBe("second-generation");
    expect(await stores.resourceState.get("session", SESSION_ID, KEY)).toBeDefined();
  });

  /**
   * A durability guard rather than a change detector: it passes before and
   * after this change, and exists so the committed delete path is known to
   * still reach disk on a real adapter.
   */
  it("a live DELETE removes state and content, and the removal survives a restart", async () => {
    expect((await post("a", "doomed")).status).toBe(201);
    expect((await del("a")).status).toBe(200);

    await restart();
    expect(await stores.resourceState.get("session", SESSION_ID, KEY)).toBeUndefined();
    expect(await storedContent()).toBeUndefined();
  });
});
