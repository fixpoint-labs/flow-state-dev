import { describe, expect, it, vi } from "vitest";
import type {
  PatternBinding,
  ResourceCollectionRef,
} from "@flow-state-dev/core";
import type { PatternRegistryDeps } from "@flow-state-dev/skills";
import { defaultPatternRegistry } from "../src/skill-registry";

/** Minimal stub resource collection — pattern factories don't read from it
 *  unless workers declare prompt-ref entries. */
function stubCollection(): ResourceCollectionRef {
  return {
    pattern: "skills/**",
    scope: "org" as const,
    get: () => {
      throw new Error("not used");
    },
    getOptional: () => undefined,
    create: vi.fn() as never,
    getOrCreate: vi.fn() as never,
    list: () => [],
    delete: vi.fn() as never,
    count: () => 0,
    config: { pattern: "skills/**", stateSchema: {} as never } as never,
  };
}

function deps(skillName = "demo"): PatternRegistryDeps {
  return {
    catalog: {},
    skillName,
    skillCollection: stubCollection(),
    defaultModelId: "openai/gpt-4o-mini",
    collectionId: `skill_${skillName}_r1_1`,
  };
}

function binding(extra: Partial<PatternBinding>): PatternBinding {
  return {
    pattern: extra.pattern ?? "task-board",
    workers: extra.workers ?? {
      worker: { prompt: "Do the thing." },
    },
    initialTasks: extra.initialTasks ?? [
      { id: "t", goal: "do it", assignee: "worker" },
    ],
    ...(extra.collection !== undefined ? { collection: extra.collection } : {}),
    ...(extra.patternConfig !== undefined ? { patternConfig: extra.patternConfig } : {}),
  };
}

describe("defaultPatternRegistry", () => {
  it("registers the expected keys", () => {
    const keys = defaultPatternRegistry.list().map((f) => f.key).sort();
    expect(keys).toEqual([
      "approval-gate",
      "coordinator",
      "event-actors",
      "parallel-tasks",
      "plan-and-execute",
      "routed-specialists",
      "supervisor",
      "task-board",
    ]);
  });
});

describe("defaultPatternRegistry — task-board adapter", () => {
  it("materializes a runnable block from a parsed binding", async () => {
    const factory = defaultPatternRegistry.get("task-board")!;
    const block = await factory.fromConfig(
      binding({ patternConfig: { concurrency: 2, "on-idle": "complete" } }),
      deps(),
      {} as never,
    );
    expect(block.block).toBeDefined();
    expect(block.collectionId).toBe("skill_demo_r1_1");
  });

  it("rejects session-scope collections (Wave 1 limitation)", async () => {
    const factory = defaultPatternRegistry.get("task-board")!;
    await expect(
      factory.fromConfig(
        binding({ collection: { scope: "session" } }),
        deps(),
        {} as never,
      ),
    ).rejects.toThrow(/session-scoped/);
  });

  it("strict config schema rejects unknown keys", () => {
    const factory = defaultPatternRegistry.get("task-board")!;
    const parsed = factory.configSchema.safeParse({ "bogus-key": 1 });
    expect(parsed.success).toBe(false);
  });
});

describe("defaultPatternRegistry — single-worker patterns", () => {
  it("plan-and-execute requires exactly one worker", async () => {
    const factory = defaultPatternRegistry.get("plan-and-execute")!;
    await expect(
      factory.fromConfig(
        binding({
          pattern: "plan-and-execute",
          workers: {
            a: { prompt: "x" },
            b: { prompt: "y" },
          },
          initialTasks: [{ id: "t", goal: "do", assignee: "a" }],
        }),
        deps(),
        {} as never,
      ),
    ).rejects.toThrow(/exactly one worker/);
  });

  it("parallel-tasks accepts a single worker", async () => {
    const factory = defaultPatternRegistry.get("parallel-tasks")!;
    const block = await factory.fromConfig(
      binding({ pattern: "parallel-tasks" }),
      deps(),
      {} as never,
    );
    expect(block.block).toBeDefined();
    expect(block.collectionId).toBe("skill_demo_r1_1");
  });
});

describe("defaultPatternRegistry — coordinator alias", () => {
  it("warns about deprecation and delegates to parallel-tasks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const factory = defaultPatternRegistry.get("coordinator")!;
    const block = await factory.fromConfig(
      binding({ pattern: "coordinator" }),
      deps(),
      {} as never,
    );
    expect(block).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("deprecated alias"));
    warn.mockRestore();
  });
});

describe("defaultPatternRegistry — supervisor adapter", () => {
  it("collapses to single-worker form when only one worker is declared", async () => {
    const factory = defaultPatternRegistry.get("supervisor")!;
    const block = await factory.fromConfig(
      binding({ pattern: "supervisor" }),
      deps(),
      {} as never,
    );
    expect(block.block).toBeDefined();
    expect(block.collectionId).toBe("skill_demo_r1_1");
  });

  it("extracts a 'reviewer' worker into the reviewer slot", async () => {
    const factory = defaultPatternRegistry.get("supervisor")!;
    const block = await factory.fromConfig(
      binding({
        pattern: "supervisor",
        workers: {
          worker: { prompt: "do the work" },
          reviewer: { prompt: "review it" },
        },
        initialTasks: [{ id: "t", goal: "do", assignee: "worker" }],
      }),
      deps(),
      {} as never,
    );
    expect(block.block).toBeDefined();
    expect(block.collectionId).toBe("skill_demo_r1_1");
  });
});

describe("defaultPatternRegistry — routed-specialists adapter", () => {
  it("auto-constructs a workspace and forwards specialists", async () => {
    const factory = defaultPatternRegistry.get("routed-specialists")!;
    const block = await factory.fromConfig(
      binding({
        pattern: "routed-specialists",
        workers: {
          coder: { prompt: "code" },
          reviewer: { prompt: "review" },
        },
        initialTasks: [{ id: "t", goal: "do", assignee: "coder" }],
      }),
      deps(),
      {} as never,
    );
    expect(block.block).toBeDefined();
    expect(block.collectionId).toBe("skill_demo_r1_1");
  });
});

describe("defaultPatternRegistry — stubs", () => {
  it("event-actors throws a clear deferral message", async () => {
    const factory = defaultPatternRegistry.get("event-actors")!;
    await expect(
      factory.fromConfig(binding({ pattern: "event-actors" }), deps(), {} as never),
    ).rejects.toThrow(/event-actors|Wave 2/);
  });

  it("approval-gate throws a clear deferral message", async () => {
    const factory = defaultPatternRegistry.get("approval-gate")!;
    await expect(
      factory.fromConfig(binding({ pattern: "approval-gate" }), deps(), {} as never),
    ).rejects.toThrow(/Wave 2/);
  });
});
