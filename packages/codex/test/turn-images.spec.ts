/**
 * A turn's images reach Codex as files in a folder of the turn's own, outside
 * the checkout, gone when the turn ends however it ends (FIX-2519 D1): in the
 * checkout, an agent's `git add -A` would ship the screenshot in its pull
 * request. A type Codex can't take refuses the turn before a thread starts.
 *
 * The client is scripted, as in `agent.spec.ts`: that the real CLI reads the
 * images is the goal check's (`goals/attachments/reach-each-harness`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { HarnessAttachmentRefusedError } from "@flow-state-dev/core/harness";
import { HARNESS_ATTACHMENT_SEAM, type HarnessAttachmentSeam } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";
import { codexAgent, INTERNAL_CODEX_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { TESTED_CODEX_SDK, type CodexThreadEvent, type CodexTurnInput } from "../src/types";

const GATE_OFF = {
  [INTERNAL_CODEX_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CODEX_SDK.range }),
} as CodexAgentOptions;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 3, 4]);
const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_shot0001"), filename: "shot.png" };
const photo: FileContent = { type: "file", mediaType: "image/jpeg", data: toBlobRef("b_photo001"), filename: "../photo.jpg" };

const OK: CodexThreadEvent[] = [
  { type: "thread.started", thread_id: "thr_1" },
  { type: "item.completed", item: { id: "i1", type: "agent_message", text: "I see it" } },
  { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
] as CodexThreadEvent[];

/** A client that records each turn's input and, while the turn runs, what its image paths hold. */
function scripted(opts: { throwOnRun?: Error } = {}) {
  const turns: Array<{ input: CodexTurnInput; onDisk: Array<number[] | null> }> = [];
  let started = 0;
  const thread = {
    id: null,
    async runStreamed(input: CodexTurnInput) {
      const paths = typeof input === "string" ? [] : input.flatMap((part) => (part.type === "local_image" ? [part.path] : []));
      turns.push({ input, onDisk: paths.map((path) => (existsSync(path) ? [...readFileSync(path)] : null)) });
      if (opts.throwOnRun) throw opts.throwOnRun;
      return {
        events: (async function* () {
          for (const event of OK) yield event;
        })(),
      };
    },
  };
  const resolve = () => ({
    startThread: () => {
      started += 1;
      return thread;
    },
    resumeThread: () => thread,
  });
  return { resolve, turns, started: () => started };
}

/** A context whose request's file reader serves `files` by reference. */
async function contextWith(files: Record<string, { mediaType: string; bytes: Uint8Array }>) {
  const runtime = await createTestContext({});
  const read: HarnessAttachmentSeam = async (file) => {
    const found = files[file.data]!;
    return { mediaType: found.mediaType, bytes: found.bytes, base64: () => Buffer.from(found.bytes).toString("base64") };
  };
  (runtime.ctx as unknown as Record<symbol, unknown>)[HARNESS_ATTACHMENT_SEAM] = read;
  return runtime.ctx as never;
}

const FILES = {
  [shot.data]: { mediaType: "image/png", bytes: PNG },
  [photo.data]: { mediaType: "image/jpeg", bytes: JPEG },
};

describe("a turn's images, to Codex", () => {
  it("declares the image types it takes", () => {
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted().resolve });
    expect(block.accepts).toEqual(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  });

  it("hands the prompt then each image's path, written in a per-turn folder outside the checkout, removed after", async () => {
    const client = scripted();
    const block = codexAgent({ ...GATE_OFF, cwd: () => "/work/checkout", resolveCodexClient: client.resolve });
    await block.config.execute?.({ prompt: "what is in these?", attachments: [shot, photo] }, await contextWith(FILES));

    const [turn] = client.turns;
    expect(Array.isArray(turn!.input)).toBe(true);
    const parts = turn!.input as Exclude<CodexTurnInput, string>;
    expect(parts[0]).toEqual({ type: "text", text: "what is in these?" });
    const paths = parts.slice(1).map((part) => (part as { path: string }).path);
    expect(parts.slice(1).every((part) => part.type === "local_image")).toBe(true);
    // The bytes were on disk while the turn ran, in order, typed by extension, named by position.
    expect(turn!.onDisk).toEqual([[...PNG], [...JPEG]]);
    expect(paths.map((path) => path.split(sep).at(-1))).toEqual(["1.png", "2.jpg"]);
    // One folder for the turn, under this user's private temp root, never in the checkout.
    const folder = dirname(paths[0]!);
    expect(dirname(paths[1]!)).toBe(folder);
    expect(folder.startsWith(tmpdir())).toBe(true);
    expect(folder.startsWith("/work/checkout")).toBe(false);
    // Gone once the turn ended.
    expect(existsSync(folder)).toBe(false);
  });

  it("removes the turn's folder when the run fails too", async () => {
    const client = scripted({ throwOnRun: new Error("the CLI exited 1") });
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: client.resolve });
    await expect(
      Promise.resolve(block.config.execute?.({ prompt: "look", attachments: [shot] }, await contextWith(FILES))),
    ).rejects.toThrow();
    const path = (client.turns[0]!.input as Array<{ path?: string }>)[1]!.path!;
    expect(client.turns[0]!.onDisk).toEqual([[...PNG]]);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("sends the prompt alone for a turn with no files", async () => {
    const client = scripted();
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: client.resolve });
    await block.config.execute?.({ prompt: "just text" }, await contextWith({}));
    expect(client.turns[0]!.input).toBe("just text");
  });

  it("refuses a type it can't take, by name, before a thread starts", async () => {
    const client = scripted();
    const block = codexAgent({ ...GATE_OFF, resolveCodexClient: client.resolve });
    const pdf: FileContent = { type: "file", mediaType: "application/pdf", data: toBlobRef("b_report01"), filename: "report.pdf" };
    const thrown = await Promise.resolve(
      block.config.execute?.({ prompt: "read this", attachments: [pdf] }, await contextWith({})),
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(HarnessAttachmentRefusedError);
    expect((thrown as Error).message).toContain('Codex can\'t take "report.pdf"');
    expect(client.started()).toBe(0);
  });
});
