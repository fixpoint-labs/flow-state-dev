/**
 * What is asserted is what the block hands the SDK, the last point Kitchen Sink
 * controls. Whether the harness then runs that model is
 * `goals/kitchen-sink-harness/runs-the-picked-model/`.
 *
 * Red states produced before these were trusted:
 *   - feed the mode's default instead of the session's model: every "hands the
 *     harness the pick" case fails, on start and on resume.
 *   - drop the create check: the create route answers 200 for a session with
 *     no model, and an action births one.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { testFlow } from "@flow-state-dev/testing";
import type { ClaudeAgentQueryOptions, ResolveClaudeAgent } from "@flow-state-dev/claude-code/sdk";
import type { ResolveCodexClient } from "@flow-state-dev/codex";
import type { ResolveCursorClient } from "@flow-state-dev/cursor";

import { claudeCodeModelChoices, claudeCodeSessionFlow } from "@/lib/claude-code-mode";
import { CODEX_SESSION, codexModelChoices, codexSessionFlow } from "@/lib/codex-mode";
import { CURSOR_DEFAULT_MODEL, cursorModelChoices, cursorModelSelection, cursorSessionFlow } from "@/lib/cursor-mode";
import { harnessModelChoices, resetHarnessModelChoicesForTests, type ModelChoices } from "@/lib/harness-models";
import { MODEL_REQUIRED } from "@/lib/harness-session-flow";
import type { HarnessSessionState } from "@/lib/harness-turn";
import { scriptedClaudeCode } from "@/lib/scripted-claude-code";
import { scriptedCodex, scriptedCodexPauses } from "@/lib/scripted-codex";
import { scriptedCursor } from "@/lib/scripted-cursor";

let scratch: string;
let repo: string;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-harness-model-")));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  scriptedCodexPauses.stepMs = 0;
  scriptedCodexPauses.slowMs = 0;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", join(scratch, "state"));
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetHarnessModelChoicesForTests();
});

type Stores = ReturnType<typeof createInMemoryStores>;

/** One mode's flow behind a recorder of the model each run handed the SDK, in order. */
interface Mode {
  readonly name: string;
  readonly flow: () => FlowInstance;
  readonly models: Array<string | undefined>;
  /** The model a session with none runs on. */
  readonly fallback: string | undefined;
}

function claudeCode(): Mode {
  const models: Array<string | undefined> = [];
  const scripted = scriptedClaudeCode();
  const resolve: ResolveClaudeAgent = async (...args) => {
    const agent = await scripted(...args);
    return {
      query: (query) => {
        models.push((query.options ?? ({} as ClaudeAgentQueryOptions)).model);
        return agent.query(query);
      },
    };
  };
  return { name: "Claude Code", flow: () => claudeCodeSessionFlow({ resolveClaudeAgent: resolve }) as never, models, fallback: undefined };
}

function codex(): Mode {
  const models: Array<string | undefined> = [];
  const scripted = scriptedCodex();
  const resolve: ResolveCodexClient = async (ctx) => {
    const client = await scripted(ctx);
    return {
      startThread: (options) => {
        models.push(options?.model);
        return client.startThread(options);
      },
      resumeThread: (id, options) => {
        models.push(options?.model);
        return client.resumeThread(id, options);
      },
    };
  };
  // A session with none runs Codex's own default, read off its list: whatever the installed Codex names.
  const fallback = expect.any(String) as unknown as string;
  return { name: "Codex", flow: () => codexSessionFlow({ resolveCodexClient: resolve }) as never, models, fallback };
}

function cursor(): Mode {
  const models: Array<string | undefined> = [];
  const scripted = scriptedCursor();
  const resolve: ResolveCursorClient = async (ctx) => {
    const client = await scripted(ctx);
    return {
      create: (options) => {
        models.push(options.model?.id);
        return client.create(options);
      },
      resume: (agentId, options) => {
        models.push(options.model?.id);
        return client.resume(agentId, options);
      },
    };
  };
  return { name: "Cursor", flow: () => cursorSessionFlow({ resolveCursorClient: resolve }) as never, models, fallback: CURSOR_DEFAULT_MODEL };
}

/** A turn on a session stored with `state` (seeded straight into the store, as one already born). */
async function turn(stores: Stores, mode: Mode, sessionId: string, state: Record<string, unknown>) {
  return testFlow({
    flow: mode.flow(),
    action: "turn",
    userId: "u",
    sessionId,
    input: { prompt: "hello" },
    stores,
    seed: { session: { state } },
  });
}

async function stateOf(stores: Stores, sessionId: string): Promise<Record<string, unknown>> {
  return ((await stores.session.get(sessionId))?.state ?? {}) as Record<string, unknown>;
}

describe.each([claudeCode, codex, cursor])("the model a session runs: %o", (make) => {
  it("hands the harness the session's model on the first turn and on the turn that resumes", async () => {
    const mode = make();
    const stores = createInMemoryStores();
    const first = await turn(stores, mode, "s-picked", { model: "picked-model" });
    const second = await turn(stores, mode, "s-picked", { model: "picked-model" });
    expect([first.status, second.status]).toEqual(["completed", "completed"]);
    // The second turn resumed: the conversation the first one bound.
    expect(((await stateOf(stores, "s-picked")) as HarnessSessionState).binding?.confirmed).toBeTruthy();
    expect(mode.models).toEqual(["picked-model", "picked-model"]);
    // Nothing a turn writes moves the model.
    expect((await stateOf(stores, "s-picked")).model).toBe("picked-model");
  });

  it("two sessions of one mode run two models", async () => {
    const mode = make();
    const stores = createInMemoryStores();
    await turn(stores, mode, "s-one", { model: "model-one" });
    await turn(stores, mode, "s-two", { model: "model-two" });
    expect(mode.models).toEqual(["model-one", "model-two"]);
  });

  it("a session stored before models could be picked runs on the mode's default, and its state stays without a model", async () => {
    const mode = make();
    const stores = createInMemoryStores();
    const result = await turn(stores, mode, "s-legacy", {});
    expect(result.status).toBe("completed");
    expect(mode.models).toEqual([mode.fallback]);
    expect(await stateOf(stores, "s-legacy")).not.toHaveProperty("model");
  });

  it("the ignore-model control hands the harness the mode's default, never the pick", async () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "ignore-model");
    const mode = make();
    const stores = createInMemoryStores();
    await turn(stores, mode, "s-control", { model: "picked-model" });
    expect(mode.models).toEqual([mode.fallback]);
  });
});

describe("a session is born naming its model, on every path that creates one", () => {
  function boot() {
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const mode = codex();
    registry.register(mode.flow());
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    return { router, stores, mode };
  }

  async function create(router: ReturnType<typeof boot>["router"], body: Record<string, unknown>) {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${CODEX_SESSION}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u", ...body }),
      }),
      { params: { path: [CODEX_SESSION, "sessions"] } },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function act(router: ReturnType<typeof boot>["router"], sessionId: string) {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/${CODEX_SESSION}/${sessionId}/actions/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { prompt: "hello" }, userId: "u", sessionId }),
      }),
      { params: { path: [CODEX_SESSION, sessionId, "actions", "turn"] } },
    );
    return res.status;
  }

  it("the create route refuses a session with no model, and nothing is written", async () => {
    const { router, stores } = boot();
    for (const state of [undefined, {}]) {
      const refused = await create(router, state === undefined ? {} : { state });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe(MODEL_REQUIRED);
    }
    // An empty id fails the state's own shape first.
    const empty = await create(router, { state: { model: "" } });
    expect(empty.status).toBe(400);
    expect(empty.body.field).toBe("model");
    expect(await stores.session.list({})).toHaveLength(0);
  });

  it("an action sent to a session that doesn't exist yet births none, and runs nothing", async () => {
    const { router, stores, mode } = boot();
    await act(router, "s-unborn");
    // Given the run time to start a harness, were it going to.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await stores.session.get("s-unborn")).toBeUndefined();
    expect(mode.models).toEqual([]);
  });

  it("a session created with a model keeps it, and its turn hands it to the harness", async () => {
    const { router, stores, mode } = boot();
    const created = await create(router, { state: { model: "gpt-5.6-terra" } });
    expect(created.status).toBeLessThan(300);
    const sessionId = String((created.body.session as { id?: string } | undefined)?.id ?? created.body.id);
    expect((await stateOf(stores, sessionId)).model).toBe("gpt-5.6-terra");

    expect(await act(router, sessionId)).toBeLessThan(300);
    const deadline = Date.now() + 10_000;
    while ((await stores.request.list({ sessionId })).some((r) => r.status === "in_progress") || mode.models.length === 0) {
      if (Date.now() > deadline) throw new Error("the turn never finished");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(mode.models).toEqual(["gpt-5.6-terra"]);
  });
});

describe("what each mode offers to pick", () => {
  it("Claude Code: its own list, by resolved id, its default preselected", async () => {
    const choices = await claudeCodeModelChoices(async () => ({
      status: "models",
      models: [
        { id: "claude-big-2", label: "Big", isDefault: true },
        { id: "claude-mid-5", label: "Mid", isDefault: false },
      ],
    }));
    expect(choices).toEqual({
      models: [
        { id: "claude-big-2", label: "Big" },
        { id: "claude-mid-5", label: "Mid" },
      ],
      defaultId: "claude-big-2",
      reason: null,
      fallbackId: null,
    });
  });

  it("Claude Code: a list that can't be read offers nothing, so no session is born without a concrete model", async () => {
    const choices = await claudeCodeModelChoices(async () => ({ status: "failed", reason: "no answer" }));
    expect(choices.models).toEqual([]);
    expect(choices.defaultId).toBeNull();
    expect(choices.reason).toMatch(/model list can't be read \(no answer\)/);
  });

  it("Codex: its own list for the sign-in a run gets, its default preselected", async () => {
    // A model the account can't run is one Codex leaves out, so New session never leads with it.
    const choices = await codexModelChoices(async () => ({
      status: "models",
      models: [
        { id: "gpt-b", label: "GPT-B", isDefault: true },
        { id: "gpt-a", label: "GPT-A", isDefault: false },
      ],
    }));
    expect(choices).toEqual({
      models: [
        { id: "gpt-b", label: "GPT-B" },
        { id: "gpt-a", label: "GPT-A" },
      ],
      defaultId: "gpt-b",
      reason: null,
      fallbackId: null,
    });
  });

  it("Codex: a list that can't be read offers nothing, and says why", async () => {
    const choices = await codexModelChoices(async () => ({ status: "failed", reason: "no answer" }));
    expect(choices.models).toEqual([]);
    expect(choices.defaultId).toBeNull();
    expect(choices.reason).toMatch(/Codex's model list can't be read \(no answer\)/);
  });

  it("Cursor: the hand-kept list, Composer 2.5 preselected, Auto offered as the default", async () => {
    const choices = await cursorModelChoices();
    expect(choices).toMatchObject({ defaultId: CURSOR_DEFAULT_MODEL, reason: null, fallbackId: CURSOR_DEFAULT_MODEL });
    expect(choices.models.map((model) => model.id)).toEqual([
      "grok-4.7:low", "grok-4.7:medium", "grok-4.7:high", "grok-4.7:xhigh",
      "composer-2.5", "gemini-4-argon", "muse-wonder-1.0", "kimi-k3", "glm-5p3", "glm-5p3-flash", "default",
    ]);
    // The preselected model is one the picker offers.
    expect(choices.models.map((model) => model.id)).toContain(choices.defaultId);
  });

  // Grok 4.7 is one model run at four efforts; the effort is part of the pick,
  // and Cursor takes it as the model's settings, not as a different id.
  it("Cursor: a Grok effort reaches Cursor as the model and its setting; every other pick is its own id", () => {
    expect(cursorModelSelection("grok-4.7:xhigh")).toEqual({
      id: "grok-4.7",
      params: [{ id: "reasoning_effort", value: "xhigh" }],
    });
    expect(cursorModelSelection("kimi-k3")).toBe("kimi-k3");
    expect(cursorModelSelection("default")).toBe("default");
    // An id Kitchen Sink doesn't know goes through: Cursor judges what it runs.
    expect(cursorModelSelection("some-new-model")).toBe("some-new-model");
    expect(cursorModelSelection(undefined)).toBeUndefined();
  });

  it("Cursor: a session picked on a Grok effort runs the model at that effort, on the first turn and on the resume", async () => {
    const selections: unknown[] = [];
    const scripted = scriptedCursor();
    const resolve: ResolveCursorClient = async (ctx) => {
      const client = await scripted(ctx);
      return {
        create: (options) => (selections.push(options.model), client.create(options)),
        resume: (agentId, options) => (selections.push(options.model), client.resume(agentId, options)),
      };
    };
    const mode: Mode = { name: "Cursor", flow: () => cursorSessionFlow({ resolveCursorClient: resolve }) as never, models: [], fallback: CURSOR_DEFAULT_MODEL };
    const stores = createInMemoryStores();
    await turn(stores, mode, "s-grok", { model: "grok-4.7:high" });
    await turn(stores, mode, "s-grok", { model: "grok-4.7:high" });
    const high = { id: "grok-4.7", params: [{ id: "reasoning_effort", value: "high" }] };
    expect(selections).toEqual([high, high]);
  });

  it("a full list is kept until restart; a short one is asked for again", async () => {
    let asked = 0;
    const full: ModelChoices = { models: [{ id: "a", label: "A" }], defaultId: "a", reason: null, fallbackId: null };
    const short: ModelChoices = { models: [], defaultId: null, reason: "down", fallbackId: null };
    const answers = [short, full, short];
    const lists = { "claude-code": async () => answers[asked++]!, codex: codexModelChoices, cursor: async () => full };
    expect(await harnessModelChoices("claude-code", lists)).toBe(short);
    expect(await harnessModelChoices("claude-code", lists)).toBe(full);
    expect(await harnessModelChoices("claude-code", lists)).toBe(full);
    expect(asked).toBe(2);
  });

  it("page loads during a read share it, so Claude Code is started once; a failed read is asked for again", async () => {
    let asked = 0;
    let answer!: (choices: ModelChoices) => void;
    const full: ModelChoices = { models: [{ id: "a", label: "A" }], defaultId: "a", reason: null, fallbackId: null };
    const lists = {
      "claude-code": () => {
        asked += 1;
        return new Promise<ModelChoices>((resolve) => (answer = resolve));
      },
      codex: codexModelChoices,
      cursor: async () => full,
    };
    const first = harnessModelChoices("claude-code", lists);
    const second = harnessModelChoices("claude-code", lists);
    expect(asked).toBe(1);
    answer({ models: [], defaultId: null, reason: "down", fallbackId: null });
    expect((await first).reason).toBe("down");
    expect((await second).reason).toBe("down");

    const retry = harnessModelChoices("claude-code", lists);
    expect(asked).toBe(2);
    answer(full);
    expect(await retry).toBe(full);
    expect(await harnessModelChoices("claude-code", lists)).toBe(full);
    expect(asked).toBe(2);
  });
});
