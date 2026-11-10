/**
 * A harness session's turn hands the person's files to the harness (FIX-2519):
 * the request's attachments go on the run input, in reference form, after the
 * prompt. A harness that declares what it takes refuses the rest itself, by
 * name; one that declares nothing is never handed a file, and the turn fails
 * on its record, naming the file, without the harness running.
 */
import { DEFAULT_ORG_ID, handler } from "@flow-state-dev/core";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import type { HarnessBlock, HarnessRunInput } from "@flow-state-dev/core/harness";
import type { FileContent } from "@flow-state-dev/core/items";
import { runAction } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { harnessSessionFlow, type HarnessSessionState, type HarnessSessionWorkspace } from "../src";

const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_shot0001"), filename: "shot.png" };

/** A harness that records the input it was handed, declaring `accepts` when given. */
function recordingAgent(seen: HarnessRunInput[], accepts?: HarnessBlock["accepts"]) {
  const block = handler({
    name: "recording-harness",
    inputSchema: z.object({ prompt: z.string(), attachments: z.array(z.unknown()).optional() }),
    execute: async (input) => {
      seen.push(input as HarnessRunInput);
      return { outcome: "finished" };
    },
  }) as unknown as HarnessBlock;
  return accepts === undefined ? block : Object.assign(block, { accepts });
}

const workspace: HarnessSessionWorkspace = (() => {
  const dir = mkdtempSync(join(tmpdir(), "session-turn-files-"));
  return { provision: async () => dir, locate: () => dir, branch: () => null };
})();

async function turn(agent: HarnessBlock, sessionId: string, attachments?: FileContent[]) {
  const stores = createInMemoryStores();
  const now = Date.now();
  await stores.session.set(
    sessionId,
    { id: sessionId, flowKind: "stub-session", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub-model" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any" as never,
  );
  const result = await runAction({
    flow: harnessSessionFlow({ kind: "stub-session", workspace, agent: () => agent }),
    actionName: "turn",
    input: { prompt: "what is this?" },
    userId: "u",
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores,
    runtimeConfig: {},
    ...(attachments !== undefined ? { attachments } : {}),
  } as never);
  const state = (await stores.session.get(sessionId))?.state as HarnessSessionState;
  return { result, turns: Object.values(state.turns ?? {}) };
}

describe("a harness session turn's files", () => {
  it("go to the harness on its run input, as references, after the prompt", async () => {
    const seen: HarnessRunInput[] = [];
    await turn(recordingAgent(seen, ["image/png"]), "s-files", [shot]);
    expect(seen).toEqual([{ prompt: "what is this?", attachments: [shot] }]);
  });

  it("are not on the run input of a turn that carried none", async () => {
    const seen: HarnessRunInput[] = [];
    await turn(recordingAgent(seen, ["image/png"]), "s-text");
    expect(seen).toEqual([{ prompt: "what is this?" }]);
  });

  it("refuse the turn, naming the file, when the harness declares nothing it takes", async () => {
    const seen: HarnessRunInput[] = [];
    const { turns } = await turn(recordingAgent(seen), "s-undeclared", [shot]);
    expect(seen).toEqual([]);
    expect(turns.map((record) => record.error)).toEqual([expect.stringContaining('can\'t take "shot.png" (image/png)')]);
  });
});
