/**
 * A turn's images reach Claude Code as image blocks on the one user message
 * of its streaming input, after the prompt's text (FIX-2519); nothing is
 * written to disk. A type it can't take refuses the turn before the query.
 *
 * The query is scripted, as in `agent.spec.ts`: that the real agent reads the
 * images is the goal check's (`goals/attachments/reach-each-harness`).
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { HarnessAttachmentRefusedError } from "@flow-state-dev/core/harness";
import { HARNESS_ATTACHMENT_SEAM, type HarnessAttachmentSeam } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";
import { claudeCodeAgent } from "../../src/sdk/agent";
import type { ClaudeCodeSdkMessage, ResolveClaudeCodeAgent } from "../../src/sdk/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 5]);
const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_shot0001"), filename: "shot.png" };
const still: FileContent = { type: "file", mediaType: "image/webp", data: toBlobRef("b_still001"), filename: "still.webp" };

const RESULT_OK: ClaudeCodeSdkMessage = {
  type: "result",
  subtype: "success",
  result: "I see it",
  session_id: "sess_new",
  usage: { input_tokens: 5, output_tokens: 1 },
  total_cost_usd: 0.001,
};

/** A query recording each prompt it was handed, with a streaming input read to its end. */
function scripted() {
  const prompts: unknown[] = [];
  const resolve: ResolveClaudeCodeAgent = () => ({
    query: async function* (args) {
      if (typeof args.prompt === "string") prompts.push(args.prompt);
      else {
        const messages: unknown[] = [];
        for await (const message of args.prompt) messages.push(message);
        prompts.push(messages);
      }
      yield RESULT_OK;
    },
  });
  return { resolve, prompts };
}

async function contextWith(files: Record<string, { mediaType: string; bytes: Uint8Array }>) {
  const runtime = await createTestContext({});
  const read: HarnessAttachmentSeam = async (file) => {
    const found = files[file.data]!;
    return { mediaType: found.mediaType, bytes: found.bytes, base64: () => Buffer.from(found.bytes).toString("base64") };
  };
  (runtime.ctx as Record<symbol, unknown>)[HARNESS_ATTACHMENT_SEAM] = read;
  return runtime.ctx as never;
}

describe("a turn's images, to Claude Code", () => {
  it("declares the image types it takes", () => {
    expect(claudeCodeAgent({ resolveClaudeAgent: scripted().resolve }).accepts).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
  });

  it("sends one user message: the prompt's text, then each image as a base64 block, in order", async () => {
    const query = scripted();
    const block = claudeCodeAgent({ resolveClaudeAgent: query.resolve, detached: true });
    const ctx = await contextWith({
      [shot.data]: { mediaType: "image/png", bytes: PNG },
      [still.data]: { mediaType: "image/webp", bytes: WEBP },
    });
    await block.config.execute?.({ prompt: "what is in these?", attachments: [shot, still] }, ctx);
    expect(query.prompts).toEqual([
      [
        {
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "text", text: "what is in these?" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(PNG).toString("base64") } },
              { type: "image", source: { type: "base64", media_type: "image/webp", data: Buffer.from(WEBP).toString("base64") } },
            ],
          },
          parent_tool_use_id: null,
        },
      ],
    ]);
  });

  it("sends the prompt as text for a turn with no files", async () => {
    const query = scripted();
    const block = claudeCodeAgent({ resolveClaudeAgent: query.resolve, detached: true });
    await block.config.execute?.({ prompt: "just text" }, await contextWith({}));
    expect(query.prompts).toEqual(["just text"]);
  });

  it("refuses a type it can't take, by name, before the query", async () => {
    const query = scripted();
    const block = claudeCodeAgent({ resolveClaudeAgent: query.resolve, detached: true });
    const pdf: FileContent = { type: "file", mediaType: "application/pdf", data: toBlobRef("b_report01"), filename: "report.pdf" };
    const thrown = await Promise.resolve(
      block.config.execute?.({ prompt: "read this", attachments: [pdf] }, await contextWith({})),
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(HarnessAttachmentRefusedError);
    expect((thrown as Error).message).toContain('Claude Code can\'t take "report.pdf"');
    expect(query.prompts).toEqual([]);
  });
});
