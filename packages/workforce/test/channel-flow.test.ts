/**
 * The channel kind: one registered instance, one named session per channel.
 *
 * Sequence step 1 of the spec — the kind with no fan-out. Every behaviour here
 * runs against a real host, because the facts under test (which session a post
 * lands in, what the entry's queue serialises, what `read` projects) are
 * runtime facts rather than shape ones.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { channelFlow, CHANNEL_KIND } from "../src/index";
import { postedLines } from "./channel-post-lines";

const USER_ID = "u_channel";

function host() {
  const instance = channelFlow();
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: instance },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  return { instance, state };
}

/** Seed a bound channel the way `openChannels` does: state written at create. */
async function bind(
  stores: StoreRegistry,
  sessionId: string,
  members: string[],
  instructions: string,
  description?: string
): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      description,
      state: { members, instructions, transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

describe("the channel kind", () => {
  it("registers as one singleton instance addressed by its kind", () => {
    const instance = channelFlow();
    expect(instance.kind).toBe(CHANNEL_KIND);
    expect(instance.id).toBe(CHANNEL_KIND);
    expect(instance.cardinality).toBe("singleton");
  });

  it("lands a post in the named session it was addressed to", async () => {
    const { instance, state } = host();
    try {
      const runtime: FlowStateRuntime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead"], "Post status.");

      const result = await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(result.error).toBeUndefined();
      const lines = await postedLines(runtime.stores, "engineering.standup");
      expect(lines).toHaveLength(1);
      expect(lines[0]?.body).toBe("shipped the reader");
    } finally {
      await state.dispose();
    }
  });

  it("carries the server-derived principal and marks any author claim unverified", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead"], "Post status.");

      await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader", author: "engineering.lead" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      const [line] = await postedLines(runtime.stores, "engineering.standup");
      expect(line?.principal).toBe(USER_ID);
      expect(line?.author).toBe("engineering.lead");
      expect(line?.authorVerified).toBe(false);
    } finally {
      await state.dispose();
    }
  });

  it("rejects a payload that supplies its own principal, before the handler runs", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead"], "Post status.");

      const result = await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "post",
        input: { body: "forged", principal: "u_someone_else" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(result.error).toBeDefined();
      expect(await postedLines(runtime.stores, "engineering.standup")).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("refuses an author claim naming someone outside the session's members", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["engineering.lead"], "Post status.");

      const result = await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "post",
        input: { body: "not mine to send", author: "marketing.intern" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(result.error).toBeDefined();
      expect(String(result.error)).toContain("marketing.intern");
      expect(await postedLines(runtime.stores, "engineering.standup")).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("keeps two channels' transcripts apart on the one instance", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup", ["a"], "Standup.");
      await bind(runtime.stores, "engineering.triage", ["a"], "Triage.");

      await Promise.all([
        runAction({
    orgId: DEFAULT_ORG_ID,
          flow: instance,
          actionName: "post",
          input: { body: "standup line" },
          userId: USER_ID,
          sessionId: "engineering.standup",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        }),
        runAction({
    orgId: DEFAULT_ORG_ID,
          flow: instance,
          actionName: "post",
          input: { body: "triage line" },
          userId: USER_ID,
          sessionId: "engineering.triage",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        })
      ]);

      expect((await postedLines(runtime.stores, "engineering.standup")).map((l) => l.body)).toEqual([
        "standup line"
      ]);
      expect((await postedLines(runtime.stores, "engineering.triage")).map((l) => l.body)).toEqual([
        "triage line"
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("reads back the transcript with the channel's members and description, and no session items", async () => {
    const { instance, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(
        runtime.stores,
        "engineering.standup",
        ["engineering.lead", "engineering.analyst"],
        "Post status.",
        "Where the engineering team posts daily status."
      );

      await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "post",
        input: { body: "shipped the reader" },
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      const read = await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: instance,
        actionName: "read",
        input: {},
        userId: USER_ID,
        sessionId: "engineering.standup",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      expect(read.error).toBeUndefined();
      const output = read.output as {
        id: string;
        description?: string;
        members: string[];
        transcript: Array<{ body: string }>;
      };
      expect(output.id).toBe("engineering.standup");
      expect(output.description).toBe("Where the engineering team posts daily status.");
      expect(output.members).toEqual(["engineering.lead", "engineering.analyst"]);
      expect(output.transcript.map((l) => l.body)).toEqual(["shipped the reader"]);
      // The projection is the transcript, not the session's machinery.
      expect(Object.keys(output)).toEqual(["id", "description", "members", "transcript"]);
    } finally {
      await state.dispose();
    }
  });
});
