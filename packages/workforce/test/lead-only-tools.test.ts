/**
 * The lead's `updateWorkstream` is offered only on a session that leads a
 * workstream. On any other session the write refuses
 * (`not-a-workstream-session`), so a worker handed the tool there calls it
 * and fails: the refusal stays as the safety check, and the tool is left off
 * the turn so the model never makes the call.
 *
 * Also pins the refusal's shape: a `FlowError` with core's refusal code, which
 * a block's trace keeps, so the DevTool draws it as refused, not failed.
 */
import { describe, expect, it } from "vitest";
import { FlowError } from "@flow-state-dev/core";
import { REFUSED_ERROR_CODE } from "@flow-state-dev/core/items";
import { mockGenerator } from "@flow-state-dev/testing";
import { defineWorkstreamBlocks, offeredOnSession, ProjectRefusedError } from "../src/index";
import { createWorkerInstallation } from "../src/workers/installation";
import { WORKSTREAM_STATE_KEY } from "../src/workers/keys";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

const blocks = () =>
  defineWorkstreamBlocks({
    installation: createWorkerInstallation({ standardWorkers: [], workerFlows: () => ({}) as never }),
    leadFlows: []
  });

describe("which sessions are offered the lead's updateWorkstream", () => {
  const { updateWorkstreamTool, listLeadsTool, editWorkstreamTool } = blocks();

  it("leaves it out on a session that leads no workstream, and offers it on one that does", () => {
    expect(offeredOnSession(updateWorkstreamTool, { session: { state: {} } })).toBe(false);
    expect(offeredOnSession(updateWorkstreamTool, { session: { state: { [WORKSTREAM_STATE_KEY]: "shared/apollo/checkout" } } })).toBe(true);
  });

  it("offers every other workstream tool whatever the session", () => {
    for (const tool of [listLeadsTool, editWorkstreamTool]) {
      expect(offeredOnSession(tool, { session: { state: {} } })).toBe(true);
    }
  });

  it("leaves it off a real agent turn on a session that leads no workstream, keeping the turn's other tools", async () => {
    const seen: string[][] = [];
    const host = bootBoardHost({
      standard: boardWorkers({ lead: { tools: ["updateWorkstream", "listLeads"] } }),
      judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }),
      // Built on the host's own installation, as an app builds them.
      agent: (installation) => {
        const own = defineWorkstreamBlocks({ installation, leadFlows: [] });
        return { catalog: { updateWorkstream: own.updateWorkstreamTool, listLeads: own.listLeadsTool } };
      },
      observeTools: (blockName, names) => {
        if (blockName?.startsWith("coordinator-judgment") === true) seen.push(names);
      }
    });
    try {
      const conv = await host.conversation("alice", "lead");
      const result = await host.act("alice", conv, "respond", { message: "how is the workstream going?" });
      await host.settled();
      expect(result.error, messageOf(result.error)).toBeUndefined();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain("listLeads");
      expect(seen[0]).not.toContain("updateWorkstream");
    } finally {
      await host.dispose();
    }
  });
});

describe("a project refusal", () => {
  it("is a FlowError with the refusal code and its reason, keeping its own type and message", () => {
    const error = new ProjectRefusedError("not-a-workstream-session", "this session leads no workstream, so there is none to update.");
    expect(error).toBeInstanceOf(ProjectRefusedError);
    expect(error).toBeInstanceOf(FlowError);
    expect(error.name).toBe("ProjectRefusedError");
    expect(error.reason).toBe("not-a-workstream-session");
    expect(error.code).toBe(REFUSED_ERROR_CODE);
    expect(error.details).toEqual({ reason: "not-a-workstream-session" });
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("not-a-workstream-session: this session leads no workstream, so there is none to update.");
  });
});
