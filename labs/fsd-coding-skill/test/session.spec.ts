/** Resume stays inside the selected provider, including after process restarts. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../../../packages/cursor/src/agent";
import { TESTED_SDK_VERSION } from "@flow-state-dev/cursor";
import { runCli } from "../src/cli";
import { createFsdCodingFlow } from "../src/flow";
import { scriptedCodex } from "./scripted-codex";
import { scriptedCursor } from "./scripted-cursor";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });
function sidecar() {
  const dir = mkdtempSync(join(tmpdir(), "fsd-provider-test-"));
  dirs.push(dir);
  return join(dir, "sessions.json");
}
const cursorGate = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

describe("provider-safe session continuity", () => {
  it.each([false, true])("returns to each provider's own confirmed session (sidecar=%s)", async (persist) => {
    const sessionFile = persist ? sidecar() : undefined;
    const stores = persist ? undefined : createInMemoryStores();
    const cursor = scriptedCursor();
    const codex = scriptedCodex();
    for (const harness of ["cursor", "codex", "cursor", "codex"] as const) {
      const { result } = await runCli({
        door: "implement", harness, cwd: "/trusted", sessionId: "same-fsd", userId: "u", sessionFile,
        input: { task: "remember" }, stores,
        host: { cursor: cursorGate, resolveCursorClient: cursor.resolve, codex: { resolveCodexClient: codex.resolve } },
      });
      expect(result.error).toBeUndefined();
    }
    expect(cursor.rec.created).toHaveLength(1);
    expect(cursor.rec.resumed.map(x => x.id)).toEqual(["agent_1"]);
    expect(codex.rec.started).toHaveLength(1);
    expect(codex.rec.resumed.map(x => x.id)).toEqual(["codex-thread"]);
    if (sessionFile) expect(JSON.parse(readFileSync(sessionFile, "utf8"))).toEqual({ "same-fsd": { cursor: "agent_1", codex: "codex-thread" } });
  });

  it("reads legacy sidecar strings only as Cursor IDs and preserves them when Codex writes", async () => {
    const sessionFile = sidecar();
    writeFileSync(sessionFile, JSON.stringify({ legacy: "old-cursor", unrelated: "keep" }));
    const codex = scriptedCodex();
    const cursor = scriptedCursor();
    for (const harness of ["codex", "cursor"] as const) {
      await runCli({
        door: "fix", harness, cwd: "/trusted", sessionId: "legacy", userId: "u", sessionFile,
        input: { task: "continue" },
        host: { cursor: cursorGate, resolveCursorClient: cursor.resolve, codex: { resolveCodexClient: codex.resolve } },
      });
    }
    expect(codex.rec.resumed).toEqual([]);
    expect(cursor.rec.resumed[0]?.id).toBe("old-cursor");
    expect(JSON.parse(readFileSync(sessionFile, "utf8"))).toEqual({ legacy: { cursor: "old-cursor", codex: "codex-thread" }, unrelated: "keep" });
  });

  it.each(["codex", "cursor"] as const)("treats legacy session state as Cursor-only (%s)", async (harness) => {
    const codex = scriptedCodex();
    const cursor = scriptedCursor();
    const result = await testFlow({
      flow: createFsdCodingFlow({ cwd: "/trusted", harness, cursor: cursorGate, resolveCursorClient: cursor.resolve, codex: { resolveCodexClient: codex.resolve } }),
      action: "implement", input: { task: "continue" }, userId: "u",
      sessionId: "legacy-session", seed: { session: { state: { cursorAgentId: "legacy-state" } } },
    });
    expect(result.status).toBe("completed");
    expect(codex.rec.resumed).toEqual([]);
    expect(cursor.rec.resumed.map(x => x.id)).toEqual(harness === "cursor" ? ["legacy-state"] : []);
  });

  it("does not confirm a requested Codex resume when no thread.started event arrives", async () => {
    const sessionFile = sidecar();
    const original = JSON.stringify({ s: { codex: "requested", cursor: "keep" } });
    writeFileSync(sessionFile, original);
    const codex = scriptedCodex([{ type: "turn.failed", error: { message: "resume refused" } }]);
    const { result, stores } = await runCli({
      door: "fix", harness: "codex", cwd: "/trusted", sessionId: "s", userId: "u", sessionFile,
      input: { task: "continue" }, host: { codex: { resolveCodexClient: codex.resolve } },
    });
    expect(result.output).toMatchObject({ status: "errored", failureMessage: "resume refused" });
    expect(codex.rec.resumed[0]?.id).toBe("requested");
    expect(readFileSync(sessionFile, "utf8")).toBe(original);
    // Without the sidecar, the same in-memory session still has no confirmed ID.
    await runCli({ door: "fix", harness: "codex", cwd: "/trusted", sessionId: "s", userId: "u", sessionFile: undefined,
      stores, input: { task: "continue" }, host: { codex: { resolveCodexClient: codex.resolve } } });
    expect(codex.rec.started).toHaveLength(1);
  });
});
