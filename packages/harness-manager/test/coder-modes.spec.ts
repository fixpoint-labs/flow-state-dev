/**
 * The coding worker flow's modes and the app's own part of it.
 *
 * An app names the ways a coding run can work (`modes`): each its own brief,
 * done check and workspace. Shift Manager needs two, `implement` and `answer`,
 * so it can run on the shared flow instead of a copy of it. An app that names
 * none keeps the kit's one `default` mode, its run names and its stored keys.
 * Configuration is refused when the app starts, naming the mode, so a typo
 * never reaches a paid run. The app's own settings, documents and actions ride
 * on the flow, and the flow never reads them.
 *
 * Graded on what the kit builds and refuses at start, and on which mode a
 * task's input selects.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workerMessagesResources } from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { z } from "zod";
import type { Harness } from "../src/harness";
import type { CompletionRunContext, ModeSpec, PromptRunContext } from "../src/manager";
import { scriptedHarness } from "../src/scripted-harness";
import { modeOfTask, resolveCoderModes, runModeOfTask } from "../src/kit/coder-modes";

/** What each harness manager the kit builds is configured with, and the block it built. */
const managerConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const managerBlocks = vi.hoisted(() => new Map<unknown, string>());
vi.mock("../src/manager", async (original) => {
  const actual = await original<typeof import("../src/manager")>();
  return {
    ...actual,
    harnessManager: (config: Record<string, unknown>) => {
      managerConfigs.push(config);
      const block = actual.harnessManager(config as never);
      managerBlocks.set(block, config.name as string);
      return block;
    },
  };
});
/** Every router the kit builds, by name: the mode router's `execute` is what picks a task's manager. */
const routers = vi.hoisted(() => new Map<string, { execute: (input: unknown, ctx?: unknown) => unknown }>());
vi.mock("@flow-state-dev/core", async (original) => {
  const actual = await original<typeof import("@flow-state-dev/core")>();
  return {
    ...actual,
    router: (config: { name: string; execute: (input: unknown) => unknown }) => {
      routers.set(config.name, config);
      return actual.router(config as never);
    },
  };
});

const { harnesses, codingDrainBudgetMs } = await import("../src/kit");
const { codingModes } = await import("../src/kit/coder-flow");

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  managerConfigs.splice(0);
  managerBlocks.clear();
  routers.clear();
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function team(extra = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-coder-modes-"));
  dirs.push(dir);
  const file = join(dir, "teams/core/workers/codex/WORKER.md");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `---\nname: Codex\ndescription: Codex.\nflow: coder\nharness: codex\n${extra}---\nYou are Codex.`);
  return dir;
}

const harness: Harness = { id: "codex", label: "Codex", agent: scriptedHarness({ stepEveryMs: 1 }).slot, readiness: async () => ({ ready: true }), pass: [] };
const host = (name: string) =>
  localWorkspaceHost({ root: join(tmpdir(), `fsd-coder-modes-${name}`), remotes: { allow: [] }, source: () => ({ kind: "repo", repo: tmpdir() }) });
const workspace = host("runs");
const answers = host("answers");

/** Start the app; answers what it was refused with, when built or at `ready()`, or "started". */
async function start(config: Partial<Parameters<typeof harnesses>[0]>, extra = ""): Promise<string> {
  let state: FlowState;
  try {
    state = createFlowState({
      kits: [harnesses({ workspace, ...config }), workforce({ directory: team(extra) })],
      fill: { [harnesses.slots.harnesses]: [harness] },
      stores: { default: { primary: inMemoryStores() } },
    });
  } catch (refused) {
    return (refused as Error).message;
  }
  states.push(state);
  return state.ready().then(
    () => "started",
    (error: Error) => error.message,
  );
}

const brief = (text: string) => (_run: PromptRunContext) => text;
const committed = (run: CompletionRunContext) => run.stopReport === "finished";
const kitMode: ModeSpec = { name: "default", formerName: "code", instructions: brief("kit brief"), doneWhen: { check: () => true } };
const shiftManager = {
  modes: {
    implement: { instructions: brief("implement brief"), doneWhen: committed, requires: ["issue" as const] },
    answer: { instructions: brief("answer brief"), doneWhen: { check: committed, timeoutMs: 5_000 }, workspace: answers },
  },
  defaultMode: "answer",
};

describe("an app that registers no modes", () => {
  it("runs the kit's one mode, under the names and stored key its runs always had", async () => {
    expect(await start({})).toBe("started");
    expect(managerConfigs.map((config) => config.name).sort()).toEqual(["coder-codex", "coder-codex-reviewed"]);
    for (const config of managerConfigs) {
      expect((config.mode as ModeSpec).name).toBe("default");
      expect((config.mode as ModeSpec).formerName).toBe("code");
      expect(config.workspace).toBe(workspace);
      expect(config.approveTools).toBeUndefined();
    }
  });

  it("keeps the kit's done check and former name when it replaces only the default mode's brief", () => {
    const { modes } = resolveCoderModes({ modes: { default: { instructions: brief("docs only") } } }, kitMode, "coder");
    expect(Object.keys(modes)).toEqual(["default"]);
    expect(modes.default!.spec.instructions({} as never)).toBe("docs only");
    expect(modes.default!.spec.doneWhen).toBe(kitMode.doneWhen);
    expect(modes.default!.spec.formerName).toBe("code");
    expect(modes.default!.workspace).toBeUndefined();
  });
});

describe("an app that registers its modes", () => {
  it("builds a manager per mode, each with its own brief, done check and workspace, and none for the kit's", async () => {
    expect(await start(shiftManager)).toBe("started");
    const byName = Object.fromEntries(managerConfigs.map((config) => [config.name as string, config]));
    expect(Object.keys(byName).sort()).toEqual(["coder-codex-answer", "coder-codex-answer-reviewed", "coder-codex-implement", "coder-codex-implement-reviewed"]);
    const implement = byName["coder-codex-implement"]!;
    const answer = byName["coder-codex-answer"]!;
    expect((implement.mode as ModeSpec).name).toBe("implement");
    expect(await (implement.mode as ModeSpec).instructions({} as never)).toBe("implement brief");
    // A bare function stands for the done check alone.
    expect((implement.mode as ModeSpec).doneWhen.check).toBe(committed);
    expect(implement.workspace).toBe(workspace);
    expect((answer.mode as ModeSpec).name).toBe("answer");
    expect((answer.mode as ModeSpec).doneWhen.timeoutMs).toBe(5_000);
    expect(answer.workspace).toBe(answers);
    // A mode's own workspace carries the project collections by the kit's rule: only with `project`.
    expect(answer.uses).toBeUndefined();
    expect(implement.uses).toBeUndefined();
  });

  it("gives every mode's manager the project collections when the kit's `project` is on, its own workspace or not", async () => {
    expect(await start({ ...shiftManager, project: true })).toBe("started");
    expect(managerConfigs.length).toBe(4);
    for (const config of managerConfigs) expect(config.uses).toBeDefined();
  });

  it("keeps each mode's requires for the filing check", () => {
    const { modes } = resolveCoderModes(shiftManager, kitMode, "coder");
    expect(modes.implement!.requires).toEqual(["issue"]);
    expect(modes.answer!.requires).toEqual([]);
  });

  it("wraps every mode in the kit's checks, and a shutdown waits for the longest", () => {
    const checks = { commands: ["true"], timeoutMs: 90_000 };
    const resolved = codingModes({ ...shiftManager, checks });
    for (const mode of Object.values(resolved.modes)) expect(mode.spec.doneWhen.timeoutMs).toBeGreaterThan(90_000);
    expect(codingDrainBudgetMs({ ...shiftManager, checks })).toBeGreaterThan(codingDrainBudgetMs({ ...shiftManager }));
  });

  it("hands a feature task to the implement manager and any other task to the answer manager", async () => {
    expect(await start(shiftManager)).toBe("started");
    const pick = (input: unknown, reviewed = "") => managerBlocks.get(routers.get(`coder-codex-by-mode${reviewed}`)!.execute({ input }));
    expect(pick({ harnessFeature: { issue: "FIX-12" } })).toBe("coder-codex-implement");
    expect(pick({ description: "Why?" })).toBe("coder-codex-answer");
    expect(pick({ harnessFeature: { issue: "FIX-12" } }, "-reviewed")).toBe("coder-codex-implement-reviewed");
    expect(pick({}, "-reviewed")).toBe("coder-codex-answer-reviewed");
  });

  it("forwards approveTools to every manager", async () => {
    expect(await start({ ...shiftManager, approveTools: true })).toBe("started");
    expect(managerConfigs.length).toBe(4);
    for (const config of managerConfigs) expect(config.approveTools).toBe(true);
  });
});

describe("which mode a task runs", () => {
  const registered = resolveCoderModes(shiftManager, kitMode, "coder");
  const kitOnly = resolveCoderModes({}, kitMode, "coder");

  it("runs a task carrying the feature marker as implement, and every other task in the default mode", () => {
    expect(modeOfTask({ harnessFeature: { issue: "FIX-12" } }, registered)).toBe("implement");
    expect(modeOfTask({ issue: "the problem", description: "Why?" }, registered)).toBe("answer");
    expect(modeOfTask(undefined, registered)).toBe("answer");
    // A malformed marker goes to implement, which refuses it in the run; it never runs as an answer.
    expect(modeOfTask({ harnessFeature: { phase: "implement" } }, registered)).toBe("implement");
  });

  it("runs a feature task in the kit's mode when the app registers no implement", () => {
    expect(modeOfTask({ harnessFeature: { issue: "FIX-12" } }, kitOnly)).toBe("default");
  });

  it("finds a feature task's run under its own phase, and a malformed one's nowhere", () => {
    expect(runModeOfTask({ harnessFeature: { issue: "FIX-12", phase: "code" } }, kitOnly)).toEqual({ name: "code" });
    expect(runModeOfTask({ harnessFeature: { issue: "FIX-12" } }, kitOnly)).toMatchObject({ name: "default", formerName: "code" });
    expect(runModeOfTask({ harnessFeature: { phase: "x" } }, registered)).toBeUndefined();
    expect(runModeOfTask({}, registered)).toMatchObject({ name: "answer" });
  });
});

describe("modes are refused at start, naming the mode", () => {
  it("refuses a defaultMode that isn't registered, naming the modes there are", async () => {
    const refused = await start({ ...shiftManager, defaultMode: "review" });
    expect(refused).toContain('the default mode is "review"');
    expect(refused).toContain('"implement", "answer"');
  });

  it("refuses modes without a default when no defaultMode names one", async () => {
    const refused = await start({ modes: shiftManager.modes });
    expect(refused).toContain('the default mode is "default" (no `defaultMode` is set)');
  });

  it("refuses a mode that requires a field a task doesn't carry", async () => {
    const refused = await start({ modes: { default: { requires: ["isue" as never] } } });
    expect(refused).toContain('mode "default" requires "isue"');
    expect(refused).toContain('"issue", "project"');
  });

  it("refuses a mode other than default with no instructions or done check", async () => {
    expect(await start({ modes: { default: {}, review: { instructions: brief("x") } } })).toContain('mode "review" needs `doneWhen`');
    expect(await start({ modes: { default: {}, review: {} } })).toContain('mode "review" needs `instructions` and `doneWhen`');
  });

  it("refuses a mode name that can't key a run", async () => {
    expect(await start({ modes: { default: {}, "two words": { instructions: brief("x"), doneWhen: committed } } })).toContain('mode "two words" can\'t name a run');
    expect(await start({ modes: { default: {}, Review: { instructions: brief("x"), doneWhen: committed } } })).toContain('write it as "review"');
  });

  it("refuses a mode workspace that isn't a workspace host", async () => {
    const fixedRepository = { root: tmpdir(), sourceRepo: tmpdir(), baseRef: "main" };
    // @ts-expect-error a mode works in a workspace host, as the kit's own `workspace` is; a fixed repository's config is not one.
    const typed: Partial<Parameters<typeof harnesses>[0]> = { modes: { default: { workspace: fixedRepository } } };
    expect(await start(typed)).toContain('mode "default" names a workspace that isn\'t a workspace host');
  });

  it("refuses an inherited key as a default mode", () => {
    expect(() => resolveCoderModes({ defaultMode: "constructor" }, kitMode, "coder")).toThrow('the default mode is "constructor"');
  });
});

describe("the app's own part of the coding flow", () => {
  it("checks the app's settings on a worker's file", async () => {
    const worker = { settings: { document: z.string().min(3).optional() } };
    expect(await start({ worker }, "document: notes\n")).toBe("started");
    expect(await start({ worker }, "document: no\n")).toContain("document");
  });

  it("refuses an app setting the flow already declares", async () => {
    expect(await start({ worker: { settings: { harness: z.string() } } })).toContain('`worker.settings` declares "harness"');
  });

  it("refuses an app document under an accessor the flow declares for another resource, and shares the same one", async () => {
    const [messages, chains] = Object.keys(workerMessagesResources) as Array<keyof typeof workerMessagesResources>;
    const refused = await start({ worker: { resources: { [messages!]: workerMessagesResources[chains!] } } });
    expect(refused).toContain(`Resource conflict: "${messages}"`);
    expect(await start({ worker: { resources: { [messages!]: workerMessagesResources[messages!] } } })).toBe("started");
  });

  it("builds the app's actions on the installation, and refuses one the flow already serves", async () => {
    const builtOn: unknown[] = [];
    const inspect = handler({ name: "inspect-facts", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) });
    expect(
      await start({ worker: { actions: (installation) => (builtOn.push(installation), { inspect: { block: inspect, description: "Read." } }) } }),
    ).toBe("started");
    expect(builtOn[0]).toMatchObject({ resolveWorker: expect.any(Function) });
    expect(await start({ worker: { actions: () => ({ respond: { block: inspect } }) } })).toContain('`worker.actions` declares "respond"');
  });
});
