/**
 * The workspace capability's wiring.
 *
 * What the projection DOES with files is its own package's business and is
 * tested there. What is tested here is the wiring only this capability can get
 * wrong: which directory the run is handed, whether that is the same directory
 * it is confined to, and what a caller can still override.
 */
import { describe, it, expect, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testBlock } from "@flow-state-dev/testing";
import { defineFlow, defineResourceCollection, generator } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createWorkspaceAgentCapability,
  containmentSandbox,
  discoverMountsForTest,
  RELOCATION_TOOLS,
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


/**
 * A flow carrying one mounted collection, so `ctx.resources` has something to
 * discover. Without it the capability mounts nothing, lists nothing, and every
 * flush is trivially empty — which would make a test asserting on outcomes
 * pass for the wrong reason.
 */
const artifactsCollection = defineResourceCollection({
  pattern: "artifacts/**",
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: z.object({
    path: z.string().nullable().default(null),
    hash: z.string().nullable().default(null),
    updatedAt: z.string().nullable().default(null),
  }),
  client: { state: { read: true }, expose: ["path", "hash", "updatedAt"] },
});

function flowWith(cap: unknown) {
  const gen = generator({
    name: "host",
    model: "openai/gpt-5.4-mini",
    prompt: "x",
    uses: [cap as never],
  });
  return defineFlow({
    kind: "workspace-flow",
    resources: { artifacts: artifactsCollection },
    actions: { go: { block: gen } },
  })({ id: "default" });
}

describe("what auto-discovery will and will not mount", () => {
  const mountsFor = (resources: Record<string, unknown>) =>
    discoverMountsForTest({ resources } as never).map((m) => m.prefix);

  const ordinary = {
    pattern: "artifacts/**",
    list: () => Promise.resolve([]),
  };

  it("mounts an ordinary collection", () => {
    expect(mountsFor({ artifacts: ordinary })).toEqual(["artifacts"]);
  });

  it("leaves an external collection alone", () => {
    // It answers the duck-type — `pattern` and `list` are both there — and is
    // projectable through neither. Its `list` is paged, so hydrate's
    // `for (const entry of await list())` throws before the run starts, and it
    // carries no mutators for a writable mount to flush through.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const external = {
        pattern: "tickets/**",
        external: true,
        list: () => Promise.resolve({ items: [], nextCursor: null }),
      };
      expect(mountsFor({ tickets: external })).toEqual([]);
      expect(warn.mock.calls.map((c) => c[0]).join(" ")).toMatch(/tickets/);
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves a parameterized collection alone", () => {
    // Its prefix stops at the first parameter, so `data/[topic]/observations`
    // would mount at `data` and come back addressed as `react/observations`.
    // Core wants an object key for those patterns, so the flush's `getOptional`
    // throws on the string and the run finishes having saved nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const parameterized = {
        pattern: "data/[topic]/observations",
        list: () => Promise.resolve([]),
      };
      expect(mountsFor({ data: parameterized })).toEqual([]);
      expect(warn.mock.calls.map((c) => c[0]).join(" ")).toMatch(/data/);
    } finally {
      warn.mockRestore();
    }
  });
});

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

  it("confines the run to the PHYSICAL directory it works in, not the symlink", async () => {
    // The agent resolves `cwd` through `realpath` before handing it to the
    // SDK. A sandbox naming the unresolved spelling would confine the run to a
    // path the process is not in — macOS `/tmp` is a symlink, so this is the
    // ordinary case there, not an exotic one. The same divergence was already
    // fixed once between `cwd` and the work recorder; this is the third
    // reader.
    const base = scratch();
    const real = join(base, "real");
    const link = join(base, "link");
    mkdirSync(real);
    symlinkSync(real, link);

    const spy = vi.fn();
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => link,
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    const options = spy.mock.calls[0][0].options;
    const physical = realpathSync(real);
    expect(options?.cwd).toBe(physical);
    expect(options?.sandbox).toEqual(containmentSandbox(physical));

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

  it("takes away the tools that would move the run out of its workspace", async () => {
    // The SDK's worktree tools relocate a run mid-flight, and only because the
    // model asked. A projection that hydrated one directory and flushes it
    // afterwards would be reconciling a tree the run had already left.
    const base = scratch();
    const spy = vi.fn();
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => base,
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    expect(spy.mock.calls[0][0].options?.disallowedTools).toEqual(
      expect.arrayContaining([...RELOCATION_TOOLS]),
    );

    discard(base);
  });

  it("keeps a caller's own disallowed tools alongside the relocation ones", async () => {
    // Merged, not replaced. An override here would silently make the caller
    // responsible for re-adding a boundary they did not know they had.
    const base = scratch();
    const spy = vi.fn();
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: scriptedQuery(spy),
      root: () => base,
      disallowedTools: ["WebFetch"],
    });

    await testBlock(toolOf(cap) as never, { input: { prompt: "go" } });

    const disallowed = spy.mock.calls[0][0].options?.disallowedTools ?? [];
    expect(disallowed).toEqual(expect.arrayContaining(["WebFetch", ...RELOCATION_TOOLS]));

    discard(base);
  });

  it("reconciles and releases even when the run itself fails", async () => {
    // A `.tap()` after a step does not run when that step throws. Without a
    // failure path the projection holding a failed run's files stays resident
    // — one leak per failure on a long-lived server — and the work that run
    // did get done goes nowhere.
    const base = scratch();
    let callersHookRan = false;
    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: () => ({
        query: async function* () {
          // The run wrote something, then died.
          mkdirSync(join(base, "artifacts"), { recursive: true });
          writeFileSync(join(base, "artifacts", "half-done.md"), "partial work");
          throw new Error("agent exploded");
        },
      }),
      root: () => base,
      onErrored: () => {
        // Composed, not replaced: the capability's own hook runs and a
        // caller's still fires.
        callersHookRan = true;
      },
    });

    const result = (await testBlock(toolOf(cap) as never, {
      input: { prompt: "go" },
      flow: flowWith(cap) as never,
    })) as {
      error?: Error | null;
      resources: Record<string, { list(): Promise<unknown[]> }>;
    };

    // The run still fails — the hook reconciles, it does not swallow.
    expect(result.error).toBeTruthy();

    // THE discriminating assertion. The file the run wrote is under no
    // mounted collection, so a flush records it as an orphan. No flush, no
    // row — which is what "the work went nowhere" looks like from outside.
    // THE discriminating assertion: the work the run DID get done is in the
    // collection. Without a failure path it is only on a disk nobody reads.
    const saved = await result.resources.artifacts!.list();
    expect(saved).toHaveLength(1);

    expect(callersHookRan).toBe(true);

    discard(base);
  });

  it("fails the run when the collection write fails, rather than reporting success", async () => {
    // The two rejections a flush can produce call for opposite handling. A
    // workspace that cannot be READ decided nothing, so reporting it and
    // carrying on loses nothing. A collection that cannot be WRITTEN means the
    // run's work never left the directory — and the directory is about to be
    // thrown away. Catching both alike hands back a successful run whose new
    // file exists nowhere it will be read from again.
    const base = scratch();
    // A required field with no default. The projection sets `path`, `hash` and
    // `updatedAt` because it maintains them; it cannot know about this one, and
    // auto-discovery has no `entryState` to supply it, so `getOrCreate` rejects.
    const strict = defineResourceCollection({
      pattern: "artifacts/**",
      scope: "session",
      prefetchMode: "lazy",
      stateSchema: z.object({
        path: z.string().nullable().default(null),
        hash: z.string().nullable().default(null),
        updatedAt: z.string().nullable().default(null),
        title: z.string(),
      }),
      client: { state: { read: true }, expose: ["path", "hash", "updatedAt", "title"] },
    });

    const cap = createWorkspaceAgentCapability({
      resolveClaudeAgent: () => ({
        query: async function* () {
          mkdirSync(join(base, "artifacts"), { recursive: true });
          writeFileSync(join(base, "artifacts", "new.md"), "the run's work");
          yield RESULT_OK;
        },
      }),
      root: () => base,
    });

    const gen = generator({
      name: "host",
      model: "openai/gpt-5.4-mini",
      prompt: "x",
      uses: [cap as never],
    });
    const flow = defineFlow({
      kind: "workspace-strict-flow",
      resources: { artifacts: strict },
      actions: { go: { block: gen } },
    })({ id: "default" });

    const result = (await testBlock(toolOf(cap) as never, {
      input: { prompt: "go" },
      flow: flow as never,
    })) as { error?: Error | null };

    expect(result.error).toBeTruthy();

    discard(base);
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
    expect(options.disallowedTools ?? []).not.toContain(RELOCATION_TOOLS[0]);
    // The directory is still projected — containment and projection are
    // separate decisions.
    expect(options.cwd).toBe(base);

    discard(base);
  });
});
