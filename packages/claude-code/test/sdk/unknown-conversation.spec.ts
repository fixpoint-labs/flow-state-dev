/**
 * A host shows "Claude Code did not continue conversation X" only on the
 * failure that means it, and an ordinary error for everything else. It reads
 * that from core's classification, never from Claude Code's message, so the
 * classification has to be exactly as narrow as the refusal.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { harnessFailureKind } from "@flow-state-dev/core";
import { claudeCodeAgent } from "../../src/sdk/agent";
import { ClaudeAgentRunError } from "../../src/sdk/errors";
import type { ResolveClaudeAgent, SdkMessageLike } from "../../src/sdk/types";

/**
 * What Claude Code 2.1.296 and the Agent SDK 0.3.234 do on a resume of an id
 * they have no transcript for, as measured: one error `result` carrying the
 * requested id, then a throw naming it.
 */
function refusesToResume(id: string): ResolveClaudeAgent {
  return () => ({
    query: async function* () {
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: id,
        errors: [`No conversation found with session ID: ${id}`],
      } as SdkMessageLike;
      throw new Error(
        `Claude Code returned an error result: No conversation found with session ID: ${id}`,
      );
    },
  });
}

describe("classifying a refused continuation", () => {
  it("classifies Claude Code refusing the conversation it was asked to resume", async () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: refusesToResume("sess_gone"),
      detached: true,
      resume: () => "sess_gone",
    });
    const { error } = await testBlock(block, { input: { prompt: "go on" } });

    expect(error?.cause).toBeInstanceOf(ClaudeAgentRunError);
    expect((error?.cause as ClaudeAgentRunError).harnessFailure).toBe("unknown-conversation");
    // Read the way a host reads it: through core, past the framework's wrapper.
    expect(harnessFailureKind(error)).toBe("unknown-conversation");
  });

  it("does not classify any other failure of a resumed run", async () => {
    const resolveClaudeAgent: ResolveClaudeAgent = () => ({
      query: async function* () {
        yield { type: "system", subtype: "init", session_id: "sess_prev" } as SdkMessageLike;
        throw new Error("Claude Code process exited with code 1");
      },
    });
    const block = claudeCodeAgent({ resolveClaudeAgent, detached: true, resume: () => "sess_prev" });
    const { error } = await testBlock(block, { input: { prompt: "go on" } });

    expect(error?.cause).toBeInstanceOf(ClaudeAgentRunError);
    expect(harnessFailureKind(error)).toBeNull();
  });

  it("does not classify a refusal of a different conversation than the one asked for", async () => {
    const block = claudeCodeAgent({
      resolveClaudeAgent: refusesToResume("sess_other"),
      detached: true,
      resume: () => "sess_prev",
    });
    const { error } = await testBlock(block, { input: { prompt: "go on" } });

    expect(error?.cause).toBeInstanceOf(ClaudeAgentRunError);
    expect(harnessFailureKind(error)).toBeNull();
  });

  it("does not classify a failure of a run that asked to resume nothing", async () => {
    const block = claudeCodeAgent({ resolveClaudeAgent: refusesToResume("sess_gone") });
    const { error } = await testBlock(block, { input: { prompt: "start" } });

    expect(error?.cause).toBeInstanceOf(ClaudeAgentRunError);
    expect(harnessFailureKind(error)).toBeNull();
  });
});
