import { describe, expect, it } from "vitest";
import { parseInput } from "../src/chat/parse";
import { resolveDispatch, listTargets, type FlowActionTarget } from "../src/chat/targets";
import { createHarnessState, bindTarget, activeSessionId, type HarnessState } from "../src/chat/state";
import { createBuiltinRegistry, type BuiltinContext } from "../src/chat/registry";

const builtins = createBuiltinRegistry();

/** A minimal registry stub shaped like the parts listTargets reads. */
function stubRegistry(flows: Array<{ kind: string; actions: string[] }>) {
  const instances = flows.map((f) => ({
    kind: f.kind,
    actions: Object.fromEntries(f.actions.map((a) => [a, {}])),
  }));
  return {
    list: () => instances as any,
    get: (kind: string) => instances.find((i) => i.kind === kind) as any,
  };
}

const target = (flowKind: string, actionName: string): FlowActionTarget => ({
  flowKind,
  actionName,
});

describe("resolveDispatch", () => {
  it("routes a known builtin to the builtin bucket", () => {
    const state = createHarnessState();
    const d = resolveDispatch(parseInput("/status"), state, builtins);
    expect(d.kind).toBe("builtin");
    if (d.kind === "builtin") expect(d.command.name).toBe("status");
  });

  it("falls an unknown /name through to the bound target as raw text", () => {
    const state = createHarnessState();
    bindTarget(state, target("hello-chat", "chat"));
    const d = resolveDispatch(parseInput("/skill-name do it"), state, builtins);
    expect(d).toEqual({ kind: "fallthrough", text: "/skill-name do it" });
  });

  it("treats an unknown /name with no bound target as unbound, not a turn", () => {
    const state = createHarnessState();
    const d = resolveDispatch(parseInput("/skill-name"), state, builtins);
    expect(d).toEqual({ kind: "unbound" });
  });

  it("routes chat text to a turn against the default target", () => {
    const state = createHarnessState();
    bindTarget(state, target("hello-chat", "chat"));
    const d = resolveDispatch(parseInput("what is my name?"), state, builtins);
    expect(d).toEqual({ kind: "turn", target: target("hello-chat", "chat"), text: "what is my name?" });
  });

  it("reports unbound when chat text arrives with no default target", () => {
    const state = createHarnessState();
    const d = resolveDispatch(parseInput("hello"), state, builtins);
    expect(d).toEqual({ kind: "unbound" });
  });

  it("maps a lone slash to a noop with a help hint", () => {
    const state = createHarnessState();
    const d = resolveDispatch(parseInput("/"), state, builtins);
    expect(d).toEqual({ kind: "noop", hint: "type /help for commands" });
  });

  it("maps an empty line to a bare noop", () => {
    const state = createHarnessState();
    expect(resolveDispatch(parseInput(""), state, builtins)).toEqual({ kind: "noop" });
  });
});

describe("listTargets", () => {
  it("enumerates flow · action pairs from the registry-default instance", () => {
    const registry = stubRegistry([
      { kind: "hello-chat", actions: ["chat"] },
      { kind: "writer", actions: ["draft", "revise"] },
    ]);
    expect(listTargets(registry)).toEqual([
      target("hello-chat", "chat"),
      target("writer", "draft"),
      target("writer", "revise"),
    ]);
  });
});

/** A BuiltinContext over real state with stubbed runtime/guard/writer. */
function makeCtx(
  state: HarnessState,
  targets: FlowActionTarget[],
  overrides: Partial<BuiltinContext> = {},
): { ctx: BuiltinContext; lines: string[] } {
  const lines: string[] = [];
  const ctx: BuiltinContext = {
    state,
    targets,
    runtime: { source: "discovery (src/flows)", store: ".fsdev/data/fsdev.db (SQLite)" },
    validateSessionForTarget: async () => ({ ok: true }),
    write: (line) => lines.push(line),
    ...overrides,
  };
  return { ctx, lines };
}

describe("builtins", () => {
  const targets = [target("hello-chat", "chat"), target("writer", "draft"), target("writer", "revise")];

  it("/use rebinds the default target and seeds a session", async () => {
    const state = createHarnessState();
    const { ctx, lines } = makeCtx(state, targets);
    const result = await builtins.get("use")!.run("hello-chat chat", ctx);
    expect(result.ok).toBe(true);
    expect(state.defaultTarget).toEqual(target("hello-chat", "chat"));
    expect(activeSessionId(state)).toMatch(/^sess_/);
    expect(lines.join("\n")).toContain("Now chatting with hello-chat · chat");
  });

  it("/use rejects an unknown flow with suggestions", async () => {
    const state = createHarnessState();
    const { ctx } = makeCtx(state, targets);
    const result = await builtins.get("use")!.run("nope", ctx);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("Unknown flow \"nope\"") });
    expect(state.defaultTarget).toBeUndefined();
  });

  it("/use requires an action when the flow has several", async () => {
    const state = createHarnessState();
    const { ctx } = makeCtx(state, targets);
    const result = await builtins.get("use")!.run("writer", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("multiple actions");
  });

  it("/targets enumerates and marks the current default", async () => {
    const state = createHarnessState();
    bindTarget(state, target("writer", "draft"));
    const { ctx, lines } = makeCtx(state, targets);
    await builtins.get("targets")!.run("", ctx);
    const out = lines.join("\n");
    expect(out).toContain("* writer · draft");
    expect(out).toContain("  hello-chat · chat");
  });

  it("/session new rotates the current flow's session id", async () => {
    const state = createHarnessState();
    bindTarget(state, target("hello-chat", "chat"));
    const first = activeSessionId(state);
    const { ctx } = makeCtx(state, targets);
    await builtins.get("session")!.run("new", ctx);
    const second = activeSessionId(state);
    expect(second).toMatch(/^sess_/);
    expect(second).not.toBe(first);
  });

  it("/session <id> is rejected when the guard fails, leaving state unchanged", async () => {
    const state = createHarnessState();
    bindTarget(state, target("hello-chat", "chat"));
    const before = activeSessionId(state);
    const { ctx } = makeCtx(state, targets, {
      validateSessionForTarget: async () => ({ ok: false, message: "session belongs to another flow" }),
    });
    const result = await builtins.get("session")!.run("sess_other", ctx);
    expect(result).toEqual({ ok: false, message: "session belongs to another flow" });
    expect(activeSessionId(state)).toBe(before);
  });

  it("/status renders the injected runtime source and store lines", async () => {
    const state = createHarnessState();
    bindTarget(state, target("hello-chat", "chat"));
    state.turns = 3;
    const { ctx, lines } = makeCtx(state, targets);
    await builtins.get("status")!.run("", ctx);
    const out = lines.join("\n");
    expect(out).toContain("Target:  hello-chat · chat");
    expect(out).toContain("Turns:   3");
    expect(out).toContain("Source:  discovery (src/flows)");
    expect(out).toContain("Store:   .fsdev/data/fsdev.db (SQLite)");
  });

  it("/exit signals the loop to stop", async () => {
    const state = createHarnessState();
    const { ctx } = makeCtx(state, targets);
    expect(await builtins.get("exit")!.run("", ctx)).toEqual({ ok: true, exit: true });
  });
});
