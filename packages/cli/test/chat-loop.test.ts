import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { runChatLoop, decideIdleInterrupt } from "../src/chat/loop";
import { createHarnessState, bindTarget } from "../src/chat/state";
import { createBuiltinRegistry } from "../src/chat/registry";
import { createPlainTextRenderer } from "../src/chat/render";
import type { FlowActionTarget } from "../src/chat/targets";

describe("decideIdleInterrupt", () => {
  it("warns and arms on the first idle Ctrl-C", () => {
    expect(decideIdleInterrupt(false)).toEqual({ action: "warn", armed: true });
  });

  it("exits and disarms on a second idle Ctrl-C while armed", () => {
    expect(decideIdleInterrupt(true)).toEqual({ action: "exit", armed: false });
  });
});

describe("runChatLoop — per-turn session guard", () => {
  it("rotates the flow's session and fails the turn when the guard rejects mid-run", async () => {
    const target: FlowActionTarget = { kind: "flow-action", flowKind: "chatbot", actionName: "chat" };
    const state = createHarnessState();
    const { sessionId: bound } = bindTarget(state, target);

    let out = "";
    const output = new Writable({ write: (c, _e, cb) => (((out += c.toString()), cb())) }) as unknown as NodeJS.WritableStream;

    const exitCode = await runChatLoop({
      state,
      // The turn never reaches executeTurn — the guard rejects first — so get()
      // is never called; a throwing stub proves it.
      registry: { get: () => { throw new Error("executeTurn should not run"); } },
      targets: [target],
      builtins: createBuiltinRegistry(),
      renderer: createPlainTextRenderer(output),
      stores: {} as never,
      runtimeConfig: {},
      userId: "cli-user",
      runtime: { source: "test", store: "test" },
      // Guard rejects: simulates a foreign-flow request appended by another process.
      validateSessionForTarget: async () => ({ ok: false, message: "foreign flow in session history." }),
      input: Readable.from(["hi\n/exit\n"]) as Readable & { isTTY?: boolean },
      output,
      isTTY: false,
    });

    expect(state.sessions.get("chatbot")).toMatch(/^sess_/);
    expect(state.sessions.get("chatbot")).not.toBe(bound); // rotated to a fresh id
    expect(out).toContain("Rotated to a fresh session");
    expect(exitCode).toBe(1); // a failed turn → non-zero in piped mode
  });
});
