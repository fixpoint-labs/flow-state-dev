/**
 * What every worker is told after its own text: today's date, and, when it
 * holds a skill it can load, the list of its skills with one line telling it
 * to load one that fits.
 *
 * Why these matter: a worker that guesses the date gets every time-sensitive
 * ask wrong, and a worker that holds a fitting skill but is never shown it
 * answers without it. Both used to be each app's job to write; these pin that
 * the built-in worker flow does it, that a worker can turn either off, and that
 * a worker holding no skill pays nothing for the second.
 *
 * Asserted on what the model is handed, never on a section's wording beyond
 * the one line the layer defines: the date is checked against the clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";
import type { FlowInstance, InitialSkill } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { mintWorkers, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import {
  SKILLS_INDEX_LINE,
  WORKER_DEFAULT_LAYER_CEILING,
  formatWorkerDate,
  workerDate,
} from "../src/worker-default-layer";
import { workerDate as rootWorkerDate } from "../src/index";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hire(manifests: WorkerManifest[], flows: HireOptions["workerFlows"] = {}): FlowInstance[] {
  return mintWorkers(manifests, { workerFlows: flows });
}

function refusalOf(manifests: WorkerManifest[]): string {
  try {
    mintWorkers(manifests, { workerFlows: {} });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got workers");
}

const writeRegression: InitialSkill = {
  name: "write-regression",
  skillMd: ["---", "description: Cover a flaky test with a regression test", "---", "", "MARKER-WRITE-REGRESSION"].join(
    "\n",
  ),
};

/** Both answering generators, so a test never has to know which arm ran. */
function answerMocks(script: Array<Record<string, unknown>> = [{ text: "done" }]) {
  return {
    "agent-answer": mockGenerator({ name: "agent-answer", script: script as never }),
    "agent-answer-with-activate-tool": mockGenerator({
      name: "agent-answer-with-activate-tool",
      script: script as never,
    }),
  };
}

async function runTurn(worker: FlowInstance, message = "what's today's date?", generators = answerMocks()) {
  const runtime = await createTestContext({
    flow: { ...worker, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: `session-${worker.id}`,
    sequencerName: worker.actions.respond!.block.name,
    declaredResources: worker.actions.respond!.block.declaredResources,
    generators,
  });
  const result = await executeBlock({ block: worker.actions.respond.block, input: { message }, ctx: runtime.ctx });
  expect(result.error).toBeUndefined();
  const ran = Object.values(generators).filter((g) => g.calls.length > 0);
  expect(ran).toHaveLength(1);
  return { ran: ran[0]!, runtime };
}

/** The system message the model was handed on the first call. */
function systemOf(gen: ReturnType<typeof mockGenerator>): string {
  const messages = gen.calls[0]?.input as Array<{ role: string; content: string }> | undefined;
  return messages?.find((m) => m.role === "system")?.content ?? "";
}

/** Skill names activated on the session by the end of the turn. */
function activated(runtime: { ctx: unknown }): string[] {
  const entries = (runtime.ctx as { session?: { state?: Record<string, unknown> } }).session?.state?.activeSkills;
  return Array.isArray(entries) ? entries.map((e: { name: string }) => e.name) : [];
}

const SERVER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** `YYYY-MM-DD` of `now` in the server's zone: the day the server is on. */
function serverDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SERVER_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    now,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The date block
// ---------------------------------------------------------------------------

describe("the date block", () => {
  it("tells a worker today's date, its weekday and the server's time zone, after the worker's own text", async () => {
    // Far from the real clock, so the import-time date can't match by accident.
    const now = new Date(Date.UTC(2031, 0, 15, 12));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);

    const [worker] = hire([record({ id: "desk.agent", body: "MARKER-WORKER-TEXT" })]);
    const { ran } = await runTurn(worker!);
    const system = systemOf(ran);

    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: SERVER_ZONE, weekday: "long" }).format(now);
    const date = system.slice(system.indexOf("<date>"), system.indexOf("</date>"));
    expect(date).toContain(serverDay(now));
    expect(date).toContain(weekday);
    expect(date).toContain(SERVER_ZONE);
    // After what the worker wrote: the start of the prompt does not move day to day.
    expect(system.indexOf("MARKER-WORKER-TEXT")).toBeGreaterThanOrEqual(0);
    expect(system.indexOf("<date>")).toBeGreaterThan(system.indexOf("MARKER-WORKER-TEXT"));
    expect(system.startsWith("MARKER-WORKER-TEXT")).toBe(true);
  });

  // A long-lived server: a date read when the module loaded would go stale
  // after midnight, so the block is read on every turn.
  it("tells the model the date of the turn, not the date the server started", async () => {
    const first = new Date(Date.UTC(2031, 0, 15, 12));
    const second = new Date(Date.UTC(2031, 5, 20, 12));
    vi.useFakeTimers({ toFake: ["Date"] });
    const [worker] = hire([record({ id: "desk.agent", body: "You help." })]);

    vi.setSystemTime(first);
    expect(systemOf((await runTurn(worker!)).ran)).toContain(serverDay(first));

    vi.setSystemTime(second);
    const later = systemOf((await runTurn(worker!)).ran);
    expect(later).toContain(serverDay(second));
    expect(later).not.toContain(serverDay(first));
  });

  it("is the same block the package exports for a standalone generator", () => {
    expect(rootWorkerDate).toBe(workerDate);
    const now = new Date(Date.UTC(2031, 5, 20, 12));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    expect(workerDate()).toBe(formatWorkerDate(now, SERVER_ZONE));
    expect(workerDate()).toContain(serverDay(now));
  });

  it("reads the day in the zone it names, not in UTC", () => {
    // 23:30 UTC on Jan 15 is already Jan 16 in Tokyo and still Jan 15 in Los Angeles.
    const now = new Date(Date.UTC(2031, 0, 15, 23, 30));
    expect(formatWorkerDate(now, "Asia/Tokyo")).toContain("2031-01-16");
    expect(formatWorkerDate(now, "Asia/Tokyo")).toContain("Thursday");
    expect(formatWorkerDate(now, "America/Los_Angeles")).toContain("2031-01-15");
    expect(formatWorkerDate(now, "America/Los_Angeles")).toContain("Wednesday");
  });

  it("joins a line an app's capability writes under `date`, inside the same block", async () => {
    const userZone = defineCapability({
      name: "user-time-zone",
      presets: { defaults: { context: () => ({ date: "MARKER-APP-DATE-LINE" }) } },
    });
    const flow = defineAgentWorkerFlow({ uses: [userZone] });
    const [worker] = hire([record({ id: "desk.agent", body: "You help." })], { [AGENT_FLOW]: flow });
    const system = systemOf((await runTurn(worker!)).ran);

    const open = system.indexOf("<date>");
    const close = system.indexOf("</date>");
    const line = system.indexOf("MARKER-APP-DATE-LINE");
    // One block, the framework's date first and the app's line after it.
    expect(system.split("<date>")).toHaveLength(2);
    expect(line).toBeGreaterThan(open);
    expect(line).toBeLessThan(close);
    const day = system.indexOf(serverDay(new Date()));
    expect(day).toBeGreaterThan(open);
    expect(day).toBeLessThan(line);
  });

  it("is left out for a worker whose `defaults` turns it off", async () => {
    const [worker] = hire([record({ id: "desk.agent", declared: { defaults: { date: false } }, body: "You help." })]);
    expect(systemOf((await runTurn(worker!)).ran)).not.toContain("<date>");
  });
});

// ---------------------------------------------------------------------------
// The skills index
// ---------------------------------------------------------------------------

describe("the skills index", () => {
  const loadThenAnswer = () =>
    answerMocks([
      { toolCalls: [{ toolCallId: "c1", toolName: "loadSkill", args: { name: "write-regression" } }] },
      { text: "done" },
    ]);

  it("shows a worker that holds a skill its list and the line, and lets it load one, with no switch set", async () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { ran, runtime } = await runTurn(worker!, "the login test flakes", loadThenAnswer());
    const system = systemOf(ran);

    expect(ran.name).toBe("agent-answer-with-activate-tool");
    const skills = system.slice(system.indexOf("<skills>"), system.indexOf("</skills>"));
    expect(skills).toContain("write-regression");
    expect(skills).toContain(SKILLS_INDEX_LINE);
    expect(activated(runtime)).toEqual(["write-regression"]);
  });

  it("charges a worker that holds no skill nothing: no list, no line, no load tool", async () => {
    const [worker] = hire([record({ id: "desk.agent", body: "You help." })]);
    const { ran } = await runTurn(worker!);
    const system = systemOf(ran);

    // The plain arm: no load tool is installed, not merely unadvertised.
    expect(ran.name).toBe("agent-answer");
    expect(system).not.toContain("<skills>");
    expect(system).not.toContain(SKILLS_INDEX_LINE);
    expect(system).not.toContain("loadSkill");
  });

  it("is left out, list, line and load tool, for a worker whose `defaults` turns it off", async () => {
    const [worker] = hire([
      record({ id: "qa.tester", declared: { defaults: { skillsIndex: false } }, body: "You test.", skills: [writeRegression] }),
    ]);
    const { ran, runtime } = await runTurn(worker!, "the login test flakes", loadThenAnswer());

    expect(ran.name).toBe("agent-answer");
    expect(systemOf(ran)).not.toContain(SKILLS_INDEX_LINE);
    expect(systemOf(ran)).not.toContain("loadSkill");
    expect(activated(runtime)).toEqual([]);
  });

  // BP-030: a config written before the default flipped keeps what it set.
  it("keeps a worker's own `skills.activateTool: false`, whatever `defaults` says", async () => {
    const [worker] = hire([
      record({ id: "qa.tester", declared: { skills: { activateTool: false } }, body: "You test.", skills: [writeRegression] }),
    ]);
    const { ran } = await runTurn(worker!, "the login test flakes", loadThenAnswer());

    expect(ran.name).toBe("agent-answer");
    expect(systemOf(ran)).not.toContain(SKILLS_INDEX_LINE);
  });

  it("keeps a worker's own `skills.activateTool: true` with `defaults: false`, and adds no line", async () => {
    const [worker] = hire([
      record({
        id: "qa.tester",
        declared: { defaults: false, skills: { activateTool: true } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);
    const { ran, runtime } = await runTurn(worker!, "the login test flakes", loadThenAnswer());

    expect(ran.name).toBe("agent-answer-with-activate-tool");
    expect(systemOf(ran)).toContain("loadSkill");
    expect(systemOf(ran)).not.toContain(SKILLS_INDEX_LINE);
    expect(activated(runtime)).toEqual(["write-regression"]);
  });
});

// ---------------------------------------------------------------------------
// The coordinator runs the same turn
// ---------------------------------------------------------------------------

describe("on the coordinator flow, on an installation", () => {
  it("tells a coordinator today's date, and shows it the skills it holds with the line", async () => {
    const triage = { name: "triage", skillMd: "---\nname: triage\ndescription: How to triage incoming work.\n---\nSort it." };
    const standard = boardWorkers().map((worker) => (worker.id === "lead" ? { ...worker, skills: [triage] } : worker));
    const host = bootBoardHost({ standard, judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }) });
    try {
      const conv = await host.conversation("alice", "lead");
      const result = await host.act("alice", conv, "respond", { message: "what's today's date?" });
      await host.settled();
      expect(result.error, messageOf(result.error)).toBeUndefined();
      const heard = JSON.stringify(host.judgment.calls.map((call) => call.input));
      expect(heard).toContain("<date>");
      expect(heard).toContain(serverDay(new Date()));
      expect(heard).toContain(SKILLS_INDEX_LINE);
    } finally {
      await host.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// The `defaults` key
// ---------------------------------------------------------------------------

describe("`defaults` in a worker's config", () => {
  it("gives today's prompt back with `defaults: false`: no date, no list, no line", async () => {
    const [worker] = hire([
      record({ id: "qa.tester", declared: { defaults: false }, body: "You test.", skills: [writeRegression] }),
    ]);
    const { ran } = await runTurn(worker!, "the login test flakes");
    const system = systemOf(ran);

    expect(ran.name).toBe("agent-answer");
    expect(system).not.toContain("<date>");
    expect(system).not.toContain("loadSkill");
    expect(system).not.toContain(SKILLS_INDEX_LINE);
  });

  // `defaults` is a contract key, so an app's own worker flow meets it the way
  // it meets every other: composing the contract takes it for free, and a flow
  // that hand-declares the keys is refused at boot, by name, until it adds it.
  describe("on an app's own worker flow", () => {
    const work = handler({
      name: "custom-work",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const customFlow = (configSchema: z.AnyZodObject) =>
      defineFlow({ kind: "request-triage", cardinality: "collection", configSchema, actions: { ...workerDoor, run: work } });
    const onCustom = (declared: Record<string, unknown>) =>
      record({ id: "ops.router", declared: { flow: "request-triage", ...declared }, body: "Route." });

    it("hires a worker whose file sets `defaults` on a flow that composes the contract, and ignores it", () => {
      const flow = customFlow(workerConfigSchema().extend({ desk: z.string().default("front") }));
      const [worker] = hire([onCustom({ defaults: false })], { "request-triage": flow as never });
      expect(worker!.config).toMatchObject({ defaults: false, desk: "front" });
    });

    it("refuses a flow that hand-declares the contract without `defaults`, naming the key, and hires nothing", () => {
      const flow = customFlow(
        z.object({
          instructions: z.string().optional(),
          teamInstructions: z.string().optional(),
          workerSkills: z.array(z.any()).default([]),
          workerTools: z.array(z.any()).default([]),
          workerPackages: z.array(z.any()).optional(),
          workerId: z.string().optional(),
          delegates: z.array(z.string()).default([]),
        }),
      );
      let message = "";
      try {
        hire([onCustom({})], { "request-triage": flow as never });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('worker flow "request-triage"');
      expect(message).toContain("doesn't accept `defaults`");
      expect(message).toContain("workerConfigSchema()");
      expect(message).toContain("nothing was hired");
    });
  });

  it("refuses a section it does not know, by name, at the mint", () => {
    const message = refusalOf([record({ id: "desk.agent", declared: { defaults: { calendar: false } }, body: "You help." })]);
    expect(message).toContain('worker "desk.agent"');
    expect(message).toContain("calendar");
  });
});

// ---------------------------------------------------------------------------
// The ceiling (epic ER-1)
// ---------------------------------------------------------------------------

describe("the default layer's fixed text", () => {
  it(`stays under ${WORKER_DEFAULT_LAYER_CEILING} characters with its longest values`, () => {
    const zones = Intl.supportedValuesOf("timeZone");
    const longestZone = zones.reduce((a, b) => (b.length > a.length ? b : a));
    // Every day of a year, so the longest weekday and month are both in it.
    let longestDate = "";
    for (let day = 0; day < 366; day += 1) {
      const text = formatWorkerDate(new Date(Date.UTC(2031, 0, 1 + day, 12)), longestZone);
      if (text.length > longestDate.length) longestDate = text;
    }
    const fixed = [longestDate, SKILLS_INDEX_LINE].join("\n");

    expect(WORKER_DEFAULT_LAYER_CEILING).toBe(1600);
    expect(fixed.length).toBeLessThanOrEqual(WORKER_DEFAULT_LAYER_CEILING);
  });
});
