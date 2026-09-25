// With no model passed, the example's activator must not build or resolve an
// evaluator at all. A trace with no evaluator row isn't proof on its own: an
// evaluator built and never reached leaves no row either. So this spies on
// the two places one would come from, the builders and model resolution, and
// expects zero calls.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, sequencer } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineSkillsCollection } from "@flow-state-dev/orchestration";
import { createMockModelResolver } from "@flow-state-dev/testing";

vi.mock("@flow-state-dev/orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/orchestration")>();
  return { ...actual, skillEvaluator: vi.fn(actual.skillEvaluator) };
});
vi.mock("@flow-state-dev/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/core")>();
  return { ...actual, evaluator: vi.fn(actual.evaluator) };
});

const { skillEvaluator } = await import("@flow-state-dev/orchestration");
const { evaluator } = await import("@flow-state-dev/core");
const { skillActivator } = await import("../src/activate");

describe("the activator with no evaluator", () => {
  it("builds no evaluator and resolves no evaluation model, and slash commands and keywords still activate", async () => {
    vi.mocked(skillEvaluator).mockClear();
    vi.mocked(evaluator).mockClear();

    const activator = skillActivator();
    expect(skillEvaluator).not.toHaveBeenCalled();
    expect(evaluator).not.toHaveBeenCalled();

    const resolveEvaluationModel = vi.fn();
    const base = createMockModelResolver({});
    const resolver = Object.assign(((id: string, block?: string) => base(id, block)) as ModelResolver, {
      resolveId: base.resolveId,
      resolveEvaluationModel,
    });
    const flow = defineFlow({
      kind: "activator-without-evaluator",
      resources: { skills: defineSkillsCollection({ scope: "session" }) },
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: sequencer({ name: "turn", inputSchema: z.object({ message: z.string() }) }).step(activator),
        },
      },
    })();

    const turns = [
      { message: "is this an outage? nothing loads", expect: { name: "outage-status", source: "keyword" } },
      { message: "/plan-change move us to yearly billing", expect: { name: "plan-change", source: "slash" } },
    ];
    for (const [n, turn] of turns.entries()) {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: { message: turn.message },
        requestId: `req_no_evaluator_${n}`,
        userId: "test-user",
        sessionId: `session_no_evaluator_${n}`,
        stores: createInMemoryStores(),
        runtimeConfig: { modelResolver: resolver },
      });

      expect(result.error).toBeUndefined();
      const writes = (result.items as Array<Record<string, unknown>>).filter(
        (i) => i.type === "state_change" && i.scope === "session",
      );
      const active = writes.flatMap(
        (i) => (i.delta as { activeSkills?: Array<{ name: string; source?: string }> }).activeSkills ?? [],
      );
      expect(active.map((s) => ({ name: s.name, source: s.source }))).toEqual([turn.expect]);
    }
    expect(resolveEvaluationModel).not.toHaveBeenCalled();
    expect(skillEvaluator).not.toHaveBeenCalled();
    expect(evaluator).not.toHaveBeenCalled();
  });

  it("does build one when a model is passed, so the spies can see it", () => {
    vi.mocked(skillEvaluator).mockClear();
    vi.mocked(evaluator).mockClear();
    skillActivator("typesafe-ai/jev");
    expect(skillEvaluator).toHaveBeenCalledTimes(1);
    expect(evaluator).toHaveBeenCalledTimes(1);
  });
});
