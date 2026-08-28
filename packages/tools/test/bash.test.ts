import { describe, expect, it, vi, beforeEach } from "vitest";
import { hashContent } from "@flow-state-dev/workspace";
import { createBashTool } from "../src/bash/create-bash-tool";
import type { Sandbox, CommandResult, FileEntryState } from "../src/bash/types";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";

import { runForTest } from "@flow-state-dev/testing";
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
    path: entry.name,
    scope: "session",
    uri: `session/${entry.name}`,
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

    async get(key: string): Promise<ResourceRef<FileEntryState>> {
      const entry = store.get(key);
      if (!entry) throw new Error(`Not found: ${key}`);
      return makeRef(entry);
    },

    async getOptional(key: string): Promise<ResourceRef<FileEntryState> | undefined> {
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

    async list(): Promise<ResourceRef<FileEntryState>[]> {
      return Array.from(store.values()).map(makeRef);
    },

    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),

    async count(): Promise<number> {
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

    // Mounted at the collection's pattern prefix (`files/*`), the same place
    // `createBashBlocks` puts it. The two entry points used to disagree about
    // the layout; the flat one was the odd one out.
    expect(customSandbox.files.get("/workspace/files/hello.txt")).toBe("Hello, world!");
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

  it("survives a flush when a mounted collection is empty", async () => {
    // Exec-backed sandboxes walk with `find <destination>/<prefix>`. A prefix
    // that hydrate never created makes `find` exit non-zero — `2>/dev/null`
    // hides the message, not the status — and the place throws rather than
    // reporting an empty workspace. Without a marker seeded up front, the
    // first successful command took its own flush down with it.
    const collection = createMockCollection([]);
    const customSandbox = createMockSandbox();
    const { tools } = await createBashTool({
      collections: { files: collection },
      provider: { type: "custom", sandbox: customSandbox },
    });

    expect(customSandbox.files.has("/workspace/files/.keep")).toBe(true);
    expect(customSandbox.files.has("/workspace/tmp/.keep")).toBe(true);

    const bashTool = tools.bash as {
      execute: (a: { command: string }) => Promise<CommandResult>;
    };
    await expect(bashTool.execute({ command: "echo hi" })).resolves.toBeDefined();
  });

  it("does not fail a command when the workspace walk fails", async () => {
    // The projection throws on an unreadable place deliberately — a flush
    // that no-ops is recoverable, one that deletes is not. That is a reason
    // to log, not a reason to fail a command that already succeeded.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const collection = createMockCollection([]);
    const customSandbox = createMockSandbox();
    const { tools } = await createBashTool({
      collections: { files: collection },
      provider: { type: "custom", sandbox: customSandbox },
    });

    customSandbox.executeCommand = async (command: string) => {
      if (command.includes("find ")) return { stdout: "", stderr: "boom", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const bashTool = tools.bash as {
      execute: (a: { command: string }) => Promise<CommandResult>;
    };
    await expect(bashTool.execute({ command: "echo hi" })).resolves.toBeDefined();
    expect(warn.mock.calls.flat().join(" ")).toContain("flush skipped");
    warn.mockRestore();
  });

  it("advertises available files at the paths they are mounted at", async () => {
    // A `files/*` collection mounts at `files/`, so `hello.txt` lives at
    // `files/hello.txt`. Advertising the bare key points the model at a path
    // that does not exist, and every read of it fails.
    const collection = createMockCollection([
      {
        name: "hello.txt",
        state: { path: "hello.txt", hash: "abc", updatedAt: "2026-01-01" },
        content: "Hello",
      },
    ]);
    const customSandbox = createMockSandbox();
    const { tools } = await createBashTool({
      collections: { files: collection },
      provider: { type: "custom", sandbox: customSandbox },
    });

    const description = (tools.bash as { description: string }).description;
    expect(description).toContain("files/hello.txt");
    expect(description).not.toMatch(/^hello\.txt$/m);
  });


  it("warns when a write is refused because another run holds the path", async () => {
    // `createBashTool` is the second entry point onto the same projection.
    // A refused write it says nothing about is a write the caller believes
    // landed — the failure mode the whole reconcile exists to remove.
    const { sharedClaimRegistry } = await import("@flow-state-dev/workspace");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherRun = Symbol("other-run");

    const collection = createMockCollection([
      {
        name: "hello.txt",
        state: { path: "hello.txt", hash: "abc", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);
    const customSandbox = createMockSandbox();
    const { tools } = await createBashTool({
      collections: { files: collection },
      provider: { type: "custom", sandbox: customSandbox },
    });

    try {
      sharedClaimRegistry.claim("files/hello.txt", otherRun);
      const writeFile = tools.writeFile as {
        execute: (a: { path: string; content: string }) => Promise<unknown>;
      };
      await writeFile.execute({ path: "files/hello.txt", content: "ours" });

      expect(await (await collection.get("hello.txt")).readContent()).toBe("original");
      const warned = warn.mock.calls.flat().join(" ");
      expect(warned).toContain("files/hello.txt");
      expect(warned).toContain("another run");
    } finally {
      sharedClaimRegistry.releaseAll(otherRun);
      warn.mockRestore();
    }
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

    it("rewrites destination-prefixed absolute paths in commands to the real cwd", async () => {
      // Regression guard: writeFile was already translating `/workspace/...`
      // to `<cwd>/...`, but executeCommand was running raw strings — so a
      // command like `cat /workspace/foo.txt` looked for the literal path on
      // the host and failed with "No such file or directory". Scripts bundled
      // with a skill (e.g. python3 /workspace/skills/.../scripts/foo.py) hit
      // this end-to-end.
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const cwd = await mkdtemp(join(tmpdir(), "bash-translate-"));
      try {
        const sandbox = createLocalFsSandbox({
          cwd,
          destination: "/workspace",
        });
        await sandbox.writeFile("/workspace/hello.txt", "hi there");
        const r1 = await sandbox.executeCommand("cat /workspace/hello.txt");
        expect(r1.stderr).toBe("");
        expect(r1.stdout).toBe("hi there");

        // Nested path — the common shape for skill-bundled scripts.
        await sandbox.writeFile("/workspace/skills/s/scripts/run.sh", "echo ok");
        const r2 = await sandbox.executeCommand(
          "bash /workspace/skills/s/scripts/run.sh",
        );
        expect(r2.stdout.trim()).toBe("ok");

        // find /workspace should list the tree instead of erroring.
        const r3 = await sandbox.executeCommand("find /workspace -type f | sort");
        expect(r3.stderr).toBe("");
        expect(r3.stdout).toContain("/hello.txt");
        expect(r3.stdout).toContain("/skills/s/scripts/run.sh");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("upstash", () => {
    it("throws when resolving (placeholder)", async () => {
      const { resolveUpstashBox } = await import("../src/bash/adapters/upstash");
      await expect(resolveUpstashBox()).rejects.toThrow("not yet implemented");
    });
  });
});

// ---------------------------------------------------------------------------
// Workspace guards — unit tests
// ---------------------------------------------------------------------------

describe("workspace guards", () => {
  const WORKSPACE = "/tmp/workspace";
  const DESTINATION = "/workspace";

  let assertCommandWithinWorkspace: typeof import("../src/bash/adapters/workspace-guards").assertCommandWithinWorkspace;
  let resolveWithinWorkspace: typeof import("../src/bash/adapters/workspace-guards").resolveWithinWorkspace;

  beforeEach(async () => {
    const guards = await import("../src/bash/adapters/workspace-guards");
    assertCommandWithinWorkspace = guards.assertCommandWithinWorkspace;
    resolveWithinWorkspace = guards.resolveWithinWorkspace;
  });

  // -------------------------------------------------------------------------
  // assertCommandWithinWorkspace
  // -------------------------------------------------------------------------

  describe("assertCommandWithinWorkspace", () => {
    describe("allowed commands", () => {
      it("allows commands with no path arguments", () => {
        expect(() => assertCommandWithinWorkspace(WORKSPACE, "ls")).not.toThrow();
        expect(() => assertCommandWithinWorkspace(WORKSPACE, "echo hello")).not.toThrow();
        expect(() => assertCommandWithinWorkspace(WORKSPACE, "pwd")).not.toThrow();
      });

      it("allows relative paths", () => {
        expect(() => assertCommandWithinWorkspace(WORKSPACE, "cat src/index.ts")).not.toThrow();
        expect(() => assertCommandWithinWorkspace(WORKSPACE, "find . -name '*.ts'")).not.toThrow();
        expect(() => assertCommandWithinWorkspace(WORKSPACE, "ls ./src")).not.toThrow();
      });

      it("allows absolute paths within workspace root", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /tmp/workspace/src/index.ts"),
        ).not.toThrow();
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "ls /tmp/workspace"),
        ).not.toThrow();
      });

      it("allows absolute paths within virtual destination", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /workspace/src/index.ts", DESTINATION),
        ).not.toThrow();
      });

      it("allows safe system paths", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "echo error 2>/dev/null"),
        ).not.toThrow();
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /dev/stdin"),
        ).not.toThrow();
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "dd if=/dev/zero of=file bs=1024 count=1"),
        ).not.toThrow();
      });
    });

    describe("rejected commands", () => {
      it("rejects absolute paths outside workspace", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /etc/passwd"),
        ).toThrow("Command rejected");
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "ls /home/user/file"),
        ).toThrow("Command rejected");
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /usr/bin/node"),
        ).toThrow("Command rejected");
      });

      it("rejects workspace root as substring in a different path", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /tmp/workspace2/file"),
        ).toThrow("Command rejected");
      });

      it("rejects path traversals", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat ../../etc/passwd"),
        ).toThrow("path traversal");
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cd ../.. && ls"),
        ).toThrow("path traversal");
      });

      it("rejects home directory references", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat ~/file"),
        ).toThrow("home directory");
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "ls ~"),
        ).toThrow("home directory");
      });

      it("rejects $HOME references", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat $HOME/file"),
        ).toThrow("$HOME");
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat ${HOME}/file"),
        ).toThrow("$HOME");
      });

      it("rejects command substitution with $()", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "echo $(cat /etc/passwd)"),
        ).toThrow("command substitution");
      });

      it("rejects backtick command substitution", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "echo `cat /etc/passwd`"),
        ).toThrow("backtick");
      });

      it("rejects process substitution", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "diff <(cat file1) file2"),
        ).toThrow("process substitution");
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "tee >(cat) file"),
        ).toThrow("process substitution");
      });
    });

    describe("error messages", () => {
      it("includes the workspace root in error messages", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /etc/passwd"),
        ).toThrow(WORKSPACE);
      });

      it("includes the offending path in absolute path errors", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat /etc/passwd"),
        ).toThrow("/etc/passwd");
      });

      it("names the offending token, not a bare slash", () => {
        const err = (() => {
          try {
            assertCommandWithinWorkspace(WORKSPACE, "cat /etc/passwd");
            return "";
          } catch (e) {
            return (e as Error).message;
          }
        })();
        expect(err).toContain('"/etc/passwd"');
      });
    });

    describe("inline code with slashes", () => {
      it("allows python3 -c with arithmetic division", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'python3 -c "x = 1 / 2; print(x)"'),
        ).not.toThrow();
      });

      it("allows node -e with arithmetic division", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'node -e "let y = 1/2"'),
        ).not.toThrow();
      });

      it("allows node -e with regex literals", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'node -e "/foo/.test(x)"'),
        ).not.toThrow();
      });

      it("allows bash -c with inline pipeline", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'bash -c "echo a/b | tr / _"'),
        ).not.toThrow();
      });
    });

    describe("quoted strings and URLs", () => {
      it("allows curl with quoted https URL", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'curl "https://api.example.com/foo"'),
        ).not.toThrow();
      });

      it("allows wget with quoted https URL", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'wget "https://example.com/path/to/file"'),
        ).not.toThrow();
      });

      it("allows echo of quoted slash-containing literal", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'echo "a/b/c"'),
        ).not.toThrow();
      });

      it("allows grep with quoted pattern containing slash", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'grep "foo/bar" file.txt'),
        ).not.toThrow();
      });

      it("allows single-quoted absolute-path literal (documented trade-off)", () => {
        // The unquoted form is still rejected; quoting (single or double)
        // bypasses path validation by design.
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat '/etc/passwd'"),
        ).not.toThrow();
      });
    });

    describe("heredocs", () => {
      it("allows heredoc whose body contains slashes", () => {
        const cmd =
          "cd /tmp/workspace && python3 << 'EOF'\nx = 1 / 2\nprint(x)\nEOF\n";
        expect(() => assertCommandWithinWorkspace(WORKSPACE, cmd)).not.toThrow();
      });

      it("allows heredoc whose body looks like an absolute path", () => {
        const cmd = "cat << EOF\n/etc/passwd\nEOF\n";
        expect(() => assertCommandWithinWorkspace(WORKSPACE, cmd)).not.toThrow();
      });

      it("allows tab-indented heredoc (<<-)", () => {
        const cmd = "cat <<-EOF\n\t/etc/passwd\n\tEOF\n";
        expect(() => assertCommandWithinWorkspace(WORKSPACE, cmd)).not.toThrow();
      });

      it("still rejects an absolute path outside a heredoc", () => {
        const cmd = "cat /etc/passwd << 'EOF'\nbody\nEOF\n";
        expect(() => assertCommandWithinWorkspace(WORKSPACE, cmd)).toThrow(
          "Command rejected",
        );
      });
    });

    describe("malformed input fallback", () => {
      it("still rejects /etc/passwd inside an unclosed quote", () => {
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, 'cat "/etc/passwd'),
        ).toThrow("Command rejected");
      });
    });

    describe("variable expansion safety", () => {
      it("does not produce a stray slash token when expanding $VAR/x", () => {
        // `cat $FOO/x` must not be misread as accessing `/x` after expansion.
        expect(() =>
          assertCommandWithinWorkspace(WORKSPACE, "cat $FOO/x"),
        ).not.toThrow();
      });
    });
  });

  // -------------------------------------------------------------------------
  // resolveWithinWorkspace
  // -------------------------------------------------------------------------

  describe("resolveWithinWorkspace", () => {
    describe("allowed paths", () => {
      it("resolves bare relative paths", () => {
        const result = resolveWithinWorkspace(WORKSPACE, "src/index.ts");
        expect(result).toBe("/tmp/workspace/src/index.ts");
      });

      it("resolves dot-relative paths", () => {
        const result = resolveWithinWorkspace(WORKSPACE, "./src/index.ts");
        expect(result).toBe("/tmp/workspace/src/index.ts");
      });

      it("resolves deeply nested paths", () => {
        const result = resolveWithinWorkspace(WORKSPACE, "a/b/c/d/file.ts");
        expect(result).toBe("/tmp/workspace/a/b/c/d/file.ts");
      });

      it("resolves the workspace root itself", () => {
        const result = resolveWithinWorkspace(WORKSPACE, ".");
        expect(result).toBe("/tmp/workspace");
      });
    });

    describe("rejected paths", () => {
      it("rejects absolute paths outside workspace", () => {
        expect(() => resolveWithinWorkspace(WORKSPACE, "/etc/passwd")).toThrow(
          "resolves outside the workspace root",
        );
      });

      it("rejects traversals that escape", () => {
        expect(() =>
          resolveWithinWorkspace(WORKSPACE, "../../../etc/passwd"),
        ).toThrow("resolves outside the workspace root");
      });

      it("rejects paths that start valid then escape", () => {
        expect(() =>
          resolveWithinWorkspace(WORKSPACE, "src/../../etc/passwd"),
        ).toThrow("resolves outside the workspace root");
      });

      it("rejects filesystem root", () => {
        expect(() => resolveWithinWorkspace(WORKSPACE, "/")).toThrow(
          "resolves outside the workspace root",
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // strictPaths config toggle
  // -------------------------------------------------------------------------

  describe("strictPaths config", () => {
    it("rejects dangerous commands when strictPaths is true (default)", async () => {
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const sandbox = createLocalFsSandbox({ cwd: "/tmp/strict-test" });

      await expect(sandbox.executeCommand("cat /etc/passwd")).rejects.toThrow(
        "Command rejected",
      );
    });

    it("rejects paths outside workspace for readFile when strictPaths is true", async () => {
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const sandbox = createLocalFsSandbox({ cwd: "/tmp/strict-test" });

      await expect(sandbox.readFile("/etc/passwd")).rejects.toThrow(
        "resolves outside the workspace root",
      );
    });

    it("rejects paths outside workspace for writeFile when strictPaths is true", async () => {
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const sandbox = createLocalFsSandbox({ cwd: "/tmp/strict-test" });

      await expect(sandbox.writeFile("/etc/evil", "bad")).rejects.toThrow(
        "resolves outside the workspace root",
      );
    });

    it("skips guards when strictPaths is false", async () => {
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const sandbox = createLocalFsSandbox({
        cwd: "/tmp/nostrict-test",
        strictPaths: false,
      });

      // The warning should have been emitted at creation time
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("strictPaths is disabled"),
      );

      // Command with external path should not throw (guard skipped).
      // It may still fail due to missing directories, but it won't throw
      // the guard error.
      try {
        await sandbox.executeCommand("echo ok");
      } catch {
        // exec may fail if cwd doesn't exist — that's fine, the point is
        // the guard didn't throw
      }

      warnSpy.mockRestore();
    });

    it("emits a warning when strictPaths is false", async () => {
      const { createLocalFsSandbox } = await import("../src/bash/adapters/local-fs");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      createLocalFsSandbox({
        cwd: "/tmp/warn-test",
        strictPaths: false,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/warn-test"),
      );

      warnSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// createBashBlocks — auto-discovery, multi-mount flush, scratch, orphans
// ---------------------------------------------------------------------------
//
// The block-level tests construct a BlockContext-shaped object, a flush-aware
// mock sandbox (see helper below), and one or more mock collections. Each
// test uses a unique session id so the module-scoped sandbox registry
// doesn't carry state between tests.

describe("createBashBlocks", () => {
  // Real `find .` from inside a workspace emits `./relative/path`. The
  // shared `createMockSandbox` returns absolute keys, which the flush path
  // does not strip — we need `./`-relative output for flush assertions.
  function createFlushAwareSandbox(
    destination: string,
  ): Sandbox & { files: Map<string, string> } {
    const files = new Map<string, string>();
    const destPrefix = destination.endsWith("/") ? destination : destination + "/";
    return {
      files,
      async executeCommand(command: string): Promise<CommandResult> {
        if (command.startsWith("find ")) {
          // Mirror real `find` output: when invoked with absolute path
          // arguments, find emits absolute paths (the framework's
          // walkMountsViaExec passes absolute paths anchored at the
          // destination). The mock holds files keyed by absolute path.
          const out: string[] = [];
          for (const key of files.keys()) {
            if (!key.startsWith(destPrefix)) continue;
            out.push(key);
          }
          return { stdout: out.join("\n"), stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      async readFile(p: string): Promise<string> {
        const content = files.get(p);
        if (content === undefined) throw new Error(`File not found: ${p}`);
        return content;
      },
      async writeFile(p: string, content: string): Promise<void> {
        files.set(p, content);
      },
    };
  }

  // Build a BlockContext-shaped object with arbitrary collections.
  //
  // The `scopes` parameter is preserved as a convenience — callers can still
  // describe which logical scope a collection "comes from" — but at runtime
  // they're all flattened into the unified `ctx.resources` registry. The
  // collection's intrinsic `scope` (set on `defineResourceCollection`) is
  // what routes reads/writes to the right storage layer.
  function buildCtx(
    sessionId: string,
    scopes: {
      session?: Record<string, ResourceCollectionRef<FileEntryState>>;
      user?: Record<string, ResourceCollectionRef<FileEntryState>>;
      org?: Record<string, ResourceCollectionRef<FileEntryState>>;
    } = {},
  ) {
    const resources: Record<string, ResourceCollectionRef<FileEntryState>> = {
      ...(scopes.session ?? {}),
      ...(scopes.user ?? {}),
      ...(scopes.org ?? {}),
    };
    return {
      // A `request` is not optional on a block context, and every fixture here
      // is cast `as any` — so an omission does not fail `tsc`, it fails at run
      // time inside whichever helper reads it first. Named per call so a
      // scope that keys on the request gets distinct keys.
      request: {
        identity: { id: `req-${sessionId}` },
      },
      session: {
        identity: { id: sessionId, userId: "u1" },
      },
      user: {
        identity: { id: "u1" },
      },
      org: {
        identity: { id: "p1" },
      },
      resources,
    } as any;
  }

  // Collection mock with a custom pattern (not the default `files/*`).
  function createMockCollectionWithPattern(
    pattern: string,
    entries: MockResourceEntry[] = [],
  ): ResourceCollectionRef<FileEntryState> {
    const base = createMockCollection(entries);
    return { ...base, pattern } as ResourceCollectionRef<FileEntryState>;
  }

  it("auto-discovers every collection on ctx and mounts each at its pattern prefix", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "artifacts/notes.md",
        state: { path: "artifacts/notes.md", hash: "", updatedAt: "2026-01-01" },
        content: "existing note",
      },
    ]);
    const skills = createMockCollectionWithPattern("skills/**", [
      {
        name: "skills/check-news/SKILL.md",
        state: { path: "skills/check-news/SKILL.md", hash: "", updatedAt: "2026-01-01" },
        content: "body",
      },
    ]);

    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });

    const ctx = buildCtx("auto-1", { session: { artifacts }, org: { skills } });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(sandbox.files.get("/workspace/artifacts/notes.md")).toBe("existing note");
    expect(sandbox.files.get("/workspace/skills/check-news/SKILL.md")).toBe("body");
    // Scratch directory marker is seeded.
    expect(sandbox.files.has("/workspace/tmp/.keep")).toBe(true);
  });

  it("wraps bashCommand with `cd <destination> &&` so PWD is the workspace root", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    // The agent should be able to use relative paths (`artifacts/foo.md`)
    // without knowing the workspace lives at `/workspace`. This test
    // captures the actual command string sent to the sandbox and
    // asserts the wrapper.
    const captured: string[] = [];
    const files = new Map<string, string>();
    const sandbox: Sandbox = {
      async executeCommand(command: string): Promise<CommandResult> {
        captured.push(command);
        if (command.includes("find ")) {
          return {
            stdout: Array.from(files.keys()).join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      async readFile(p: string): Promise<string> {
        return files.get(p) ?? "";
      },
      async writeFile(p: string, content: string): Promise<void> {
        files.set(p, content);
      },
    };

    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("cd-wrap-1", { session: { artifacts } });
    await runForTest(bashCommand, { command: "echo hello > note.txt" }, ctx);

    // The agent's command is wrapped with the cd; the flush walk
    // (which runs after) is the only command without the wrap.
    const agentCmd = captured.find((c) => c.includes("echo hello"));
    expect(agentCmd).toBeDefined();
    expect(agentCmd).toContain("cd /workspace && echo hello > note.txt");
  });

  it("routes writes back to the owning collection by longest-prefix match", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const skills = createMockCollectionWithPattern("skills/**");
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand, bashWriteFile } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });

    const ctx = buildCtx("flush-route-1", {
      session: { artifacts },
      org: { skills },
    });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    await runForTest(bashWriteFile, { path: "artifacts/new-doc.md", content: "artifact content" }, ctx);
    await runForTest(bashWriteFile, { path: "skills/draft/SKILL.md", content: "skill content" }, ctx);

    expect(await artifacts.count()).toBe(1);
    expect(await skills.count()).toBe(1);
    expect((await artifacts.getOptional("new-doc.md"))?.state.path).toBe("new-doc.md");
    expect(await skills.getOptional("draft/SKILL.md")).toBeDefined();
  });

  it("normalizes leading `./` so model-supplied relative paths route correctly", async () => {
    // The bashWriteFile schema describes paths as "relative to workspace
    // root (e.g. artifacts/foo.md)" — the model still routinely supplies
    // `./artifacts/foo.md`. Routing must strip the `./` before matching
    // mount prefixes, otherwise the file lands on disk but is silently
    // dropped from the collection sync.
    const { createBashBlocks } = await import("../src/bash/blocks");
    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand, bashWriteFile } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("dotslash-1", { session: { artifacts } });
    await runForTest(bashCommand, { command: "ls" }, ctx);
    await runForTest(bashWriteFile, { path: "./artifacts/relative.md", content: "hi" }, ctx);

    expect(await artifacts.count()).toBe(1);
    expect(await artifacts.getOptional("relative.md")).toBeDefined();
  });

  it("honors writable: false — changes in the mount are not written back", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const skills = createMockCollectionWithPattern("skills/**", [
      {
        name: "foo/SKILL.md",
        state: { path: "foo/SKILL.md", hash: "", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand, bashWriteFile } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
      collections: [{ key: "skills", writable: false }],
    });

    const ctx = buildCtx("ro-1", { org: { skills } });
    await runForTest(bashCommand, { command: "ls" }, ctx);
    await runForTest(bashWriteFile, 
      { path: "skills/foo/SKILL.md", content: "EDITED" },
      ctx,
    );

    // Local edit visible in sandbox.
    expect(sandbox.files.get("/workspace/skills/foo/SKILL.md")).toBe("EDITED");
    // But the resource stays untouched.
    expect(await skills.getOptional("foo/SKILL.md")).toBeDefined();
    expect(await (await skills.getOptional("foo/SKILL.md"))!.readContent()).toBe("original");
  });

  it("drops orphan files with a console warning (not under any mount or ./tmp/)", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand, bashWriteFile } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });

    const ctx = buildCtx("orphan-1", { session: { artifacts } });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await runForTest(bashWriteFile, { path: "random.txt", content: "uh oh" }, ctx);
      // Orphan write stays in the sandbox for this session but is never
      // persisted to any collection.
      expect(sandbox.files.get("/workspace/random.txt")).toBe("uh oh");
      expect(await artifacts.count()).toBe(0);
      // console.warn announces the drop.
      expect(warn).toHaveBeenCalled();
      const msg = warn.mock.calls.map((c) => c[0]).join(" ");
      expect(msg).toMatch(/orphan/);
      expect(msg).toMatch(/random\.txt/);
    } finally {
      warn.mockRestore();
    }
  });

  it("does NOT drop or warn on files under ./tmp/ — scratch is silent", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand, bashWriteFile } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });

    const ctx = buildCtx("scratch-1", { session: { artifacts } });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await runForTest(bashWriteFile, { path: "tmp/scratchpad.txt", content: "abc" }, ctx);
      await runForTest(bashWriteFile, { path: "tmp/nested/file.txt", content: "xyz" }, ctx);
      expect(sandbox.files.get("/workspace/tmp/scratchpad.txt")).toBe("abc");
      expect(sandbox.files.get("/workspace/tmp/nested/file.txt")).toBe("xyz");
      expect(await artifacts.count()).toBe(0);
      // No warn for files under tmp/.
      const orphanCalls = warn.mock.calls.filter((c) =>
        (c[0] as string).includes("orphan"),
      );
      expect(orphanCalls).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("explicit `collections` narrows the mount set", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "artifacts/foo.md",
        state: { path: "artifacts/foo.md", hash: "", updatedAt: "2026-01-01" },
        content: "a",
      },
    ]);
    const skills = createMockCollectionWithPattern("skills/**", [
      {
        name: "skills/bar/SKILL.md",
        state: { path: "skills/bar/SKILL.md", hash: "", updatedAt: "2026-01-01" },
        content: "b",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
      collections: ["artifacts"],
    });

    const ctx = buildCtx("narrow-1", {
      session: { artifacts },
      org: { skills },
    });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(sandbox.files.get("/workspace/artifacts/foo.md")).toBe("a");
    // Skills collection is NOT mounted despite being on ctx.
    expect(sandbox.files.has("/workspace/skills/bar/SKILL.md")).toBe(false);
  });

  it("`exclude` skips named collections during auto-discovery", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "artifacts/foo.md",
        state: { path: "artifacts/foo.md", hash: "", updatedAt: "2026-01-01" },
        content: "a",
      },
    ]);
    const secrets = createMockCollectionWithPattern("secrets/**", [
      {
        name: "secrets/api-key.txt",
        state: { path: "secrets/api-key.txt", hash: "", updatedAt: "2026-01-01" },
        content: "sk-...",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
      exclude: ["secrets"],
    });

    const ctx = buildCtx("exclude-1", {
      session: { artifacts, secrets },
    });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(sandbox.files.get("/workspace/artifacts/foo.md")).toBe("a");
    expect(sandbox.files.has("/workspace/secrets/api-key.txt")).toBe(false);
  });

  it("per-mount deletion only removes entries from the owning collection", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "keep.md",
        state: { path: "keep.md", hash: "", updatedAt: "2026-01-01" },
        content: "keep",
      },
      {
        name: "drop.md",
        state: { path: "drop.md", hash: "", updatedAt: "2026-01-01" },
        content: "drop",
      },
    ]);
    const skills = createMockCollectionWithPattern("skills/**", [
      {
        name: "stay/SKILL.md",
        state: { path: "stay/SKILL.md", hash: "", updatedAt: "2026-01-01" },
        content: "stay",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });

    const ctx = buildCtx("delete-1", {
      session: { artifacts },
      org: { skills },
    });
    await runForTest(bashCommand, { command: "ls" }, ctx);

    // Simulate the agent deleting an artifact via the sandbox directly.
    sandbox.files.delete("/workspace/artifacts/drop.md");
    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(await artifacts.getOptional("keep.md")).toBeDefined();
    expect(await artifacts.getOptional("drop.md")).toBeUndefined();
    // Skills collection is untouched — its delete loop runs against its own
    // list and the file we deleted wasn't one of its entries.
    expect(await skills.getOptional("stay/SKILL.md")).toBeDefined();
  });

  // -------------------------------------------------------------------
  // FIX-998's three measured reproductions.
  //
  // Each is a way the old reconcile destroyed evidence it did not hold.
  // They live here rather than only in the projection's own suite because
  // this is where the bug was, and a future reconcile written back into
  // this file has to fail them.
  // -------------------------------------------------------------------

  it("delete-by-absence: a file another writer added mid-run survives the flush", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "mine.md",
        state: { path: "mine.md", hash: "", updatedAt: "2026-01-01" },
        content: "mine",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("fix998-delete-by-absence", { session: { artifacts } });

    await runForTest(bashCommand, { command: "ls" }, ctx);

    // Another run creates a file in the same collection. It never reaches
    // this workspace, so this run's walk cannot see it.
    const theirs = await artifacts.getOrCreate("theirs.md", {
      path: "theirs.md",
      hash: "",
      updatedAt: "2026-01-02",
    });
    await theirs.writeContent("theirs");

    await runForTest(bashCommand, { command: "ls" }, ctx);

    // Absent from our workspace is not the same as deleted by us.
    expect(await artifacts.getOptional("theirs.md")).toBeDefined();
    expect(await artifacts.getOptional("mine.md")).toBeDefined();
  });

  it("lost update: a file changed in its collection mid-run is not overwritten", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "shared.md",
        state: { path: "shared.md", hash: "", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("fix998-lost-update", { session: { artifacts } });

    await runForTest(bashCommand, { command: "ls" }, ctx);

    // Both writers move, neither having seen the other.
    await (await artifacts.get("shared.md")).writeContent("theirs");
    sandbox.files.set("/workspace/artifacts/shared.md", "ours");

    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(await (await artifacts.get("shared.md")).readContent()).toBe("theirs");
    expect(warn.mock.calls.flat().join(" ")).toContain("artifacts/shared.md");
    warn.mockRestore();
  });

  it("edit-vs-delete: removing a file somebody else edited deletes nothing", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "contested.md",
        state: { path: "contested.md", hash: "", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("fix998-edit-vs-delete", { session: { artifacts } });

    await runForTest(bashCommand, { command: "ls" }, ctx);

    // We remove it; somebody else edits it. A delete is a write, and needs
    // the same evidence — the half a first fix is recorded missing.
    sandbox.files.delete("/workspace/artifacts/contested.md");
    await (await artifacts.get("contested.md")).writeContent("their edit");

    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(await artifacts.getOptional("contested.md")).toBeDefined();
    expect(await (await artifacts.get("contested.md")).readContent()).toBe("their edit");
    expect(warn.mock.calls.flat().join(" ")).toContain("contested.md");
    warn.mockRestore();
  });
  it("cold write-file updates a file the collection already holds", async () => {
    // The bind-mount fast path builds its projection when no sandbox is live.
    // With no baseline it cannot tell a file it is creating from one somebody
    // else wrote, so a path the collection already has comes back a conflict
    // and the write is refused — while the host file takes the edit anyway.
    // The two then disagree, and the next hydrate erases the run's work.
    const { createBashBlocks } = await import("../src/bash/blocks");
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const nodePath = await import("node:path");

    const workspace = await mkdtemp(nodePath.join(os.tmpdir(), "cold-write-"));
    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "notes.md",
        state: { path: "notes.md", hash: "", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);

    const { bashWriteFile } = createBashBlocks({
      provider: { type: "moat", workspace },
      destination: "/workspace",
    });
    const ctx = buildCtx("cold-write-1", { session: { artifacts } });

    await runForTest(bashWriteFile, { path: "artifacts/notes.md", content: "edited" }, ctx);

    // The host file took the edit either way — that is not in question.
    expect(await readFile(nodePath.join(workspace, "artifacts/notes.md"), "utf-8")).toBe("edited");
    // THE discriminating assertion: so did the collection.
    expect(await (await artifacts.get("notes.md")).readContent()).toBe("edited");
  });


  it("refuses a write to a path another run is holding, and names it", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");
    const { sharedClaimRegistry } = await import("@flow-state-dev/workspace");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherRun = Symbol("other-run");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "shared.md",
        state: { path: "shared.md", hash: "", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("claim-refused", { session: { artifacts } });

    try {
      await runForTest(bashCommand, { command: "ls" }, ctx);

      // Our run edits the file, and the other run takes the path first.
      sandbox.files.set("/workspace/artifacts/shared.md", "ours");
      sharedClaimRegistry.claim("artifacts/shared.md", otherRun);

      await runForTest(bashCommand, { command: "ls" }, ctx);

      // Not overwritten — and the warning names the path, because the fix for
      // a contested path is to stop two runs sharing it.
      expect(await (await artifacts.get("shared.md")).readContent()).toBe("original");
      const warned = warn.mock.calls.flat().join(" ");
      expect(warned).toContain("artifacts/shared.md");
      expect(warned).toContain("another run");
    } finally {
      sharedClaimRegistry.releaseAll(otherRun);
      warn.mockRestore();
    }
  });

  it("does not contend over a path the other run is not holding", async () => {
    // The case the claim has to keep working, not the one it exists to stop:
    // two runs sharing a collection but touching different files. A claim per
    // collection would fail this, which is why it is per path.
    const { createBashBlocks } = await import("../src/bash/blocks");
    const { sharedClaimRegistry } = await import("@flow-state-dev/workspace");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherRun = Symbol("other-run");

    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand, bashWriteFile } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("claim-disjoint", { session: { artifacts } });

    try {
      await runForTest(bashCommand, { command: "ls" }, ctx);
      sharedClaimRegistry.claim("artifacts/theirs.md", otherRun);

      await runForTest(bashWriteFile, { path: "artifacts/ours.md", content: "ours" }, ctx);
      sandbox.files.set("/workspace/artifacts/also-ours.md", "also ours");
      await runForTest(bashCommand, { command: "ls" }, ctx);

      expect(await (await artifacts.get("ours.md")).readContent()).toBe("ours");
      expect(await (await artifacts.get("also-ours.md")).readContent()).toBe("also ours");
      expect(warn.mock.calls.flat().join(" ")).not.toContain("another run");
    } finally {
      sharedClaimRegistry.releaseAll(otherRun);
      warn.mockRestore();
    }
  });

  it("writes the path again once the other run has released it", async () => {
    // A claim that outlived its flush would refuse every later run for a path
    // nobody is writing any more. The release is what keeps this tool working
    // exactly as it did before claims existed whenever no run overlaps.
    const { createBashBlocks } = await import("../src/bash/blocks");
    const { sharedClaimRegistry } = await import("@flow-state-dev/workspace");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherRun = Symbol("other-run");

    const artifacts = createMockCollectionWithPattern("artifacts/**", [
      {
        name: "shared.md",
        state: { path: "shared.md", hash: "", updatedAt: "2026-01-01" },
        content: "original",
      },
    ]);
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("claim-released", { session: { artifacts } });

    try {
      await runForTest(bashCommand, { command: "ls" }, ctx);
      sandbox.files.set("/workspace/artifacts/shared.md", "ours");
      sharedClaimRegistry.claim("artifacts/shared.md", otherRun);
      await runForTest(bashCommand, { command: "ls" }, ctx);
      expect(await (await artifacts.get("shared.md")).readContent()).toBe("original");

      sharedClaimRegistry.releaseAll(otherRun);
      await runForTest(bashCommand, { command: "ls" }, ctx);

      expect(await (await artifacts.get("shared.md")).readContent()).toBe("ours");
      expect(sharedClaimRegistry.heldBy("artifacts/shared.md")).toBeUndefined();
    } finally {
      sharedClaimRegistry.releaseAll(otherRun);
      warn.mockRestore();
    }
  });

  it("says nothing when a flush over an empty workspace finds nothing", async () => {
    // The "0 files under writable mounts" warning exists to catch writes that
    // landed where the walk never looks. An empty workspace is not that: it is
    // the ordinary state of a session whose agent has not written yet, and a
    // warning on every command in that state is a warning nobody reads.
    const { createBashBlocks } = await import("../src/bash/blocks");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const artifacts = createMockCollectionWithPattern("artifacts/**");
    const sandbox = createFlushAwareSandbox("/workspace");
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx = buildCtx("empty-flush", { session: { artifacts } });

    await runForTest(bashCommand, { command: "ls" }, ctx);

    expect(warn.mock.calls.flat().join(" ")).not.toContain("0 files under writable mounts");
    warn.mockRestore();
  });
});
