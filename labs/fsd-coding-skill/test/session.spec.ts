/** Resume stays inside the selected provider via session state — no sidecar. */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { INTERNAL_SDK_VERSION_READER as CURSOR_GATE, type CursorAgentOptions } from "../../../packages/cursor/src/agent";
import { INTERNAL_SDK_VERSION_READER as CODEX_GATE, type CodexAgentOptions } from "../../../packages/codex/src/agent";
import { TESTED_SDK_VERSION as CURSOR_SDK } from "@flow-state-dev/cursor";
import { TESTED_SDK_VERSION as CODEX_SDK } from "@flow-state-dev/codex";
import { createFsdCodingFlow } from "../src/flow";
import { scriptedCodex } from "./scripted-codex";
import { scriptedCursor } from "./scripted-cursor";

const cursorGate = {
  [CURSOR_GATE]: () => ({ kind: "version", version: CURSOR_SDK }),
} as CursorAgentOptions;
const codexGate = {
  [CODEX_GATE]: () => ({ kind: "version", version: CODEX_SDK }),
} as CodexAgentOptions;

describe("provider-safe session continuity", () => {
  it("returns to each provider's own confirmed session on shared stores", async () => {
    const stores = createInMemoryStores();
    const cursor = scriptedCursor();
    const codex = scriptedCodex();
    for (const harness of ["cursor", "codex", "cursor", "codex"] as const) {
      const result = await testFlow({
        flow: createFsdCodingFlow({
          cwd: "/trusted",
          harness,
          cursor: { ...cursorGate, resolveCursorClient: cursor.resolve },
          codex: { ...codexGate, resolveCodexClient: codex.resolve },
        }),
        action: "implement",
        userId: "u",
        sessionId: "same-fsd",
        input: { task: "remember" },
        stores,
      });
      expect(result.error).toBeUndefined();
    }
    expect(cursor.rec.created).toHaveLength(1);
    expect(cursor.rec.resumed.map((entry) => entry.id)).toEqual(["agent_1"]);
    expect(codex.rec.started).toHaveLength(1);
    expect(codex.rec.resumed.map((entry) => entry.id)).toEqual(["codex-thread"]);
  });

  it("does not persist a Codex session when no thread.started event arrives", async () => {
    const stores = createInMemoryStores();
    const refused = scriptedCodex([{ type: "turn.failed", error: { message: "resume refused" } }]);
    const first = await testFlow({
      flow: createFsdCodingFlow({
        cwd: "/trusted",
        harness: "codex",
        codex: { ...codexGate, resolveCodexClient: refused.resolve },
      }),
      action: "fix",
      userId: "u",
      sessionId: "s",
      input: { task: "continue" },
      stores,
    });
    expect(first.output).toMatchObject({ status: "errored", failureMessage: "resume refused" });
    expect(refused.rec.started).toHaveLength(1);
    expect(refused.rec.resumed).toEqual([]);

    const secondClient = scriptedCodex();
    await testFlow({
      flow: createFsdCodingFlow({
        cwd: "/trusted",
        harness: "codex",
        codex: { ...codexGate, resolveCodexClient: secondClient.resolve },
      }),
      action: "fix",
      userId: "u",
      sessionId: "s",
      input: { task: "continue" },
      stores,
    });
    expect(secondClient.rec.started).toHaveLength(1);
    expect(secondClient.rec.resumed).toEqual([]);
  });
});
