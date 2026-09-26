/**
 * `post-to-channel` — an agent seat posts into a channel it belongs to, as
 * itself.
 *
 * Run on the real kinds: the built-in channel kind and an agent kind carrying
 * the channel-post capability, hired through `hireWorkforce`, answering with a
 * scripted model whose step calls the tool (no text, so the real tool runs).
 * Every author assertion is on the line the channel STORED, never on what the
 * tool was handed: the tool's input has no author, and the point is that the
 * name on the line comes from the seat's settings.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1594/BUSINESS-RULES.md`, V1):
 *   BR-1/BR-3  a direct turn lands one line: author the seat's id, principal
 *              the request's user, `authorVerified: false`;
 *   BR-4       an `author` (or any other extra key) from the model is refused;
 *   BR-5       a channel the seat is not in refuses the post on its own
 *              request; the seat's turn completes;
 *   BR-6       an id nobody opened, and a session of another kind, are
 *              refused by name at dispatch; the call fails;
 *   BR-7       a seat whose `tools:` does not name the tool posts nothing;
 *   BR-8       an empty body is refused by the tool's input;
 *   BR-16      a runtime-hired seat posts under its record id, not its address;
 *   BR-17      a seat with no `seatId` is refused by name, never posted as the
 *              principal;
 *   BR-19      behind an external dispatcher the call fails naming it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowDispatcher, FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import type { MockGeneratorInstance, MockGeneratorScriptStep } from "@flow-state-dev/testing";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  CHANNEL_KIND,
  POST_TO_CHANNEL_TOOL,
  channelFlow,
  channelPostCapability,
  defineAgentWorkerFlow,
  hireWorkforce,
  type WorkerManifest,
} from "../src/index";
import { hiredSeatManifest, toHiredSeatRow } from "../src/roster/rows";
import { postedLines } from "./channel-post-lines";

const USER_ID = "devuser";

/**
 * The scripted model. A turn `post <json>` gets one step calling the tool with
 * that JSON as its arguments and no text, so the real tool runs; the step
 * after it says it is done. Each request keeps its own cursor, keyed on the
 * messages array the tool loop hands every call of one request.
 */
function scriptedAgent(): MockGeneratorInstance {
  let cursor = new WeakMap<object, number>();
  return {
    name: "agent-answer",
    calls: [],
    reset: () => {
      cursor = new WeakMap();
    },
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as Array<{ role: string; content: unknown }>;
      const turn = JSON.stringify([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const directive = /post (\{.*\})/.exec(JSON.parse(turn) as string);
      if (directive === null) return { text: "no directive" };
      const step = cursor.get(messages) ?? 0;
      cursor.set(messages, step + 1);
      if (step > 0) return { text: "done" };
      return {
        toolCalls: [{ toolCallId: `tc_${Date.now()}`, toolName: POST_TO_CHANNEL_TOOL, args: JSON.parse(directive[1]!) }],
      };
    },
  };
}

/** A dispatcher that is not the in-process one: what makes a host "external" to the delivery fence. */
const externalDispatcher = {
  dispatch: () => {
    throw new Error("this test never expects a dispatch to reach the queue");
  },
} as unknown as FlowDispatcher;

const agent = defineAgentWorkerFlow({ uses: [channelPostCapability] });

function seat(id: string, tools: string[] | undefined = [POST_TO_CHANNEL_TOOL]): WorkerManifest {
  return { id, declared: tools === undefined ? {} : { tools }, body: "You answer questions." };
}

function host(seats: FlowInstance[], options: { external?: boolean } = {}) {
  const flows: Record<string, FlowInstance> = { [CHANNEL_KIND]: channelFlow() };
  for (const s of seats) flows[s.id] = s;
  const state = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": scriptedAgent() }, policy: "allow" }),
    ...(options.external === true ? { dispatcher: externalDispatcher } : {}),
  });
  return state;
}

async function bind(
  stores: StoreRegistry,
  sessionId: string,
  members: string[],
  flowKind = CHANNEL_KIND,
  orgId = DEFAULT_ORG_ID,
): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind,
      flowId: flowKind,
      userId: USER_ID,
      orgId,
      state: { members, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    } as never,
    "any",
  );
}

/** Talk to a seat directly: one turn of its `run` action. */
async function say(runtime: FlowStateRuntime, target: FlowInstance, message: string, orgId = DEFAULT_ORG_ID) {
  return await runAction({
    orgId,
    flow: target,
    actionName: "run",
    input: { message },
    userId: USER_ID,
    sessionId: `s_${target.id}_${Math.random().toString(36).slice(2)}`,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  });
}

const postTurn = (args: Record<string, unknown>) => `post ${JSON.stringify(args)}`;

/** Every request a channel session holds, settled. */
async function channelRequests(runtime: FlowStateRuntime, sessionId: string, count: number) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const requests = await runtime.stores.request.list({ sessionId, withItems: true });
    if (requests.length >= count && requests.every((r) => r.status !== "in_progress")) return requests;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${sessionId} never settled ${count} request(s)`);
}

describe("post-to-channel", () => {
  it("lands one line in a channel the seat belongs to, under the seat's own id (BR-1, BR-3)", async () => {
    const [otto] = hireWorkforce([seat("support.otto")], { kinds: { agent } });
    const state = host([otto!]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto", "support.iris"]);

      const turn = await say(runtime, otto!, postTurn({ channel: "support.desk", body: "Refunds post on Fridays." }));
      expect(turn.error).toBeUndefined();

      await channelRequests(runtime, "support.desk", 1);
      expect(await postedLines(runtime.stores, "support.desk")).toEqual([
        expect.objectContaining({
          author: "support.otto",
          principal: USER_ID,
          authorVerified: false,
          body: "Refunds post on Fridays.",
        }),
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("refuses an author from the model, and any other key; nothing is posted (BR-4)", async () => {
    const [otto] = hireWorkforce([seat("support.otto")], { kinds: { agent } });
    const state = host([otto!]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto", "support.iris"]);

      const forged = await say(runtime, otto!, postTurn({ channel: "support.desk", body: "as iris", author: "support.iris" }));
      expect(String(forged.error)).toMatch(/Unrecognized key\(s\) in object: 'author'/);
      const extra = await say(runtime, otto!, postTurn({ channel: "support.desk", body: "loud", urgent: true }));
      expect(String(extra.error)).toMatch(/Unrecognized key\(s\) in object: 'urgent'/);

      // Nothing reached the channel: no request was started there at all.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await runtime.stores.request.list({ sessionId: "support.desk" })).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("is refused by the channel when the seat is not a member; the turn completes and nothing is written (BR-5)", async () => {
    const [otto] = hireWorkforce([seat("support.otto")], { kinds: { agent } });
    const state = host([otto!]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.ada-wren", ["support.ada", "support.wren"]);

      const turn = await say(runtime, otto!, postTurn({ channel: "support.ada-wren", body: "may I?" }));
      // The tool only handed the post over; the seat is not told it was refused.
      expect(turn.error).toBeUndefined();

      const [request] = await channelRequests(runtime, "support.ada-wren", 1);
      expect(request!.status).toBe("failed");
      expect(JSON.stringify(request)).toContain("author-not-a-member");
      expect(await postedLines(runtime.stores, "support.ada-wren")).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("fails the call by name for an id nobody opened, and for a session of another kind; nothing is written (BR-6)", async () => {
    const [otto] = hireWorkforce([seat("support.otto")], { kinds: { agent } });
    const state = host([otto!]);
    try {
      const runtime = await state.getRuntime();
      // A channel on another kind (the noticeboard runs on `digest`), with otto a member.
      await bind(runtime.stores, "support.noticeboard", ["support.otto"], "digest");

      const unknown = await say(runtime, otto!, postTurn({ channel: "support.nowhere", body: "hello?" }));
      expect(String(unknown.error)).toContain("session-not-found");
      expect(await runtime.stores.session.get("support.nowhere")).toBeUndefined();

      const other = await say(runtime, otto!, postTurn({ channel: "support.noticeboard", body: "notice" }));
      expect(String(other.error)).toContain("session-not-addressable");
      expect(await runtime.stores.request.list({ sessionId: "support.noticeboard" })).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("offers nothing to a seat whose tools: does not name it (BR-7)", async () => {
    const [iris] = hireWorkforce([seat("support.iris", [])], { kinds: { agent } });
    const state = host([iris!]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto", "support.iris"]);

      const turn = await say(runtime, iris!, postTurn({ channel: "support.desk", body: "from iris" }));
      expect(turn.error).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await runtime.stores.request.list({ sessionId: "support.desk" })).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("refuses an empty body at the tool's input (BR-8)", async () => {
    const [otto] = hireWorkforce([seat("support.otto")], { kinds: { agent } });
    const state = host([otto!]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto"]);

      const turn = await say(runtime, otto!, postTurn({ channel: "support.desk", body: "" }));
      expect(String(turn.error)).toMatch(/body/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await runtime.stores.request.list({ sessionId: "support.desk" })).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("posts a runtime-hired seat's line under its record id, not its address (BR-16)", async () => {
    const hired = hiredSeatManifest(
      "acme",
      toHiredSeatRow({ seatId: "support.pat", flow: "agent", settings: { tools: [POST_TO_CHANNEL_TOOL] } }),
    );
    if (!("manifest" in hired)) throw new Error(hired.problem);
    const [pat] = hireWorkforce([hired.manifest], { kinds: { agent } });
    expect(pat!.id).not.toBe("support.pat");
    const state = host([pat!]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto", "support.pat"], CHANNEL_KIND, "acme");

      const turn = await say(runtime, pat!, postTurn({ channel: "support.desk", body: "new here" }), "acme");
      expect(turn.error).toBeUndefined();
      await channelRequests(runtime, "support.desk", 1);
      expect((await postedLines(runtime.stores, "support.desk")).map((l) => l.author)).toEqual(["support.pat"]);
    } finally {
      await state.dispose();
    }
  });

  it("refuses a seat whose settings carry no seatId, and never posts as the principal (BR-17)", async () => {
    // Minted straight off the kind, not hired: the one way to a seat with no `seatId`.
    const bare = agent({ id: "support.otto", config: { tools: [POST_TO_CHANNEL_TOOL] } });
    const state = host([bare]);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto"]);

      const turn = await say(runtime, bare, postTurn({ channel: "support.desk", body: "who am I?" }));
      expect(String(turn.error)).toContain("carry no `seatId`");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await runtime.stores.request.list({ sessionId: "support.desk" })).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("fails the call naming the external dispatcher; nothing is written (BR-19)", async () => {
    const [otto] = hireWorkforce([seat("support.otto")], { kinds: { agent } });
    const state = host([otto!], { external: true });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "support.desk", ["support.otto"]);

      const turn = await say(runtime, otto!, postTurn({ channel: "support.desk", body: "queued?" }));
      expect(String(turn.error)).toContain("external-dispatcher");
      expect(await runtime.stores.request.list({ sessionId: "support.desk" })).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});
