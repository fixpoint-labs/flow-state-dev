// FIX-2519.
/**
 * A turn's images reach Claude Code as image blocks on the one user message
 * of its streaming input, after the prompt's text; nothing is
 * written to disk. A type it can't take refuses the turn before the query.
 *
 * The query is scripted, as in `agent.spec.ts`: that the real agent reads the
 * images is the goal check's (`goals/attachments/reach-each-harness`).
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { HarnessAttachmentRefusedError } from "@flow-state-dev/core/harness";
import { ATTACHMENT_SEAM, type AttachmentSeam } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";
import { claudeCodeAgent } from "../../src/sdk/agent";
import type { ClaudeCodeSdkMessage, ResolveClaudeCodeAgent } from "../../src/sdk/types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 5]);
const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_shot0001"), filename: "shot.png" };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 7]);
const report: FileContent = { type: "file", mediaType: "application/pdf", data: toBlobRef("b_report01"), filename: "report.pdf" };
const notes: FileContent = { type: "file", mediaType: "text/markdown", data: toBlobRef("b_notes0001"), filename: "notes.md" };
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

async function contextWith(files: Record<string, { mediaType: string; bytes: Uint8Array; text?: string }>) {
  const runtime = await createTestContext({});
  const read: AttachmentSeam = async (file) => {
    const found = files[file.data]!;
    return {
      mediaType: found.mediaType,
      bytes: found.bytes,
      base64: () => Buffer.from(found.bytes).toString("base64"),
      ...(found.text !== undefined ? { text: async () => found.text! } : {}),
    };
  };
  (runtime.ctx as unknown as Record<symbol, unknown>)[ATTACHMENT_SEAM] = read;
  return runtime.ctx as never;
}

describe("a turn's images, to Claude Code", () => {
  it("declares the image types and PDF as what it reads as files", () => {
    expect(claudeCodeAgent({ resolveClaudeAgent: scripted().resolve }).accepts).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "application/pdf",
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

  // FIX-2520: Claude Code reads a PDF itself, figures and layout included.
  it("sends a PDF as a document block, and a text-like file as text after the prompt", async () => {
    const query = scripted();
    const block = claudeCodeAgent({ resolveClaudeAgent: query.resolve, detached: true });
    const ctx = await contextWith({
      [report.data]: { mediaType: "application/pdf", bytes: PDF, text: "### report.pdf\nnot sent" },
      [notes.data]: { mediaType: "text/markdown", bytes: new Uint8Array([1]), text: "### notes.md\ncode word PLUM" },
    });
    await block.config.execute?.({ prompt: "read these", attachments: [report, notes] }, ctx);
    expect(query.prompts).toEqual([
      [
        {
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "text", text: "read these\n\n### notes.md\ncode word PLUM" },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF).toString("base64") } },
            ],
          },
          parent_tool_use_id: null,
        },
      ],
    ]);
  });

  it("sends a turn of text-like files only as one text prompt", async () => {
    const query = scripted();
    const block = claudeCodeAgent({ resolveClaudeAgent: query.resolve, detached: true });
    const ctx = await contextWith({ [notes.data]: { mediaType: "text/markdown", bytes: new Uint8Array([1]), text: "### notes.md\nPLUM" } });
    await block.config.execute?.({ prompt: "read", attachments: [notes] }, ctx);
    expect(query.prompts).toEqual(["read\n\n### notes.md\nPLUM"]);
  });

  it("refuses a type it can't take, by name, before the query", async () => {
    const query = scripted();
    const block = claudeCodeAgent({ resolveClaudeAgent: query.resolve, detached: true });
    const photo: FileContent = { type: "file", mediaType: "image/heic", data: toBlobRef("b_photo001"), filename: "photo.heic" };
    const thrown = await Promise.resolve(
      block.config.execute?.({ prompt: "read this", attachments: [photo] }, await contextWith({})),
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(HarnessAttachmentRefusedError);
    expect((thrown as Error).message).toContain('Claude Code can\'t take "photo.heic"');
    expect(query.prompts).toEqual([]);
  });
});
