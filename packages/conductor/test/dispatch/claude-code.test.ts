/**
 * The Claude Code dispatcher — the vendor-specific half of the seam.
 *
 * The behaviour worth pinning is not the option list; it is that this dispatcher
 * **settles rather than throws** on every way a vendor can go wrong, because a
 * thrown error skips the ledger and loses the transition. The vendor failures
 * themselves are pinned where they happen, in `@flow-state-dev/claude-code`;
 * what is checked here is that each one arrives as a `failed` result with a
 * reason, and that cost survives the trip.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolveClaudeAgentQuery } from "@flow-state-dev/claude-code/sdk";
import { claudeCodeDispatcher } from "../../src/dispatch/claude-code";
import type { PhaseBrief } from "../../src/dispatch/types";

/**
 * `runClaudeHeadless` documents that it never throws, and the tests below leave
 * it alone. But the adapter is what has to hold when a dependency breaks its own
 * contract, so the real implementation is wrapped in a switch one test flips.
 */
const harness = vi.hoisted(() => ({ throws: null as Error | null }));
vi.mock("@flow-state-dev/claude-code/sdk", async (importActual) => {
  const actual = await importActual<typeof import("@flow-state-dev/claude-code/sdk")>();
  return {
    ...actual,
    runClaudeHeadless: (options: Parameters<typeof actual.runClaudeHeadless>[0]) => {
      if (harness.throws) throw harness.throws;
      return actual.runClaudeHeadless(options);
    },
  };
});

afterEach(() => {
  harness.throws = null;
});

const BRIEF: PhaseBrief = {
  dispatchId: "FIX-1#1",
  entityId: "FIX-1",
  entityKind: "issue",
  phase: "IMPLEMENTATION",
  action: "implement",
  branch: "fix/FIX-1",
  workspacePath: "/repo/.conductor/worktrees/FIX-1",
  guidancePaths: ["docs/philosophy.md"],
  because: "The spec was approved.",
  summary: "Make the thing work.",
};

/** A terminal `result` message from the vendor SDK, success by default. */
const result = (extra: Record<string, unknown> = {}) => ({
  type: "result" as const,
  subtype: "success",
  is_error: false,
  result: "done",
  session_id: "sess-abc",
  total_cost_usd: 1.25,
  usage: { input_tokens: 900, output_tokens: 120 },
  ...extra,
});

/** A resolver whose `query` replays `messages` and records how it was called. */
function scriptedAgent(messages: readonly unknown[]) {
  const query = vi.fn(async function* (_args: unknown) {
    for (const message of messages) yield message as never;
  });
  const resolveAgent = (() => ({ query })) as unknown as ResolveClaudeAgentQuery;
  return { query, resolveAgent };
}

/** The options the scripted `query` was called with. */
const optionsOf = (query: ReturnType<typeof scriptedAgent>["query"]) =>
  (vi.mocked(query).mock.calls[0]![0] as { options: Record<string, unknown> }).options;

/** The prompt the scripted `query` was called with. */
const promptOf = (query: ReturnType<typeof scriptedAgent>["query"]) =>
  (vi.mocked(query).mock.calls[0]![0] as { prompt: string }).prompt;

const at = () => new Date("2026-08-14T12:00:00Z");

describe("the claude-code dispatcher", () => {
  it("declares worktree isolation, because the agent edits whatever directory it is pointed at", () => {
    const dispatcher = claudeCodeDispatcher();
    expect(dispatcher.isolation).toBe("worktree");
    expect(dispatcher.vendor).toBe("claude-code");
  });

  it("runs in the provisioned workspace with a non-interactive permission mode", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);

    expect(query).toHaveBeenCalledTimes(1);
    expect(optionsOf(query).cwd).toBe(BRIEF.workspacePath);
    // A prompting permission mode would hang forever: there is no terminal.
    expect(optionsOf(query).permissionMode).toBe("acceptEdits");
  });

  it("passes the rendered brief as the prompt, so the harness knows the work, the branch and the reason", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    const prompt = promptOf(query);
    expect(prompt).toContain("FIX-1");
    expect(prompt).toContain("fix/FIX-1");
    expect(prompt).toContain("The spec was approved.");
    expect(prompt).toContain("docs/philosophy.md");
  });

  it("sets a model only when one is configured, so the vendor's own default is not overridden by accident", async () => {
    const withModel = scriptedAgent([result()]);
    await claudeCodeDispatcher({ resolveAgent: withModel.resolveAgent, model: "opus", now: at }).run(
      BRIEF,
    );
    expect(optionsOf(withModel.query).model).toBe("opus");

    const withoutModel = scriptedAgent([result()]);
    await claudeCodeDispatcher({ resolveAgent: withoutModel.resolveAgent, now: at }).run(BRIEF);
    expect(optionsOf(withoutModel.query).model).toBeUndefined();
  });

  it("reports the vendor's cost and run id, which is the only place cost accounting can come from", async () => {
    const { resolveAgent } = scriptedAgent([result()]);
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    expect(dispatched.outcome).toBe("completed");
    expect(dispatched.costUsd).toBe(1.25);
    expect(dispatched.vendorRunId).toBe("sess-abc");
    expect(dispatched.dispatchId).toBe("FIX-1#1");
    expect(dispatched.startedAt).toBe("2026-08-14T12:00:00.000Z");
  });

  it("reports the branch it worked on and nothing more — a PR is a fact conductor reads from GitHub", async () => {
    const { resolveAgent } = scriptedAgent([result()]);
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    expect(dispatched.produced).toEqual({ branch: "fix/FIX-1" });
    expect(dispatched.produced.pullNumber).toBeUndefined();
  });

  it("fails when the run ends on an error subtype, naming the class in the reason", async () => {
    const { resolveAgent } = scriptedAgent([
      result({
        subtype: "error_max_turns",
        is_error: true,
        result: undefined,
        errors: ["ran out of turns"],
      }),
    ]);
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    expect(dispatched.outcome).toBe("failed");
    expect(dispatched.error).toContain("ran out of turns");
    // The failure class survives into the vendor-neutral reason, so an escalation
    // can tell a ceiling the operator set from a crash it cannot raise its way out of.
    expect(dispatched.error).toContain("error_max_turns");
    // Cost is still real when the run failed — the tokens were spent.
    expect(dispatched.costUsd).toBe(1.25);
  });

  it("settles as failed when the vendor SDK cannot be loaded, instead of throwing past the ledger", async () => {
    const resolveAgent: ResolveClaudeAgentQuery = () => {
      throw new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'");
    };
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    expect(dispatched.outcome).toBe("failed");
    expect(dispatched.error).toContain("claude-agent-sdk");
  });

  it("settles as failed when the run throws mid-stream, instead of throwing past the ledger", async () => {
    const resolveAgent = (() => ({
      query: async function* () {
        yield { type: "system", subtype: "init", session_id: "sess-partial" } as never;
        throw new Error("stream closed unexpectedly");
      },
    })) as unknown as ResolveClaudeAgentQuery;
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    expect(dispatched.outcome).toBe("failed");
    expect(dispatched.error).toContain("stream closed unexpectedly");
    // The session is still worth recording: a human can open the partial run.
    expect(dispatched.vendorRunId).toBe("sess-partial");
  });

  it("settles as failed when the run ends without a terminal result", async () => {
    const { resolveAgent } = scriptedAgent([
      { type: "system", subtype: "init", session_id: "sess-truncated" },
    ]);
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);
    expect(dispatched.outcome).toBe("failed");
    expect(dispatched.error).toContain("without a terminal result");
  });

  it("settles as failed when a project's renderPrompt throws, instead of throwing past the ledger", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    const dispatched = await claudeCodeDispatcher({
      resolveAgent,
      now: at,
      renderPrompt: () => {
        throw new TypeError("Cannot read properties of null (reading 'title')");
      },
    }).run(BRIEF);

    expect(dispatched.outcome).toBe("failed");
    // Whose bug it is has to survive into the reason: a renderer someone wrote
    // is debugged nowhere near the CLI or the model.
    expect(dispatched.error).toContain("renderPrompt");
    expect(dispatched.error).toContain("Cannot read properties of null");
    // The record is still complete, because the tick attributes it and the
    // ledger stores it exactly like any other failed dispatch.
    expect(dispatched.dispatchId).toBe("FIX-1#1");
    expect(dispatched.startedAt).toBe("2026-08-14T12:00:00.000Z");
    expect(dispatched.settledAt).toBe("2026-08-14T12:00:00.000Z");
    // Nothing was invoked and nothing was spent.
    expect(query).not.toHaveBeenCalled();
    expect(dispatched.costUsd).toBeNull();
  });

  it("settles as failed when the harness throws instead of settling, so a broken dependency is still a recorded failure", async () => {
    harness.throws = new Error("the SDK bridge exploded");
    const { resolveAgent } = scriptedAgent([result()]);
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run(BRIEF);

    expect(dispatched.outcome).toBe("failed");
    expect(dispatched.error).toContain("harness threw instead of settling");
    expect(dispatched.error).toContain("the SDK bridge exploded");
    // Attribution points at the harness, not at the project's renderer.
    expect(dispatched.error).not.toContain("renderPrompt");
  });

  it("settles even when the injected clock throws, because a result it cannot stamp is a transition the ledger never sees", async () => {
    const { resolveAgent } = scriptedAgent([result()]);
    // What a mis-parsed frozen-time setting produces: `toISOString` throws.
    const dispatched = await claudeCodeDispatcher({
      resolveAgent,
      now: () => new Date("whenever"),
    }).run(BRIEF);

    expect(dispatched.outcome).toBe("completed");
    expect(Number.isNaN(Date.parse(dispatched.startedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(dispatched.settledAt))).toBe(false);
  });

  it("refuses to run without the workspace its isolation model promised", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    const dispatched = await claudeCodeDispatcher({ resolveAgent, now: at }).run({
      ...BRIEF,
      workspacePath: null,
    });
    expect(dispatched.outcome).toBe("failed");
    expect(query).not.toHaveBeenCalled();
  });
});
