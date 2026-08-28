/**
 * The workspace capability's wiring.
 *
 * What the projection DOES with files is its own package's business and is
 * tested there. What is tested here is the wiring only this capability can get
 * wrong: which directory the run is handed, whether that is the same directory
 * it is confined to, and what a caller can still override.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testBlock } from "@flow-state-dev/testing";
import {
  createWorkspaceAgentCapability,
  containmentSandbox,
} from "../../src/sdk/workspace";
import { WORKSPACE_OUTCOMES } from "../../src/sdk/workspace-collections";
import type {
  ClaudeAgentQueryOptions,
  ResolveClaudeAgent,
  SdkMessageLike,
} from "../../src/sdk/types";

const RESULT_OK: SdkMessageLike = {
  type: "result",
  subtype: "success",
  result: "done",
  session_id: "sess_new",
  usage: { input_tokens: 1, output_tokens: 1 },
  total_cost_usd: 0,
};

function scriptedQuery(
  spy?: (args: { prompt: unknown; options?: ClaudeAgentQueryOptions }) => void,
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      spy?.(args);
      yield RESULT_OK;
    },
  });
}

/** The tool block the capability exposes. */
function toolOf(cap: unknown) {
  const { __presetDefs } = cap as {
    __presetDefs: { tools: { tools: Array<Record<string, unknown>> } };
  };
  return __presetDefs.tools.tools[0]!;
}

const scratch = () => mkdtempSync(join(tmpdir(), "ws-cap-"));
const discard = (p: string) => rmSync(p, { recursive: true, force: true });

describe("createWorkspaceAgentCapability", () => {
  it("exposes one sequencer that hydrates, runs, and flushes", () => {
    const cap = createWorkspaceAgentCapability({ root: () => "/tmp/x" });
    const tool = toolOf(cap) as { kind: string; name: string };

    expect(tool.kind).toBe("sequencer");
    expect(tool.name).toBe("workspace-agent");
  });

  it("declares the outcomes collection itself, readable and lazily prefetched", () => {
    // A capability's tools do not carry resource declarations up to the flow,
    // so declaring it on the blocks alone would leave the read route at 404.
    // Readable, because a caller who cannot read the conflicts is not being
    // told about them; lazy, because a session is reused across runs.
    const cap = createWorkspaceAgentCapability({ root: () => "/tmp/x" }) as unknown as {
      resources: Record<
        string,
        { client?: { state?: { read?: boolean } }; prefetchMode?: string }
      >;
    };

    expect(Object.keys(cap.resources)).toEqual([WORKSPACE_OUTCOMES]);
    expect(cap.resources[WORKSPACE_OUTCOMES]!.client?.state?.read).toBe(true);
    expect(cap.resources[WORKSPACE_OUTCOMES]!.prefetchMode).toBe("lazy");
  });

  it("hands the run the directory it created, and confines it to the same one", async () => {
    // The invariant the registry exists for. `cwd` and the sandbox's
    // `allowWrite` are two reads of ONE resolved value — resolving twice would
    // hand a `mkdtemp` caller one directory and confine it to another, and
    // nothing would throw.
    const base = scratch();
    const spy = vi.fn();
    let calls = 0;
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => {
        calls += 1;
        return join(base, `run-${calls}`);
      },
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    const options = spy.mock.calls[0][0].options;
    const expected = join(base, "run-1");
    expect(options?.cwd).toBe(expected);
    expect(options?.sandbox).toEqual(containmentSandbox(expected));
    // Once. Not once per reader.
    expect(calls).toBe(1);
    expect(existsSync(expected)).toBe(true);

    discard(base);
  });

  it("stops the run reading its configuration out of the workspace", async () => {
    // The workspace holds whatever the mounted collections hold, and in an
    // application those are written by its users. Without this a CLAUDE.md
    // among them configures the agent reading it.
    const base = scratch();
    const spy = vi.fn();
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => base,
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    expect(spy.mock.calls[0][0].options?.settingSources).toEqual([]);

    discard(base);
  });

  it("names the workspace as the only writable path and refuses the unsandboxed escape", () => {
    // `cwd` is a working directory, not a fence — absolute paths still
    // resolve — so the boundary has to be declared. And a command that can ask
    // to run unsandboxed can ask its way out of that boundary.
    expect(containmentSandbox("/work/run-1")).toEqual({
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: { allowWrite: ["/work/run-1"] },
    });
  });

  it("lets a caller's own setting win over the containment default", async () => {
    // Containment is a default, not a lock: a deployment that trusts its
    // workspace has to be able to say so without giving up the projection.
    const base = scratch();
    const spy = vi.fn();
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => base,
      settingSources: ["user"],
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    expect(spy.mock.calls[0][0].options?.settingSources).toEqual(["user"]);

    discard(base);
  });

  it("applies no containment at all when it is turned off", async () => {
    // BP-035's off state, and both halves of it: leaving either one on would
    // be a partial boundary nobody asked for.
    const base = scratch();
    const spy = vi.fn();
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => base,
      contain: false,
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    const options = spy.mock.calls[0][0].options ?? {};
    expect("settingSources" in options).toBe(false);
    expect("sandbox" in options).toBe(false);
    // The directory is still projected — containment and projection are
    // separate decisions.
    expect(options.cwd).toBe(base);

    discard(base);
  });
});
