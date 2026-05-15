/**
 * Tests for the MOAT sandbox adapter and the bash capability lifecycle
 * pieces it depends on (registry concurrency fix + cleanupBlock).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRunArgs,
  buildExecArgs,
  buildWriteFileArgs,
  generateMoatYaml,
  satisfiesMinVersion,
  resolveMoatSandbox,
  createMoatAdapter,
  MoatNotInstalledError,
  MoatVersionError,
  MoatGrantsError,
  MoatRunStoppedError,
  MoatBinaryReadError,
  type SpawnFn as MoatSpawnFn,
  type SpawnResult as MoatSpawnResult,
} from "../src/bash/adapters/moat";
import { createBashBlocks, releaseBashSandbox } from "../src/bash/blocks";
import { createBashCapability } from "../src/bash/capability";
import type { Sandbox, SandboxProvider } from "../src/bash/types";
import { runForTest } from "@flow-state-dev/testing";

// ---------------------------------------------------------------------------
// Builders (pure, no I/O)
// ---------------------------------------------------------------------------

describe("moat builders", () => {
  it("buildRunArgs: minimal", () => {
    expect(
      buildRunArgs({
        runName: "fsdev-x",
        workspace: "/tmp/ws",
        mountTarget: "/workspace",
      }),
    ).toEqual([
      "run",
      "-n",
      "fsdev-x",
      "-m",
      "/tmp/ws:/workspace",
      "/tmp/ws",
      "--",
      "sleep",
      "infinity",
    ]);
  });

  it("buildRunArgs: full", () => {
    expect(
      buildRunArgs({
        runName: "fsdev-x",
        workspace: "/ws",
        mountTarget: "/workspace",
        runtime: "docker",
        grants: ["github", "openai"],
        allowHosts: ["api.github.com", "api.openai.com"],
        noSandbox: true,
      }),
    ).toEqual([
      "run",
      "-n",
      "fsdev-x",
      "--runtime",
      "docker",
      "-m",
      "/ws:/workspace",
      "-g",
      "github",
      "-g",
      "openai",
      "--allow-host",
      "api.github.com",
      "--allow-host",
      "api.openai.com",
      "--no-sandbox",
      "/ws",
      "--",
      "sleep",
      "infinity",
    ]);
  });

  it("buildExecArgs: wraps in sh -c", () => {
    expect(buildExecArgs("r1", "echo hi && ls")).toEqual([
      "exec",
      "r1",
      "--",
      "sh",
      "-c",
      "echo hi && ls",
    ]);
  });

  it("buildWriteFileArgs: passes path positionally so quoting is irrelevant", () => {
    const args = buildWriteFileArgs("r1", "/workspace/odd path/$x;rm.txt");
    expect(args).toEqual([
      "exec",
      "r1",
      "--",
      "sh",
      "-c",
      'mkdir -p "$(dirname "$1")" && cat > "$1"',
      "--",
      "/workspace/odd path/$x;rm.txt",
    ]);
  });

  it("generateMoatYaml: default-deny network when no allowHosts", () => {
    const yaml = generateMoatYaml({ name: "r1", grants: ["github"] });
    expect(yaml).toContain('name: "r1"');
    expect(yaml).toContain("grants:");
    expect(yaml).toContain('- "github"');
    expect(yaml).toContain('policy: "strict"');
    expect(yaml).toContain("allow:");
    // No host lines after `allow:` when allowHosts is empty.
    expect(yaml).not.toMatch(/allow:[\s\S]*-\s/);
  });

  it("generateMoatYaml: allowHosts produce list entries", () => {
    const yaml = generateMoatYaml({
      name: "r1",
      allowHosts: ["api.github.com", "registry.npmjs.org"],
    });
    expect(yaml).toContain('- "api.github.com"');
    expect(yaml).toContain('- "registry.npmjs.org"');
  });

  it("generateMoatYaml: quotes caller-supplied values to block YAML injection", () => {
    const yaml = generateMoatYaml({
      name: "r1",
      grants: ["github\ngrants:\n  - evil_grant"],
      allowHosts: ['"api.github.com"'],
    });
    // The injected payload must be inside a quoted scalar — no extra
    // top-level `grants:` key reaching the document tree.
    const grantsKeyMatches = yaml.match(/^grants:/gm) ?? [];
    expect(grantsKeyMatches).toHaveLength(1);
    // Embedded double-quotes must be escaped, not closing the string.
    expect(yaml).toContain('- "\\"api.github.com\\""');
  });

  it("satisfiesMinVersion: accepts equal and higher", () => {
    expect(satisfiesMinVersion("0.4.0", ">=0.4.0")).toBe(true);
    expect(satisfiesMinVersion("0.4.1", ">=0.4.0")).toBe(true);
    expect(satisfiesMinVersion("1.0.0", ">=0.4.0")).toBe(true);
    expect(satisfiesMinVersion("v0.4.0", ">=0.4.0")).toBe(true);
    expect(satisfiesMinVersion("0.4.0-alpha.1", ">=0.4.0")).toBe(true);
  });

  it("satisfiesMinVersion: rejects lower", () => {
    expect(satisfiesMinVersion("0.3.0", ">=0.4.0")).toBe(false);
    expect(satisfiesMinVersion("0.3.99", ">=0.4.0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spawn helper for tests
// ---------------------------------------------------------------------------

function ok(stdout = "", stderr = ""): MoatSpawnResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr,
    stdoutBytes: Buffer.from(stdout, "utf-8"),
    timedOut: false,
  };
}

function fail(exitCode: number, stderr = ""): MoatSpawnResult {
  return {
    exitCode,
    signal: null,
    stdout: "",
    stderr,
    stdoutBytes: Buffer.alloc(0),
    timedOut: false,
  };
}

interface SpawnCall {
  args: string[];
  stdin?: string;
}

function makeSpawnFn(handler: (call: SpawnCall) => MoatSpawnResult | Promise<MoatSpawnResult>): {
  spawnFn: MoatSpawnFn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawnFn: MoatSpawnFn = async (_command, args, opts) => {
    const call = { args, stdin: opts.stdin };
    calls.push(call);
    return handler(call);
  };
  return { spawnFn, calls };
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

describe("resolveMoatSandbox preflight", () => {
  it("MoatNotInstalledError when binary missing", async () => {
    const spawnFn: MoatSpawnFn = async () => {
      const err: NodeJS.ErrnoException = Object.assign(new Error("ENOENT"), {
        code: "ENOENT",
      });
      throw err;
    };
    await expect(
      resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        spawnFn,
      }),
    ).rejects.toBeInstanceOf(MoatNotInstalledError);
  });

  it("MoatVersionError when below floor", async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(JSON.stringify({ version: "0.3.5" }));
      return ok();
    });
    await expect(
      resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        spawnFn,
      }),
    ).rejects.toBeInstanceOf(MoatVersionError);
  });

  it("accepts MOAT 0.5.x human-readable `version` output (ignores --json)", async () => {
    // MOAT 0.5.x advertises a global --json flag but `version` ignores it and
    // emits a human block. The adapter must fall back to scraping the first
    // line; we prove the parse succeeded by letting the resolver advance to
    // `verifyGrants` and reject with MoatGrantsError instead of MoatError.
    const humanOutput =
      "moat 0.5.1\n" +
      "  commit: fc0596858df7275a341e3ca195860cd773c4e564\n" +
      "  built:  2026-04-28T22:14:27Z\n" +
      "  go:     go1.25.5\n";
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(humanOutput);
      if (args[0] === "grant") return ok(JSON.stringify([]));
      return ok();
    });
    await expect(
      resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        grants: ["openai"],
        spawnFn,
      }),
    ).rejects.toBeInstanceOf(MoatGrantsError);
  });

  it("MoatGrantsError when a required grant is missing", async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(JSON.stringify({ version: "0.4.0" }));
      if (args[0] === "grant") return ok(JSON.stringify([{ provider: "openai" }]));
      return ok();
    });
    await expect(
      resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        grants: ["github", "openai"],
        spawnFn,
      }),
    ).rejects.toBeInstanceOf(MoatGrantsError);
  });

  it("reconnects to an existing run reported with PascalCase Name/State (MOAT 0.5.x)", async () => {
    // MOAT 0.5.x emits `Name`/`State` (Go default JSON marshaling).
    // The reconnect path requires the parser to read both casings,
    // otherwise we always try to start a new run with the same name
    // and the daemon rejects the second spawn.
    const { spawnFn, calls } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(JSON.stringify({ version: "0.5.1" }));
      if (args[0] === "grant") return ok(JSON.stringify([]));
      if (args[0] === "list") {
        return ok(JSON.stringify([{ Name: "r1", State: "running" }]));
      }
      return ok();
    });
    // Workspace points at an empty tempdir so the resolver's "no
    // hand-authored moat.yaml" branch generates a transient one — keeps
    // this preflight test independent of whatever moat.yaml happens to
    // exist in the test CWD.
    const tmpWorkspace = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-test-"));
    try {
      await resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        workspace: tmpWorkspace,
        spawnFn,
      });
      // No `moat run` invocation — we found the live run via list and reused it.
      expect(calls.find((c) => c.args[0] === "run")).toBeUndefined();
    } finally {
      await rm(tmpWorkspace, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Adapter Sandbox methods
// ---------------------------------------------------------------------------

describe("createMoatAdapter", () => {
  function adapter(spawnFn: MoatSpawnFn) {
    return createMoatAdapter({
      runName: "r1",
      bin: "moat",
      execTimeoutMs: 1000,
      spawnFn,
      stopped: false,
    });
  }

  it("executeCommand: returns spawn result on success", async () => {
    const { spawnFn, calls } = makeSpawnFn(() => ok("hello\n"));
    const sb = adapter(spawnFn);
    expect(await sb.executeCommand("echo hello")).toEqual({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });
    expect(calls[0]!.args).toEqual(["exec", "r1", "--", "sh", "-c", "echo hello"]);
  });

  it("executeCommand: surfaces non-zero exit codes", async () => {
    const { spawnFn } = makeSpawnFn(() => fail(2, "boom"));
    const sb = adapter(spawnFn);
    expect(await sb.executeCommand("false")).toEqual({
      stdout: "",
      stderr: "boom",
      exitCode: 2,
    });
  });

  it("executeCommand: returns 124 with annotated stderr on timeout", async () => {
    const { spawnFn } = makeSpawnFn(() => ({
      exitCode: null,
      signal: "SIGKILL",
      stdout: "partial",
      stderr: "before",
      stdoutBytes: Buffer.from("partial"),
      timedOut: true,
    }));
    const sb = adapter(spawnFn);
    const result = await sb.executeCommand("sleep 99");
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe("partial");
    expect(result.stderr).toContain("before");
    expect(result.stderr).toContain("exec timed out after 1000ms");
  });

  it("readFile: returns UTF-8 content", async () => {
    const { spawnFn } = makeSpawnFn(() => ok("hello world"));
    const sb = adapter(spawnFn);
    expect(await sb.readFile("/workspace/x.txt")).toBe("hello world");
  });

  it("readFile: throws MoatBinaryReadError on non-UTF-8", async () => {
    const { spawnFn } = makeSpawnFn(() => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutBytes: Buffer.from([0xff, 0xfe, 0xfd]),
      timedOut: false,
    }));
    const sb = adapter(spawnFn);
    await expect(sb.readFile("/workspace/blob.bin")).rejects.toBeInstanceOf(MoatBinaryReadError);
  });

  it("writeFile: pipes content via stdin and uses positional arg for path", async () => {
    const { spawnFn, calls } = makeSpawnFn(() => ok());
    const sb = adapter(spawnFn);
    const tricky = "/workspace/odd path/$x;rm.txt";
    await sb.writeFile(tricky, "hello");
    expect(calls[0]!.args).toEqual([
      "exec",
      "r1",
      "--",
      "sh",
      "-c",
      'mkdir -p "$(dirname "$1")" && cat > "$1"',
      "--",
      tricky,
    ]);
    expect(calls[0]!.stdin).toBe("hello");
  });

  it("writeFile: handles multi-megabyte content (no command-line limit)", async () => {
    const { spawnFn, calls } = makeSpawnFn(() => ok());
    const sb = adapter(spawnFn);
    const big = "x".repeat(2 * 1024 * 1024);
    await sb.writeFile("/workspace/big.txt", big);
    expect(calls[0]!.stdin!.length).toBe(big.length);
  });

  it("stop: idempotent", async () => {
    const { spawnFn, calls } = makeSpawnFn(() => ok());
    const sb = adapter(spawnFn);
    await sb.stop?.();
    await sb.stop?.();
    // Two calls (stop + destroy) on first invocation, none on the second.
    expect(calls.length).toBe(2);
    expect(calls[0]!.args[0]).toBe("stop");
    expect(calls[1]!.args[0]).toBe("destroy");
  });

  it("MoatRunStoppedError: subsequent operations after stop", async () => {
    const { spawnFn } = makeSpawnFn(() => ok());
    const sb = adapter(spawnFn);
    await sb.stop?.();
    await expect(sb.executeCommand("ls")).rejects.toBeInstanceOf(MoatRunStoppedError);
  });
});

// ---------------------------------------------------------------------------
// Registry concurrency fix
// ---------------------------------------------------------------------------

describe("bash blocks registry concurrency", () => {
  it("two concurrent getOrCreate calls produce one sandbox", async () => {
    let createCount = 0;
    const made: Sandbox[] = [];

    function makeSandbox(): Sandbox {
      createCount++;
      const sb: Sandbox = {
        // Return exitCode != 0 from `find` so flush bails out without trying
        // to read files that don't exist.
        executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 1 }),
        readFile: async () => "",
        writeFile: async () => {
          // Slow first write so a race is observable.
          await new Promise((r) => setTimeout(r, 10));
        },
        stop: async () => {},
      };
      made.push(sb);
      return sb;
    }

    // Provider with a getter so the per-call resolveSandbox dispatch yields a
    // fresh sandbox every time it reads `provider.sandbox`. The registry,
    // keyed on scope (not on provider), should still only resolve one.
    const provider: SandboxProvider = {
      type: "custom",
      get sandbox() {
        return makeSandbox();
      },
    };

    const { bashCommand } = createBashBlocks({ provider, destination: "/workspace" });

    const ctx: any = {
      session: { identity: { id: "s-race", userId: "u1" } },
      resources: {},
    };

    await Promise.all([
      runForTest(bashCommand, { command: "true" }, ctx).catch(() => {}),
      runForTest(bashCommand, { command: "true" }, ctx).catch(() => {}),
    ]);

    expect(createCount).toBe(1);

    // Cleanup leaves the registry empty for the next test.
    await releaseBashSandbox(provider, ctx);
  });
});

// ---------------------------------------------------------------------------
// Capability cleanupBlock
// ---------------------------------------------------------------------------

describe("createBashCapability cleanupBlock", () => {
  it("returns a cleanupBlock that stops the underlying sandbox", async () => {
    const stopSpy = vi.fn(async () => {});
    const sandbox: Sandbox = {
      executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      readFile: async () => "",
      writeFile: async () => {},
      stop: stopSpy,
    };

    const cap = createBashCapability({
      provider: { type: "custom", sandbox },
    });
    expect(cap.cleanupBlock).toBeDefined();

    // Prime the registry: triggering bashCommand builds and registers the sandbox.
    const { bashCommand } = createBashBlocks({
      provider: { type: "custom", sandbox },
      destination: "/workspace",
    });
    const ctx: any = {
      session: { identity: { id: "s-cleanup", userId: "u1" } },
      resources: {},
    };
    await runForTest(bashCommand, { command: "true" }, ctx).catch(() => {});

    // Run the cleanup block: should stop the sandbox exactly once.
    await runForTest(cap.cleanupBlock, undefined, ctx);
    expect(stopSpy).toHaveBeenCalledTimes(1);

    // Idempotent: a second call finds nothing to clean up.
    await runForTest(cap.cleanupBlock, undefined, ctx);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
