import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { utility, sequencer, handler } from "../src";
import { createMockContext } from "./helpers";
import type { BlockContext } from "../src/types/block";
import type { ResourceCollectionRef } from "../src/types/resource-collection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NoteState = { title: string; updatedAt: number; summary?: string };

function makeCollectionRef(initial: Record<string, NoteState> = {}): ResourceCollectionRef<NoteState> {
  const store = new Map<string, { state: NoteState; content?: string }>(
    Object.entries(initial).map(([k, v]) => [k, { state: { ...v } }])
  );

  return {
    pattern: "notes/*",
    scope: "session",
    get: (key) => {
      const entry = store.get(key as string);
      if (!entry) throw new Error(`not found: ${key}`);
      return makeRef(key as string, entry, store);
    },
    getOptional: (key) => {
      const entry = store.get(key as string);
      return entry ? makeRef(key as string, entry, store) : undefined;
    },
    getOrCreate: async (key, initialState) => {
      const k = key as string;
      if (!store.has(k)) {
        store.set(k, { state: { ...initialState } as NoteState });
      }
      return makeRef(k, store.get(k)!, store);
    },
    create: async (key, initialState) => {
      const k = key as string;
      store.set(k, { state: { ...initialState } as NoteState });
      return makeRef(k, store.get(k)!, store);
    },
    list: () => [...store.entries()].map(([k, entry]) => makeRef(k, entry, store)),
    delete: async (key) => { store.delete(key as string); },
    count: () => store.size,
    config: { pattern: "notes/*", stateSchema: z.object({}) },
  };
}

function makeRef(
  key: string,
  entry: { state: NoteState; content?: string },
  store: Map<string, { state: NoteState; content?: string }>
) {
  return {
    name: key,
    state: entry.state,
    patchState: vi.fn(async (patch: Partial<NoteState>) => {
      entry.state = { ...entry.state, ...patch };
    }),
    setState: vi.fn(async (state: NoteState) => { entry.state = state; }),
    readContent: async () => entry.content ?? null,
    writeContent: vi.fn(async (content: string) => { entry.content = content; }),
    readContentRaw: async () => null,
  } as any;
}

function makeCtx(collection: ResourceCollectionRef<NoteState>): BlockContext {
  return createMockContext({
    session: {
      identity: { type: "session", id: "sess_1", sessionId: "sess_1", userId: "user_1" },
      state: {},
      items: { llm: () => [] } as any,
      resources: {
        notes: collection,
        get: () => { throw new Error("not used"); },
        list: () => [collection as any],
      } as any,
      patchState: async () => undefined,
      setState: async () => undefined,
      incState: async () => undefined,
      pushState: async () => undefined,
      setStateRecord: async () => undefined,
      deleteStateRecord: async () => undefined,
      atomicState: async () => undefined,
      setMetadata: async () => undefined,
      emitComponent: () => ({ done: () => undefined }),
    },
  });
}

const noteInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("utility.upsertResource", () => {
  it("returns a handler block", () => {
    const block = utility.upsertResource({
      name: "upsert-note",
      inputSchema: noteInputSchema,
      sessionResources: {},
      collectionKey: "notes",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 0 }),
    });

    expect(block.kind).toBe("handler");
    expect(block.name).toBe("upsert-note");
  });

  it("creates a new resource instance when it does not exist", async () => {
    const collection = makeCollectionRef();
    const block = utility.upsertResource({
      name: "upsert-note",
      inputSchema: noteInputSchema,
      sessionResources: {},
      collectionKey: "notes",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 1000 }),
    });

    await block.run({ id: "note-1", title: "Hello", body: "World" }, makeCtx(collection));

    const ref = collection.getOptional("note-1");
    expect(ref).toBeDefined();
    expect(ref!.state.title).toBe("Hello");
  });

  it("patches state on an existing resource instance", async () => {
    const collection = makeCollectionRef({ "note-1": { title: "Old", updatedAt: 0 } });
    const block = utility.upsertResource({
      name: "upsert-note",
      inputSchema: noteInputSchema,
      sessionResources: {},
      collectionKey: "notes",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 2000 }),
    });

    await block.run({ id: "note-1", title: "Updated", body: "" }, makeCtx(collection));

    const ref = collection.getOptional("note-1");
    expect(ref!.state.title).toBe("Updated");
    expect(ref!.state.updatedAt).toBe(2000);
  });

  it("writes content when the content option is provided", async () => {
    const collection = makeCollectionRef();
    const block = utility.upsertResource({
      name: "upsert-note",
      inputSchema: noteInputSchema,
      sessionResources: {},
      collectionKey: "notes",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 0 }),
      content: (input) => input.body,
    });

    await block.run({ id: "note-2", title: "My Note", body: "Some content" }, makeCtx(collection));

    const ref = collection.getOptional("note-2");
    expect(await ref!.readContent()).toBe("Some content");
  });

  it("skips writing content when content returns undefined", async () => {
    const collection = makeCollectionRef();
    const block = utility.upsertResource({
      name: "upsert-note",
      inputSchema: noteInputSchema,
      sessionResources: {},
      collectionKey: "notes",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 0 }),
      content: () => undefined,
    });

    const ref = collection.makeCollectionRef ? null : null;
    await block.run({ id: "note-3", title: "No content", body: "" }, makeCtx(collection));

    const created = collection.getOptional("note-3");
    expect(await created!.readContent()).toBeNull();
  });

  it("can be used with tap to preserve chain value", async () => {
    const collection = makeCollectionRef();
    const block = utility.upsertResource({
      name: "upsert-note",
      inputSchema: noteInputSchema,
      sessionResources: {},
      collectionKey: "notes",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 0 }),
    });

    // Use .tap() so the original input is preserved in the chain
    const input = { id: "note-4", title: "Chain test", body: "body text" };
    let captured: unknown;

    const chain = sequencer({ name: "test-chain", inputSchema: noteInputSchema })
      .tap(block)
      .tap((value) => { captured = value; });

    await chain.run(input, makeCtx(collection));

    expect(captured).toEqual(input);
    // Resource was also written
    expect(collection.getOptional("note-4")).toBeDefined();
  });

  it("uses user scope when scope is set to 'user'", async () => {
    const collection = makeCollectionRef();
    const block = utility.upsertResource({
      name: "upsert-note-user",
      inputSchema: noteInputSchema,
      userResources: {},
      collectionKey: "notes",
      scope: "user",
      key: (input) => input.id,
      state: (input) => ({ title: input.title, updatedAt: 0 }),
    });

    const ctx = createMockContext({
      user: {
        identity: { type: "user", id: "user_1", userId: "user_1" },
        state: {},
        resources: {
          notes: collection,
          get: () => { throw new Error("not used"); },
          list: () => [collection as any],
        } as any,
        patchState: async () => undefined,
        setState: async () => undefined,
        incState: async () => undefined,
        pushState: async () => undefined,
        setStateRecord: async () => undefined,
        deleteStateRecord: async () => undefined,
        atomicState: async () => undefined,
      },
    });

    await block.run({ id: "u-note-1", title: "User note", body: "" }, ctx);

    const ref = collection.getOptional("u-note-1");
    expect(ref).toBeDefined();
    expect(ref!.state.title).toBe("User note");
  });
});
