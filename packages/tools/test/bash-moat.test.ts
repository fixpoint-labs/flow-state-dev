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
  resolveMountSource,
  stripMountsTargeting,
  probeMoatRun,
  purgeOldRuns,
  DEFAULT_MAX_CONTAINERS,
  FSDEV_RUN_PREFIX,
  satisfiesMinVersion,
  resolveMoatSandbox,
  createMoatAdapter,
  FSDEV_MANAGED_MARKER,
  MoatNotInstalledError,
  MoatVersionError,
  MoatGrantsError,
  MoatRunStoppedError,
  MoatBinaryReadError,
  type SpawnFn as MoatSpawnFn,
  type SpawnResult as MoatSpawnResult,
} from "../src/bash/adapters/moat";
import { writeFile } from "node:fs/promises";
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

  it("generateMoatYaml: first line is the fsdev-managed marker", () => {
    const yaml = generateMoatYaml({ name: "r1" });
    expect(yaml.split("\n", 1)[0]).toBe(FSDEV_MANAGED_MARKER);
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

  it("overwrites an existing framework-managed moat.yaml when copying configPath in (marker check)", async () => {
    // Reproduces the "second tool call in the same dev-server session"
    // scenario: a previous call wrote `<workspace>/moat.yaml` with the
    // managed marker, then the registry got cleared (HMR, retry,
    // request-scoped lifecycle), and the next call hits the configPath
    // copy path again. The yaml is ours — we should adopt it, not
    // refuse and abort.
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(JSON.stringify({ version: "0.5.1" }));
      if (args[0] === "grant") return ok(JSON.stringify([]));
      if (args[0] === "list") {
        return ok(JSON.stringify([{ Name: "r1", State: "running" }]));
      }
      return ok();
    });
    const tmpWorkspace = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-test-"));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-src-"));
    try {
      // Pre-seed the workspace with a framework-managed yaml as if a
      // prior boot in this session had already written it.
      await writeFile(
        path.join(tmpWorkspace, "moat.yaml"),
        `${FSDEV_MANAGED_MARKER}\nname: "old-version"\n`,
        "utf-8",
      );
      // Source yaml outside the workspace (typical kitchen-sink layout).
      const sourcePath = path.join(sourceDir, "moat.yaml");
      await writeFile(
        sourcePath,
        ["name: kitchen-sink", "runtime: apple", ""].join("\n"),
        "utf-8",
      );
      await resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        workspace: tmpWorkspace,
        configPath: sourcePath,
        spawnFn,
      });
      // The workspace yaml has been refreshed with the source contents,
      // still carrying the marker on the first line.
      const finalYaml = await import("node:fs/promises").then((m) =>
        m.readFile(path.join(tmpWorkspace, "moat.yaml"), "utf-8"),
      );
      expect(finalYaml.split("\n", 1)[0]).toBe(FSDEV_MANAGED_MARKER);
      expect(finalYaml).toContain("name: kitchen-sink");
      expect(finalYaml).not.toContain("old-version");
    } finally {
      await rm(tmpWorkspace, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("frameworkManaged=true bypasses the marker check (handles pre-marker leftover yamls)", async () => {
    // Migration scenario: the workspace already contains a moat.yaml
    // written by an older framework version that didn't yet prepend
    // FSDEV_MANAGED_MARKER. The marker check would treat it as
    // user-authored and refuse. `frameworkManaged: true` asserts the
    // workspace is fully framework-derived (e.g. an auto-generated
    // `.fsdev/workspaces/session/<sessionId>` dir) and the resolver
    // overwrites freely.
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(JSON.stringify({ version: "0.5.1" }));
      if (args[0] === "grant") return ok(JSON.stringify([]));
      if (args[0] === "list") {
        return ok(JSON.stringify([{ Name: "r1", State: "running" }]));
      }
      return ok();
    });
    const tmpWorkspace = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-test-"));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-src-"));
    try {
      // Pre-marker stale yaml — no marker on the first line.
      await writeFile(
        path.join(tmpWorkspace, "moat.yaml"),
        "name: pre-marker-leftover\n",
        "utf-8",
      );
      const sourcePath = path.join(sourceDir, "moat.yaml");
      await writeFile(sourcePath, "name: kitchen-sink\n", "utf-8");
      await resolveMoatSandbox({
        runName: "r1",
        mountTarget: "/workspace",
        workspace: tmpWorkspace,
        configPath: sourcePath,
        frameworkManaged: true,
        spawnFn,
      });
      // Workspace yaml has been replaced; marker now present.
      const finalYaml = await import("node:fs/promises").then((m) =>
        m.readFile(path.join(tmpWorkspace, "moat.yaml"), "utf-8"),
      );
      expect(finalYaml.split("\n", 1)[0]).toBe(FSDEV_MANAGED_MARKER);
      expect(finalYaml).toContain("name: kitchen-sink");
      expect(finalYaml).not.toContain("pre-marker-leftover");
    } finally {
      await rm(tmpWorkspace, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a non-managed yaml at the workspace (user-authored)", async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "version") return ok(JSON.stringify({ version: "0.5.1" }));
      if (args[0] === "grant") return ok(JSON.stringify([]));
      return ok();
    });
    const tmpWorkspace = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-test-"));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "fsdev-moat-src-"));
    try {
      // Workspace has a yaml WITHOUT the marker → user-authored.
      await writeFile(
        path.join(tmpWorkspace, "moat.yaml"),
        "name: handcrafted\n",
        "utf-8",
      );
      const sourcePath = path.join(sourceDir, "moat.yaml");
      await writeFile(sourcePath, "name: kitchen-sink\n", "utf-8");
      await expect(
        resolveMoatSandbox({
          runName: "r1",
          mountTarget: "/workspace",
          workspace: tmpWorkspace,
          configPath: sourcePath,
          spawnFn,
        }),
      ).rejects.toThrow(/Refusing to overwrite/);
    } finally {
      await rm(tmpWorkspace, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// Mount-source resolution (parses workspace moat.yaml)
// ---------------------------------------------------------------------------

describe("resolveMountSource", () => {
  it("returns workspace dir when no configPath supplied", () => {
    expect(resolveMountSource("/ws", "/workspace", undefined)).toBe(
      path.resolve("/ws"),
    );
  });

  it("returns workspace dir when configPath doesn't exist", () => {
    expect(
      resolveMountSource("/ws", "/workspace", "/nonexistent-path/moat.yaml"),
    ).toBe(path.resolve("/ws"));
  });

  it("returns the host source from yaml when a mounts entry targets mountTarget", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fsdev-mountsrc-"));
    const yamlPath = path.join(tmp, "moat.yaml");
    await writeFile(
      yamlPath,
      [
        "name: kitchen-sink",
        "runtime: apple",
        "mounts:",
        "  - ./.fsdev/moat:/workspace",
        "  - /etc/data:/data:ro",
        "",
      ].join("\n"),
      "utf-8",
    );
    try {
      // Relative source resolves against the workspace dir.
      expect(resolveMountSource(tmp, "/workspace", yamlPath)).toBe(
        path.resolve(tmp, ".fsdev/moat"),
      );
      // Absolute source returned as-is.
      expect(resolveMountSource(tmp, "/data", yamlPath)).toBe("/etc/data");
      // Target not in yaml → fall back to workspace.
      expect(resolveMountSource(tmp, "/missing", yamlPath)).toBe(
        path.resolve(tmp),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// probeMoatRun
// ---------------------------------------------------------------------------

describe("stripMountsTargeting", () => {
  it("removes mount entries whose target equals the given mountTarget", () => {
    const yaml = [
      "name: kitchen-sink",
      "runtime: apple",
      "mounts:",
      "  - ./.fsdev/moat:/workspace",
      "  - /etc/data:/data:ro",
      "ports:",
      "  web: 3000",
      "",
    ].join("\n");
    const stripped = stripMountsTargeting(yaml, "/workspace");
    // The /workspace line is gone; the unrelated /data mount survives.
    expect(stripped).not.toContain("./.fsdev/moat:/workspace");
    expect(stripped).toContain("/etc/data:/data:ro");
    expect(stripped).toContain("name: kitchen-sink");
    expect(stripped).toContain("ports:");
  });

  it("returns the yaml unchanged when no mount targets mountTarget", () => {
    const yaml = "name: r1\nmounts:\n  - /etc/data:/data:ro\n";
    expect(stripMountsTargeting(yaml, "/workspace")).toBe(yaml);
  });

  it("leaves non-mount yaml lines (and unrelated `-` items) alone", () => {
    const yaml = [
      "grants:",
      "  - github",
      "  - anthropic",
      "mounts:",
      "  - ./host:/workspace",
      "",
    ].join("\n");
    const stripped = stripMountsTargeting(yaml, "/workspace");
    // grants list entries don't match `src:dst` shape — they survive.
    expect(stripped).toContain("- github");
    expect(stripped).toContain("- anthropic");
    expect(stripped).not.toContain("./host:/workspace");
  });

  it("injects an explicit <hostMountSource>:<mountTarget> entry when provided", () => {
    const yaml = [
      "name: kitchen-sink",
      "runtime: apple",
      "mounts:",
      "  - ./.fsdev/moat:/workspace",
      "  - /etc/data:/data:ro",
      "",
    ].join("\n");
    const out = stripMountsTargeting(yaml, "/workspace", "/abs/host/session");
    // User's conflicting /workspace mount is gone.
    expect(out).not.toContain("./.fsdev/moat:/workspace");
    // Our explicit injection sits inside the existing mounts: block.
    expect(out).toMatch(/mounts:\n\s*- \/abs\/host\/session:\/workspace/);
    // Unrelated /data mount survived.
    expect(out).toContain("/etc/data:/data:ro");
  });

  it("appends a fresh mounts: block when the yaml has none", () => {
    const yaml = ["name: r1", "runtime: apple", ""].join("\n");
    const out = stripMountsTargeting(yaml, "/workspace", "/abs/host/session");
    expect(out).toMatch(/mounts:\n\s*- \/abs\/host\/session:\/workspace/);
    expect(out).toContain("runtime: apple");
  });
});

describe("probeMoatRun", () => {
  it('returns "running" when a matching run is present and live', async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") {
        return ok(JSON.stringify([{ Name: "kitchen-sink", State: "running" }]));
      }
      return ok();
    });
    expect(await probeMoatRun({ runName: "kitchen-sink", spawnFn })).toBe(
      "running",
    );
  });

  it('returns "absent" when the run is stopped', async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") {
        return ok(JSON.stringify([{ Name: "kitchen-sink", State: "stopped" }]));
      }
      return ok();
    });
    expect(await probeMoatRun({ runName: "kitchen-sink", spawnFn })).toBe(
      "absent",
    );
  });

  it('returns "absent" when no matching run exists', async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") return ok("[]");
      return ok();
    });
    expect(await probeMoatRun({ runName: "kitchen-sink", spawnFn })).toBe(
      "absent",
    );
  });

  it('returns "absent" on spawn failure (defensive)', async () => {
    const spawnFn: MoatSpawnFn = async () => {
      throw new Error("docker daemon not accessible");
    };
    expect(await probeMoatRun({ runName: "kitchen-sink", spawnFn })).toBe(
      "absent",
    );
  });
});

// ---------------------------------------------------------------------------
// purgeOldRuns — bounded MOAT-container pool
// ---------------------------------------------------------------------------

describe("purgeOldRuns", () => {
  it("returns empty when fewer than `keep` framework-managed runs exist", async () => {
    const runs = [
      { Name: `${FSDEV_RUN_PREFIX}a`, State: "running", StartedAt: "2026-05-15T10:00:00Z" },
      { Name: `${FSDEV_RUN_PREFIX}b`, State: "running", StartedAt: "2026-05-15T11:00:00Z" },
    ];
    const { spawnFn, calls } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") return ok(JSON.stringify(runs));
      return ok();
    });
    const result = await purgeOldRuns({ runName: "current", keep: 5, spawnFn });
    expect(result.destroyed).toEqual([]);
    expect(calls.filter((c) => c.args[0] === "destroy")).toHaveLength(0);
  });

  it("destroys oldest excess runs above `keep`, never the current run", async () => {
    // 6 fsdev runs sorted oldest→newest; keep=3 means destroy 3 oldest.
    const runs = [
      { Name: `${FSDEV_RUN_PREFIX}a`, State: "running", StartedAt: "2026-05-15T01:00:00Z" },
      { Name: `${FSDEV_RUN_PREFIX}b`, State: "running", StartedAt: "2026-05-15T02:00:00Z" },
      { Name: `${FSDEV_RUN_PREFIX}c`, State: "running", StartedAt: "2026-05-15T03:00:00Z" },
      { Name: `${FSDEV_RUN_PREFIX}d`, State: "running", StartedAt: "2026-05-15T04:00:00Z" },
      { Name: `${FSDEV_RUN_PREFIX}e`, State: "running", StartedAt: "2026-05-15T05:00:00Z" },
      { Name: `${FSDEV_RUN_PREFIX}f`, State: "running", StartedAt: "2026-05-15T06:00:00Z" },
    ];
    const { spawnFn, calls } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") return ok(JSON.stringify(runs));
      return ok();
    });
    const result = await purgeOldRuns({
      runName: `${FSDEV_RUN_PREFIX}f`, // current = newest
      keep: 3,
      spawnFn,
    });
    // 5 candidates after excluding current; keep 3 → destroy 2 oldest.
    expect(result.destroyed).toEqual([`${FSDEV_RUN_PREFIX}a`, `${FSDEV_RUN_PREFIX}b`]);
    const destroys = calls.filter((c) => c.args[0] === "destroy").map((c) => c.args[1]);
    expect(destroys).toEqual([`${FSDEV_RUN_PREFIX}a`, `${FSDEV_RUN_PREFIX}b`]);
  });

  it("never touches non-prefixed runs (user-named containers)", async () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({
      Name: `user-named-${i}`,
      State: "running",
      StartedAt: `2026-05-15T${String(i).padStart(2, "0")}:00:00Z`,
    }));
    const { spawnFn, calls } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") return ok(JSON.stringify(runs));
      return ok();
    });
    const result = await purgeOldRuns({ runName: "anything", keep: 5, spawnFn });
    expect(result.destroyed).toEqual([]);
    expect(calls.filter((c) => c.args[0] === "destroy")).toHaveLength(0);
  });

  it("uses `DEFAULT_MAX_CONTAINERS` when `keep` is unspecified", async () => {
    // 52 fsdev runs total → with the default 50 keep, 2 oldest get purged.
    const runs = Array.from({ length: 52 }, (_, i) => ({
      Name: `${FSDEV_RUN_PREFIX}${i.toString().padStart(3, "0")}`,
      State: "running",
      StartedAt: `2026-05-${String(i % 28 + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    expect(DEFAULT_MAX_CONTAINERS).toBe(50);
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") return ok(JSON.stringify(runs));
      return ok();
    });
    const result = await purgeOldRuns({ runName: "other", spawnFn });
    expect(result.destroyed).toHaveLength(2);
  });

  it("returns empty on list failure (best-effort, never throws)", async () => {
    const { spawnFn } = makeSpawnFn(({ args }) => {
      if (args[0] === "list") return fail(1, "moat list broken");
      return ok();
    });
    const result = await purgeOldRuns({ runName: "x", keep: 5, spawnFn });
    expect(result.destroyed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adapter host-fs translation
// ---------------------------------------------------------------------------

describe("createMoatAdapter host-fs paths", () => {
  it("readFile/writeFile go through host fs when mountSource is set", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fsdev-hostfs-"));
    const { spawnFn, calls } = makeSpawnFn(() => ok());
    const sandbox = createMoatAdapter({
      runName: "r1",
      bin: "moat",
      execTimeoutMs: 1000,
      spawnFn,
      stopped: false,
      persist: false,
      mountSource: tmp,
      mountTarget: "/workspace",
    });

    expect(sandbox.hostMountSource).toBe(tmp);

    // Write through the sandbox: should land on host fs without any
    // `moat exec` invocation.
    await sandbox.writeFile("/workspace/artifacts/foo.md", "hello");
    expect(calls.filter((c) => c.args[0] === "exec")).toHaveLength(0);

    // Read back through the sandbox: same — host fs, no exec.
    const content = await sandbox.readFile("/workspace/artifacts/foo.md");
    expect(content).toBe("hello");
    expect(calls.filter((c) => c.args[0] === "exec")).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
  });

  it("falls back to moat exec for paths outside the bind mount", async () => {
    const { spawnFn, calls } = makeSpawnFn(({ args }) => {
      if (args[0] === "exec" && args.includes("cat")) return ok("etc-data");
      return ok();
    });
    const sandbox = createMoatAdapter({
      runName: "r1",
      bin: "moat",
      execTimeoutMs: 1000,
      spawnFn,
      stopped: false,
      persist: false,
      mountSource: "/some/source",
      mountTarget: "/workspace",
    });

    // `/etc/...` is not under `/workspace` — must go through moat exec.
    const content = await sandbox.readFile("/etc/passwd");
    expect(content).toBe("etc-data");
    expect(calls.some((c) => c.args[0] === "exec")).toBe(true);
  });
});

describe("createMoatAdapter", () => {
  function adapter(spawnFn: MoatSpawnFn) {
    return createMoatAdapter({
      runName: "r1",
      bin: "moat",
      execTimeoutMs: 1000,
      spawnFn,
      stopped: false,
      persist: false,
      mountTarget: "/workspace",
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

  it("persist: stop() skips moat stop/destroy so the container survives for reuse", async () => {
    const { spawnFn, calls } = makeSpawnFn(() => ok());
    const sb = createMoatAdapter({
      runName: "r1",
      bin: "moat",
      execTimeoutMs: 1000,
      spawnFn,
      stopped: false,
      persist: true,
      mountTarget: "/workspace",
    });
    await sb.stop?.();
    // No `moat stop` / `moat destroy` invocations: the run lives on.
    expect(calls.length).toBe(0);
    // Subsequent commands still throw MoatRunStoppedError — the *local*
    // handle is closed, but the underlying container is not.
    await expect(sb.executeCommand("ls")).rejects.toBeInstanceOf(MoatRunStoppedError);
  });

  it("MoatRunStoppedError: subsequent operations after stop", async () => {
    const { spawnFn } = makeSpawnFn(() => ok());
    const sb = adapter(spawnFn);
    await sb.stop?.();
    await expect(sb.executeCommand("ls")).rejects.toBeInstanceOf(MoatRunStoppedError);
  });
});

// ---------------------------------------------------------------------------
// Block composition shape per provider
// ---------------------------------------------------------------------------

describe("createBashBlocks composition", () => {
  it("returns leaf handlers for fast providers (no sequencer wrapper)", () => {
    const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
      provider: {
        type: "custom",
        sandbox: {
          executeCommand: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
          readFile: async () => "",
          writeFile: async () => {},
        },
      },
    });
    // No tap node, no extra trace entry — just the leaf doing the work.
    expect((bashCommand as { kind: string }).kind).toBe("handler");
    expect((bashReadFile as { kind: string }).kind).toBe("handler");
    expect((bashWriteFile as { kind: string }).kind).toBe("handler");
  });

  it("wraps bashCommand and bashReadFile in sequencers for MOAT, but leaves bashWriteFile as a leaf handler", () => {
    // MOAT's bashWriteFile goes direct-host-fs without needing the
    // container, so it doesn't gate on ensureSandbox at all. The other
    // two need either container exec or hydration, so they get the
    // tapIf(isCold, ensureSandbox) → leaf composition.
    const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
      provider: { type: "moat", runName: "kitchen-sink" },
    });
    expect((bashCommand as { kind: string }).kind).toBe("sequencer");
    expect((bashReadFile as { kind: string }).kind).toBe("sequencer");
    expect((bashWriteFile as { kind: string }).kind).toBe("handler");
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
