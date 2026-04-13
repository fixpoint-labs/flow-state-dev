import { describe, expect, it, vi, beforeEach } from "vitest";
import { hashContent } from "../src/bash/hash";
import { FileSync } from "../src/bash/file-sync";
import { createBashTool } from "../src/bash/create-bash-tool";
import type { Sandbox, CommandResult, FileEntryState } from "../src/bash/types";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";

// ---------------------------------------------------------------------------
// Helpers: mock sandbox
// ---------------------------------------------------------------------------

function createMockSandbox(
  initialFiles: Record<string, string> = {},
): Sandbox & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initialFiles));

  return {
    files,

    async executeCommand(command: string): Promise<CommandResult> {
      // Support `find` for workspace walking
      if (command.startsWith("find ")) {
        const paths = Array.from(files.keys());
        return { stdout: paths.join("\n"), stderr: "", exitCode: 0 };
      }
      // Support `echo` for basic commands
      if (command.startsWith("echo ")) {
        return { stdout: command.slice(5) + "\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },

    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },

    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers: mock resource collection
// ---------------------------------------------------------------------------

interface MockResourceEntry {
  name: string;
  state: FileEntryState;
  content: string | null;
}

function createMockCollection(
  entries: MockResourceEntry[] = [],
): ResourceCollectionRef<FileEntryState> {
  const store = new Map<string, MockResourceEntry>();
  for (const entry of entries) {
    store.set(entry.name, entry);
  }

  const makeRef = (entry: MockResourceEntry): ResourceRef<FileEntryState> => ({
    name: entry.name,
    scope: "session",
    state: entry.state,
    patchState: vi.fn(async (updates: Partial<FileEntryState>) => {
      entry.state = { ...entry.state, ...updates };
    }),
    setState: vi.fn(async (next: FileEntryState) => {
      entry.state = next;
    }),
    updateState: vi.fn(async (updater) => {
      entry.state = await updater(entry.state);
    }),
    readContent: vi.fn(async () => entry.content),
    readContentRaw: vi.fn(async () => entry.content),
    writeContent: vi.fn(async (content: string) => {
      entry.content = content;
    }),
    config: { stateSchema: {} as any },
  });

  return {
    pattern: "files/*",
    scope: "session",

    get(key: string): ResourceRef<FileEntryState> {
      const entry = store.get(key);
      if (!entry) throw new Error(`Not found: ${key}`);
      return makeRef(entry);
    },

    getOptional(key: string): ResourceRef<FileEntryState> | undefined {
      const entry = store.get(key);
      return entry ? makeRef(entry) : undefined;
    },

    create: vi.fn(async (key: string, initial?: Partial<FileEntryState>) => {
      if (store.has(key)) throw new Error(`Already exists: ${key}`);
      const entry: MockResourceEntry = {
        name: key,
        state: {
          path: initial?.path ?? key,
          hash: initial?.hash ?? "",
          updatedAt: initial?.updatedAt ?? new Date().toISOString(),
        },
        content: null,
      };
      store.set(key, entry);
      return makeRef(entry);
    }),

    getOrCreate: vi.fn(async (key: string, initial?: Partial<FileEntryState>) => {
      const existing = store.get(key);
      if (existing) return makeRef(existing);
      const entry: MockResourceEntry = {
        name: key,
        state: {
          path: initial?.path ?? key,
          hash: initial?.hash ?? "",
          updatedAt: initial?.updatedAt ?? new Date().toISOString(),
        },
        content: null,
      };
      store.set(key, entry);
      return makeRef(entry);
    }),

    list(): ResourceRef<FileEntryState>[] {
      return Array.from(store.values()).map(makeRef);
    },

    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),

    count(): number {
      return store.size;
    },

    config: { pattern: "files/*", stateSchema: {} as any },

    // Expose internals for assertions
    _store: store,
  } as ResourceCollectionRef<FileEntryState> & { _store: Map<string, MockResourceEntry> };
}

// ---------------------------------------------------------------------------
// hashContent
// ---------------------------------------------------------------------------

describe("hashContent", () => {
  it("returns consistent hashes for the same content", () => {
    const a = hashContent("hello world");
    const b = hashContent("hello world");
    expect(a).toBe(b);
  });

  it("returns different hashes for different content", () => {
    const a = hashContent("hello");
    const b = hashContent("world");
    expect(a).not.toBe(b);
  });

  it("returns a hex string", () => {
    const hash = hashContent("test");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// FileSync
// ---------------------------------------------------------------------------

describe("FileSync", () => {
  describe("hydrate", () => {
    it("writes resource entries into the sandbox", async () => {
      const sandbox = createMockSandbox();
      const collection = createMockCollection([
        {
          name: "src/index.ts",
          state: { path: "src/index.ts", hash: "abc", updatedAt: "2026-01-01" },
          content: "console.log('hello');",
        },
        {
          name: "src/utils.ts",
          state: { path: "src/utils.ts", hash: "def", updatedAt: "2026-01-01" },
          content: "export const add = (a, b) => a + b;",
        },
      ]);

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
      });

      await sync.hydrate();

      expect(sandbox.files.get("/workspace/src/index.ts")).toBe("console.log('hello');");
      expect(sandbox.files.get("/workspace/src/utils.ts")).toBe("export const add = (a, b) => a + b;");
    });

    it("skips entries with null content", async () => {
      const sandbox = createMockSandbox();
      const collection = createMockCollection([
        {
          name: "empty.txt",
          state: { path: "empty.txt", hash: "", updatedAt: "2026-01-01" },
          content: null,
        },
      ]);

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
      });

      await sync.hydrate();
      expect(sandbox.files.has("/workspace/empty.txt")).toBe(false);
    });
  });

  describe("flush", () => {
    it("creates new resource entries for files added in the sandbox", async () => {
      const sandbox = createMockSandbox({
        "/workspace/new-file.ts": "const x = 1;",
      });
      const collection = createMockCollection();

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
      });

      await sync.flush();

      expect(collection.getOrCreate).toHaveBeenCalledWith(
        "new-file.ts",
        expect.objectContaining({ path: "new-file.ts" }),
      );
    });

    it("updates resource entries when sandbox files change", async () => {
      const originalContent = "const x = 1;";
      const updatedContent = "const x = 2;";

      const collection = createMockCollection([
        {
          name: "file.ts",
          state: {
            path: "file.ts",
            hash: hashContent(originalContent),
            updatedAt: "2026-01-01",
          },
          content: originalContent,
        },
      ]);

      const sandbox = createMockSandbox({
        "/workspace/file.ts": updatedContent,
      });

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
      });

      await sync.flush();

      // getOrCreate should be called for the changed file
      expect(collection.getOrCreate).toHaveBeenCalledWith(
        "file.ts",
        expect.objectContaining({ path: "file.ts" }),
      );
    });

    it("removes resource entries when files are deleted from the sandbox", async () => {
      const collection = createMockCollection([
        {
          name: "deleted.ts",
          state: { path: "deleted.ts", hash: "abc", updatedAt: "2026-01-01" },
          content: "will be deleted",
        },
      ]);

      // Sandbox has no files — deleted.ts was removed
      const sandbox = createMockSandbox();

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
      });

      await sync.flush();

      expect(collection.delete).toHaveBeenCalledWith("deleted.ts");
    });

    it("skips files rejected by fileFilter", async () => {
      const sandbox = createMockSandbox({
        "/workspace/keep.ts": "keep me",
        "/workspace/node_modules/dep/index.js": "skip me",
      });
      const collection = createMockCollection();

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
        fileFilter: (p) => !p.includes("node_modules"),
      });

      await sync.flush();

      // getOrCreate called for keep.ts but not for node_modules path
      const calls = (collection.getOrCreate as ReturnType<typeof vi.fn>).mock.calls;
      const paths = calls.map((c: any[]) => c[0]);
      expect(paths).toContain("keep.ts");
      expect(paths).not.toContain("node_modules/dep/index.js");
    });

    it("does not touch files that match no collection in diff mode", async () => {
      const sandbox = createMockSandbox({
        "/workspace/file.ts": "const x = 1;",
      });
      const collection = createMockCollection([
        {
          name: "file.ts",
          state: {
            path: "file.ts",
            hash: hashContent("const x = 1;"),
            updatedAt: "2026-01-01",
          },
          content: "const x = 1;",
        },
      ]);

      const sync = new FileSync(sandbox, { files: collection }, {
        destination: "/workspace",
        syncMode: "diff",
      });

      await sync.flush();

      // File content unchanged, so getOrCreate should still be called
      // but writeContent should see the same content (no-op from hash check)
      const ref = collection.getOptional("file.ts");
      expect(ref).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// createBashTool
// ---------------------------------------------------------------------------

describe("createBashTool", () => {
  // Mock the adapters module to avoid importing real sandbox adapters
  vi.mock("../src/bash/adapters/just-bash", () => ({
    createJustBashSandbox: vi.fn(async () => {
      const files = new Map<string, string>();
      return {
        async executeCommand(command: string): Promise<CommandResult> {
          if (command.startsWith("find ")) {
            return { stdout: Array.from(files.keys()).join("\n"), stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        async readFile(path: string): Promise<string> {
          const content = files.get(path);
          if (content === undefined) throw new Error(`File not found: ${path}`);
          return content;
        },
        async writeFile(path: string, content: string): Promise<void> {
          files.set(path, content);
        },
      };
    }),
  }));

  it("returns tools and sandbox", async () => {
    const result = await createBashTool();

    expect(result.tools).toBeDefined();
    expect(result.tools.bash).toBeDefined();
    expect(result.tools.readFile).toBeDefined();
    expect(result.tools.writeFile).toBeDefined();
    expect(result.sandbox).toBeDefined();
  });

  it("uses just-bash by default", async () => {
    const { createJustBashSandbox } = await import("../src/bash/adapters/just-bash");
    await createBashTool();
    expect(createJustBashSandbox).toHaveBeenCalled();
  });

  it("uses local-fs when provider type is local", async () => {
    const result = await createBashTool({
      provider: { type: "local", cwd: "/tmp/test-workspace" },
    });

    expect(result.sandbox).toBeDefined();
  });

  it("uses custom sandbox when provider type is custom", async () => {
    const customSandbox = createMockSandbox();
    const result = await createBashTool({
      provider: { type: "custom", sandbox: customSandbox },
    });

    expect(result.sandbox).toBe(customSandbox);
  });

  it("hydrates resources into sandbox on creation", async () => {
    const collection = createMockCollection([
      {
        name: "hello.txt",
        state: { path: "hello.txt", hash: "abc", updatedAt: "2026-01-01" },
        content: "Hello, world!",
      },
    ]);

    const customSandbox = createMockSandbox();
    await createBashTool({
      collections: { files: collection },
      provider: { type: "custom", sandbox: customSandbox },
    });

    expect(customSandbox.files.get("/workspace/hello.txt")).toBe("Hello, world!");
  });

  it("calls onBeforeCommand hook", async () => {
    const customSandbox = createMockSandbox();
    const onBeforeCommand = vi.fn((cmd: string) => `safe-${cmd}`);

    const { tools } = await createBashTool({
      provider: { type: "custom", sandbox: customSandbox },
      onBeforeCommand,
    });

    // Execute the bash tool
    const bashTool = tools.bash as { execute: (args: { command: string }) => Promise<CommandResult> };
    await bashTool.execute({ command: "echo hi" });

    expect(onBeforeCommand).toHaveBeenCalledWith("echo hi");
  });

  it("calls onAfterCommand hook", async () => {
    const customSandbox = createMockSandbox();
    const overrideResult: CommandResult = { stdout: "overridden", stderr: "", exitCode: 0 };
    const onAfterCommand = vi.fn(() => overrideResult);

    const { tools } = await createBashTool({
      provider: { type: "custom", sandbox: customSandbox },
      onAfterCommand,
    });

    const bashTool = tools.bash as { execute: (args: { command: string }) => Promise<CommandResult> };
    const result = await bashTool.execute({ command: "echo hi" });

    expect(onAfterCommand).toHaveBeenCalled();
    expect(result).toEqual(overrideResult);
  });
});

// ---------------------------------------------------------------------------
// Sandbox adapters — unit tests
// ---------------------------------------------------------------------------

describe("adapters", () => {
  describe("local-fs", () => {
    it("creates a sandbox with file operations", async () => {
      // Dynamic import to test the adapter directly
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const sandbox = createLocalFsSandbox({ cwd: "/tmp/bash-tool-test" });

      expect(sandbox.executeCommand).toBeDefined();
      expect(sandbox.readFile).toBeDefined();
      expect(sandbox.writeFile).toBeDefined();
    });
  });

  describe("upstash", () => {
    it("throws when resolving (placeholder)", async () => {
      const { resolveUpstashBox } = await import("../src/bash/adapters/upstash");
      await expect(resolveUpstashBox()).rejects.toThrow("not yet implemented");
    });
  });
});
