/**
 * The path this lab exists to prove: a declared door runs the host-selected
 * harness through host resolvers. cwd/session are not taken from action input.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemStores, createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../../../packages/cursor/src/agent";
import { TESTED_SDK_VERSION } from "@flow-state-dev/cursor";
import { createFsdCodingFlow } from "../src/flow";
import { DOOR_PREFIX, DOORS, FLOW_KIND } from "../src/schemas";
import { scriptedClaude } from "./scripted-claude";
import { scriptedCursor } from "./scripted-cursor";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

const USER = "lab-user";
const HOST_CWD = "/work/checkout";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function flowWith(recursor: ReturnType<typeof scriptedCursor>, extras: { model?: string } = {}) {
  return createFsdCodingFlow({
    cwd: HOST_CWD,
    model: extras.model,
    cursor: { ...GATE_OFF, resolveCursorClient: recursor.resolve },
  });
}

describe("fsd-coding flow wiring", () => {
  it("declares exactly the four static doors on one singleton flow kind", () => {
    const { resolve } = scriptedCursor();
    const flow = createFsdCodingFlow({
      cwd: HOST_CWD,
      cursor: { ...GATE_OFF, resolveCursorClient: resolve },
    });
    expect(flow.kind).toBe(FLOW_KIND);
    expect(flow.id).toBe(FLOW_KIND);
    expect(Object.keys(flow.actions).sort()).toEqual([...DOORS].sort());
  });

  it("implement sends the task through Cursor in the host cwd", async () => {
    const scripted = scriptedCursor();
    const result = await testFlow({
      flow: flowWith(scripted),
      action: "implement",
      userId: USER,
      input: { task: "add a smoke test" },
    });

    expect(result.status).toBe("completed");
    expect(scripted.rec.created).toHaveLength(1);
    expect(scripted.rec.created[0]).toMatchObject({
      local: { cwd: HOST_CWD },
      model: { id: "composer-2.5" },
    });
    expect(scripted.rec.sent[0].prompt).toContain(DOOR_PREFIX.implement);
    expect(scripted.rec.sent[0].prompt).toContain("add a smoke test");
    expect(result.output).toMatchObject({
      source: "cursor/sdk",
      status: "completed",
      sessionId: "agent_1",
      outcome: "finished",
    });
  });

  it("onSession persists the Cursor agent id so the next door on the same stores resumes", async () => {
    const scripted = scriptedCursor();
    const flow = flowWith(scripted);
    const stores = createInMemoryStores();

    const first = await testFlow({
      flow,
      action: "implement",
      userId: USER,
      sessionId: "resume-me",
      input: { task: "first cut" },
      stores,
    });
    expect(first.status).toBe("completed");
    expect(scripted.rec.created).toHaveLength(1);

    const second = await testFlow({
      flow,
      action: "fix",
      userId: USER,
      sessionId: "resume-me",
      input: { task: "the test is red" },
      stores,
    });

    expect(second.status).toBe("completed");
    expect(scripted.rec.created).toHaveLength(1);
    expect(scripted.rec.resumed).toHaveLength(1);
    expect(scripted.rec.resumed[0].id).toBe("agent_1");
    expect(scripted.rec.resumed[0].options).toMatchObject({ local: { cwd: HOST_CWD } });
    expect(scripted.rec.sent[1].prompt).toContain(DOOR_PREFIX.fix);
  });

  it("filesystemStores + a new flow instance resume the same --session without a sidecar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsd-coding-fs-"));
    dirs.push(dir);
    const stores = createFilesystemStores({ rootDir: dir, developmentOnly: true });
    const scripted = scriptedCursor();

    const first = await testFlow({
      flow: createFsdCodingFlow({
        cwd: HOST_CWD,
        cursor: { ...GATE_OFF, resolveCursorClient: scripted.resolve },
      }),
      action: "implement",
      userId: USER,
      sessionId: "work-1",
      input: { task: "first cut" },
      stores,
    });
    expect(first.status).toBe("completed");
    expect(scripted.rec.created).toHaveLength(1);

    const second = await testFlow({
      flow: createFsdCodingFlow({
        cwd: HOST_CWD,
        cursor: { ...GATE_OFF, resolveCursorClient: scripted.resolve },
      }),
      action: "fix",
      userId: USER,
      sessionId: "work-1",
      input: { task: "the test is red" },
      stores,
    });

    expect(second.status).toBe("completed");
    expect(scripted.rec.created).toHaveLength(1);
    expect(scripted.rec.resumed.map((entry) => entry.id)).toEqual(["agent_1"]);
  });

  it("fixFsd stamps the self-heal prefix and the repro, not the original task", async () => {
    const scripted = scriptedCursor();
    const result = await testFlow({
      flow: flowWith(scripted),
      action: "fixFsd",
      userId: USER,
      input: { repro: "cursorAgent: SDK version mismatch", notes: "hit on implement" },
    });

    expect(result.status).toBe("completed");
    expect(scripted.rec.sent[0].prompt).toContain(DOOR_PREFIX.fixFsd);
    expect(scripted.rec.sent[0].prompt).toContain("cursorAgent: SDK version mismatch");
    expect(scripted.rec.sent[0].prompt).toContain("hit on implement");
    expect(scripted.rec.sent[0].prompt).not.toContain(DOOR_PREFIX.implement);
  });

  it("openPr is a declared door through the same Cursor harness", async () => {
    const scripted = scriptedCursor();
    const result = await testFlow({
      flow: flowWith(scripted),
      action: "openPr",
      userId: USER,
      input: { task: "open the PR for the smoke test" },
    });

    expect(result.status).toBe("completed");
    expect(scripted.rec.sent[0].prompt).toContain(DOOR_PREFIX.openPr);
    expect(scripted.rec.created[0]).toMatchObject({ local: { cwd: HOST_CWD } });
  });

  it("a smuggled cwd on the action input does not move the Cursor working directory", async () => {
    const scripted = scriptedCursor();
    await testFlow({
      flow: flowWith(scripted),
      action: "implement",
      userId: USER,
      input: { task: "do it", cwd: "/evil/path" } as { task: string },
    });

    expect(scripted.rec.created[0]).toMatchObject({ local: { cwd: HOST_CWD } });
    expect(JSON.stringify(scripted.rec.created[0])).not.toContain("/evil/path");
  });

  it("host model override reaches Cursor agent.model.id", async () => {
    const scripted = scriptedCursor();
    await testFlow({
      flow: flowWith(scripted, { model: "composer-custom" }),
      action: "implement",
      userId: USER,
      input: { task: "use the host model" },
    });

    expect(scripted.rec.created[0]).toMatchObject({ model: { id: "composer-custom" } });
  });
});

describe("fsd-coding flow wiring — Claude", () => {
  function flowWithClaude(recursor: ReturnType<typeof scriptedClaude>, extras: { model?: string } = {}) {
    return createFsdCodingFlow({
      cwd: HOST_CWD,
      harness: "claude",
      model: extras.model,
      claude: { resolveClaudeAgent: recursor.resolve },
    });
  }

  it("implement sends the task through Claude in the host cwd", async () => {
    const scripted = scriptedClaude();
    const result = await testFlow({
      flow: flowWithClaude(scripted),
      action: "implement",
      userId: USER,
      input: { task: "add a smoke test" },
    });

    expect(result.status).toBe("completed");
    expect(scripted.rec.cwd).toEqual([HOST_CWD]);
    expect(scripted.rec.resume).toEqual([undefined]);
    expect(scripted.rec.prompts[0]).toContain(DOOR_PREFIX.implement);
    expect(scripted.rec.prompts[0]).toContain("add a smoke test");
    expect(result.output).toMatchObject({
      source: "claude-code/sdk",
      status: "completed",
      sessionId: "sess_claude",
      outcome: "finished",
    });
  });

  it("onSession persists the Claude session id so the next door on the same stores resumes", async () => {
    const scripted = scriptedClaude();
    const flow = flowWithClaude(scripted);
    const stores = createInMemoryStores();

    const first = await testFlow({
      flow,
      action: "implement",
      userId: USER,
      sessionId: "resume-claude",
      input: { task: "first cut" },
      stores,
    });
    expect(first.status).toBe("completed");
    expect(scripted.rec.resume).toEqual([undefined]);

    const second = await testFlow({
      flow,
      action: "fix",
      userId: USER,
      sessionId: "resume-claude",
      input: { task: "the test is red" },
      stores,
    });

    expect(second.status).toBe("completed");
    expect(scripted.rec.cwd).toEqual([HOST_CWD, HOST_CWD]);
    expect(scripted.rec.resume).toEqual([undefined, "sess_claude"]);
    expect(scripted.rec.prompts[1]).toContain(DOOR_PREFIX.fix);
  });

  it("host model override reaches Claude query options", async () => {
    const scripted = scriptedClaude();
    await testFlow({
      flow: flowWithClaude(scripted, { model: "claude-sonnet-4-6" }),
      action: "implement",
      userId: USER,
      input: { task: "use the host model" },
    });

    expect(scripted.rec.options[0]).toMatchObject({ model: "claude-sonnet-4-6" });
  });
});
