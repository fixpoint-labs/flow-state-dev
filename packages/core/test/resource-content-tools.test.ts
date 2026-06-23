import { describe, it, expect } from "vitest";
import { readResourceContentTool, writeResourceContentTool } from "../src/tools/resource-content-tools";
import type { BlockContext } from "../src/types/block";
import { createMockContext, runForTest } from "./helpers";

// A recorded writeContent call, so write tests can assert the body reached the ref.
type WriteCall = { uri: string; content: string };

type MockResource = { path: string; content?: string | null; llmReadable?: boolean; llmWritable?: boolean };
// A collection's flags are declared once at the collection level and apply to
// every instance — the mock mirrors that by stamping the same config on each
// instance ref (the server does this via `config: nsConfig`).
type MockCollection = {
  pattern: string;
  llmReadable?: boolean;
  llmWritable?: boolean;
  instances: Array<{ path: string; content?: string | null }>;
};

function refOf(
  r: { path: string; content?: string | null; llmReadable?: boolean; llmWritable?: boolean },
  writes: WriteCall[],
): any {
  const uri = `session/${r.path}`;
  return {
    path: r.path,
    scope: "session",
    uri,
    state: {},
    config: { llmReadable: r.llmReadable ?? false, llmWritable: r.llmWritable ?? false },
    readContent: async () => (r.content === undefined ? null : r.content),
    readContentRaw: async () => (r.content === undefined ? null : r.content),
    writeContent: async (content: string) => {
      writes.push({ uri, content });
    },
  };
}

function makeCtx(
  statics: MockResource[],
  collections: MockCollection[],
  writes: WriteCall[],
): BlockContext {
  const entries: any[] = [];
  for (const r of statics) entries.push(refOf(r, writes));
  for (const c of collections) {
    const prefix = c.pattern.replace(/\/?\*+$/, "");
    const mkInstance = (inst: { path: string; content?: string | null }) =>
      refOf({ ...inst, llmReadable: c.llmReadable, llmWritable: c.llmWritable }, writes);
    entries.push({
      pattern: c.pattern,
      scope: "session",
      // Collection-level flags live on the collection ref's config (the server
      // stamps `config: nsConfig`); the readable-listing path gates on this
      // before calling list().
      config: { llmReadable: c.llmReadable ?? false, llmWritable: c.llmWritable ?? false },
      create: async () => {},
      list: async () => c.instances.map(mkInstance),
      // Exact-uri resolution calls getOptional on the matching collection only.
      getOptional: async (key: string) => {
        const inst = c.instances.find((i) => i.path === `${prefix}/${key}`);
        return inst ? mkInstance(inst) : undefined;
      },
    });
  }
  return createMockContext({
    resources: {
      list: () => entries,
      get: ((name: string) => entries.find((e: any) => e.path === name)) as any,
    } as any,
  });
}

const readTool = readResourceContentTool();
const writeTool = writeResourceContentTool();

describe("readResourceContentTool", () => {
  it("lists readable uris across statics and collection instances, sorted", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx(
      [
        { path: "soul", content: "s", llmReadable: true },
        { path: "secret", content: "x", llmReadable: false },
      ],
      [{ pattern: "artifacts/**", llmReadable: true, instances: [{ path: "artifacts/b" }, { path: "artifacts/a" }] }],
      writes,
    );
    const { uris } = await runForTest(readTool, {}, ctx);
    expect(uris).toEqual(["session/artifacts/a", "session/artifacts/b", "session/soul"]);
  });

  it("reads a readable collection instance by uri", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx(
      [],
      [{ pattern: "artifacts/**", llmReadable: true, instances: [{ path: "artifacts/memo-1", content: "the body" }] }],
      writes,
    );
    const result = await runForTest(readTool, { uri: "session/artifacts/memo-1" }, ctx);
    expect(result).toEqual({ uri: "session/artifacts/memo-1", content: "the body" });
  });

  it("reads a static resource by uri (uri addressing regression)", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx([{ path: "soul", content: "rendered", llmReadable: true }], [], writes);
    const result = await runForTest(readTool, { uri: "session/soul" }, ctx);
    expect(result).toEqual({ uri: "session/soul", content: "rendered" });
  });

  it("throws when the collection has not opted into llmReadable", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx(
      [],
      [{ pattern: "artifacts/**", llmReadable: false, instances: [{ path: "artifacts/memo-1", content: "hidden" }] }],
      writes,
    );
    await expect(runForTest(readTool, { uri: "session/artifacts/memo-1" }, ctx)).rejects.toThrow(
      "Readable resource not found for uri: session/artifacts/memo-1",
    );
  });

  it("throws on an unknown uri", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx([], [], writes);
    await expect(runForTest(readTool, { uri: "session/nope" }, ctx)).rejects.toThrow(
      "Readable resource not found for uri: session/nope",
    );
  });
});

describe("writeResourceContentTool", () => {
  it("overwrites a writable collection instance by uri", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx(
      [],
      [
        {
          pattern: "artifacts/**",
          llmReadable: true,
          llmWritable: true,
          instances: [{ path: "artifacts/memo-1", content: "old" }],
        },
      ],
      writes,
    );
    const result = await runForTest(writeTool, { uri: "session/artifacts/memo-1", content: "new body" }, ctx);
    expect(result).toEqual({ uri: "session/artifacts/memo-1", ok: true });
    expect(writes).toEqual([{ uri: "session/artifacts/memo-1", content: "new body" }]);
  });

  it("throws when the collection is readable but not writable", async () => {
    const writes: WriteCall[] = [];
    const ctx = makeCtx(
      [],
      [
        {
          pattern: "artifacts/**",
          llmReadable: true,
          llmWritable: false,
          instances: [{ path: "artifacts/memo-1", content: "old" }],
        },
      ],
      writes,
    );
    await expect(
      runForTest(writeTool, { uri: "session/artifacts/memo-1", content: "x" }, ctx),
    ).rejects.toThrow("Writable resource not found for uri: session/artifacts/memo-1");
    expect(writes).toEqual([]);
  });
});
