/**
 * `sourceReadCapability`: a worker reads the source its app's workspace host
 * runs on, with no coding run and no project. Its three tools read through
 * the host's run source and read view, name no project to the model, and the
 * capability installs no project resources. A refusal is a tool result.
 *
 * Real local workspace host over a real git checkout.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveActivePresets } from "@flow-state-dev/core/capability";
import { createTestContext } from "@flow-state-dev/testing";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { afterAll, describe, expect, it } from "vitest";
import { sourceReadCapability } from "../src/source-read";

const scratch = mkdtempSync(join(tmpdir(), "source-read-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding one file, committed on `main`. */
function checkout(): string {
  const repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "notes.txt"), "the value is SR-7731\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@e.st", "-c", "user.name=t", ...args], { cwd: repo });
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return repo;
}

describe("sourceReadCapability", () => {
  const repo = checkout();
  const workspace = localWorkspaceHost({ root: join(scratch, "runs"), remotes: { allow: [] }, localRepositories: [repo], source: () => ({ kind: "repo", repo }) });
  const capability = sourceReadCapability({ workspace });
  type Tool = { name: string; description?: string; config: { execute: (input: unknown, ctx: unknown) => unknown } };
  const tools = (resolveActivePresets(capability.presets({ read: true }))[0]?.preset.tools ?? []) as Tool[];

  it("offers three reads under its read preset, naming no project", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(["globSource", "grepSource", "readSource"]);
    for (const tool of tools) expect(tool.description ?? "", tool.name).not.toMatch(/project/i);
  });

  it("installs no project resources", () => {
    const declared = Object.keys((capability as { resources?: Record<string, unknown> }).resources ?? {});
    expect(declared.filter((key) => /project/i.test(key))).toEqual([]);
  });

  it("reads a file of the host's source", async () => {
    const read = tools.find((tool) => tool.name === "readSource")!;
    const answer = (await read.config.execute({ path: "notes.txt", startLine: null, endLine: null }, createTestContext())) as { content?: string; text?: string };
    expect(JSON.stringify(answer)).toContain("SR-7731");
  });
});
