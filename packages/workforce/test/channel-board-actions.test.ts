/**
 * The channel's own door onto a board it holds: filing a row, and reading one.
 *
 * Two of these matter more than the rest and are marked where they sit:
 *
 * - **BR-9 is asserted on the RESOLVED ledger id, not on a refusal.** A test
 *   that reads the error message would pass against a guard you could delete,
 *   because the real property is that the id is minted from the session's own
 *   identity and a payload selects no storage at all.
 * - **A row filed with NO `author` goes through.** The roster check is a
 *   validity check on an optional unverified label, not a gate, and without
 *   this case a later reader is free to read the rule as members-only.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { channelInstances, type ChannelManifest } from "../src/index";
import { postedLines } from "./channel-post-lines";

const USER_ID = "u_boards";
// The org the session route binds a channel to when no resolver is
// configured; the harness must run its actions in the same one.
const ORG_ID = DEFAULT_ORG_ID;

function record(id: string, declared: Record<string, unknown> = {}): ChannelManifest {
  return { id, declared: { members: ["eng.em", "eng.coder"], ...declared }, body: "Charter." };
}

/** `openChannels`'s session API over this test's own stores, org included. */
function sessionApi(stores: StoreRegistry) {
  return {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      orgId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }): Promise<unknown> => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: options.orgId ?? DEFAULT_ORG_ID,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        } as never,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = await stores.session.get(sessionId);
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        orgId: (found as { orgId?: string } | undefined)?.orgId,
        state: found?.state as Record<string, unknown> | undefined
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
}

/**
 * Register the kind this roster produces, and open its channels.
 *
 * `adapter` is passed in by the re-bind case, which needs the SAME durable
 * storage on both sides of an edit — a fresh one would prove nothing about a
 * transcript surviving.
 */
async function host(roster: ChannelManifest[], adapter: unknown = inMemoryStores()) {
  const [channel] = channelInstances(roster);
  const state = createFlowState({
    flows: { [channel!.kind]: channel! },
    stores: { default: { primary: adapter } }
  } as never);
  const runtime = await state.getRuntime();
  const { openChannels } = await import("../src/index");
  await openChannels(roster, {
    client: sessionApi(runtime.stores),
    userId: USER_ID,  });

  /**
   * Run one action. A refusal the substrate THROWS (an action this kind does
   * not declare) comes back the same way a refusal it returns does, so a leg
   * expecting one grades its wording instead of taking the run down.
   */
  const act = async (
    sessionId: string,
    actionName: string,
    input: unknown
  ): Promise<{ output?: unknown; error?: unknown }> => {
    try {
      return (await runAction({
        flow: channel!,
        actionName,
        input,
        userId: USER_ID,
        orgId: ORG_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { output?: unknown; error?: unknown };
    } catch (error) {
      return { error };
    }
  };

  return {
    channel: channel!,
    runtime,
    adapter,
    act,
    /** One row, read straight out of org-scoped storage — never through the action. */
    row: (boardId: string, taskId: string) =>
      runtime.stores.resourceState
        .get("org", ORG_ID, `${boardId}/${taskId}`)
        .then((found) => found?.state as Record<string, unknown> | undefined),
    /**
     * Put one stored row into a shape a claim would have left it in.
     *
     * Written straight to storage rather than by draining a real board: what
     * is under test is the ACTION's projection, and a drain would add a board,
     * a worker and a lease to a test whose claim is one field wide.
     */
    stamp: async (boardId: string, taskId: string, patch: Record<string, unknown>) => {
      const key = `${boardId}/${taskId}`;
      const found = await runtime.stores.resourceState.get("org", ORG_ID, key);
      await runtime.stores.resourceState.set(
        "org",
        ORG_ID,
        key,
        { ...(found!.state as Record<string, unknown>), ...patch } as never,
        "any"
      );
    },
    dispose: () => state.dispose()
  };
}

describe("filing a row onto a channel's board", () => {
  it("lands it pending on the minted ledger, carrying the assignee it was given", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage"] })]);
    try {
      const filed = await lab.act("eng.feature", "fileTask", {
        board: "triage",
        goal: "ship the reader",
        assignee: "coder",
        author: "eng.em"
      });
      expect(filed.error).toBeUndefined();

      const out = filed.output as { boardId: string; taskId: string; status: string };
      expect(out.boardId).toBe("eng.feature.triage");
      expect(out.status).toBe("pending");

      // Read back out of storage rather than off the action's own answer: the
      // claim is that a row LANDED on that ledger, and an action echoing its
      // input would satisfy an assertion on the return value alone.
      const stored = await lab.row("eng.feature.triage", out.taskId);
      expect(stored).toBeDefined();
      expect(stored!.goal).toBe("ship the reader");
      expect(stored!.status).toBe("pending");
      expect(stored!.assignee).toBe("coder");
    } finally {
      await lab.dispose();
    }
  });

  it("refuses a board this channel did not declare, and writes nothing", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage"] })]);
    try {
      const refused = await lab.act("eng.feature", "fileTask", {
        board: "review",
        goal: "look at it"
      });
      expect(String(refused.error)).toContain("board-not-declared");
      // The refusal lists what the channel DOES hold, so an author is told the
      // name rather than that they were wrong.
      expect(String(refused.error)).toContain("triage");

      // Nothing was created anywhere: the board this channel DOES hold is
      // still empty, so the refusal did not quietly mint a second ledger.
      const read = await lab.act("eng.feature", "readBoard", { board: "triage" });
      expect((read.output as { tasks: unknown[] }).tasks).toHaveLength(0);
    } finally {
      await lab.dispose();
    }
  });

  /**
   * **BR-9, asserted on the resolved id.** Both channels declare a board
   * called `triage`. Filing into one can only ever reach that one's ledger,
   * because the id is minted from the session's own identity — there is no
   * payload through which another channel's rows could be selected.
   */
  it("reaches only this channel's ledger, whatever another channel called its board", async () => {
    const lab = await host([
      record("eng.feature", { boards: ["triage"] }),
      record("eng.platform", { boards: ["triage"] })
    ]);
    try {
      const filed = await lab.act("eng.platform", "fileTask", {
        board: "triage",
        goal: "platform work"
      });
      const out = filed.output as { boardId: string; taskId: string };

      expect(out.boardId).toBe("eng.platform.triage");
      expect(await lab.row("eng.platform.triage", out.taskId)).toBeDefined();
      // The other channel's ledger is untouched. This is the assertion that
      // would survive deleting every refusal in the module.
      expect(await lab.row("eng.feature.triage", out.taskId)).toBeUndefined();
    } finally {
      await lab.dispose();
    }
  });

  it("refuses an `author` the channel does not list, in the post path's own words", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage"] })]);
    try {
      const refused = await lab.act("eng.feature", "fileTask", {
        board: "triage",
        goal: "ship it",
        author: "eng.stranger"
      });
      expect(String(refused.error)).toContain("author-not-a-member");
      expect(String(refused.error)).toContain("eng.stranger");
    } finally {
      await lab.dispose();
    }
  });

  /**
   * The half of the rule that has to exist, or the other half reads as a gate.
   * Filing is NOT members-only: omit the label and no roster check runs at all.
   */
  it("files a row carrying NO author at all, unchecked", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage"] })]);
    try {
      const filed = await lab.act("eng.feature", "fileTask", {
        board: "triage",
        goal: "filed by nobody in particular"
      });
      expect(filed.error).toBeUndefined();

      const out = filed.output as { taskId: string };
      const stored = await lab.row("eng.feature.triage", out.taskId);
      expect(stored!.goal).toBe("filed by nobody in particular");
    } finally {
      await lab.dispose();
    }
  });
});

describe("reading", () => {
  it("gives the board's rows back through `readBoard`", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage"] })]);
    try {
      await lab.act("eng.feature", "fileTask", { board: "triage", goal: "one" });
      await lab.act("eng.feature", "fileTask", { board: "triage", goal: "two" });

      const read = await lab.act("eng.feature", "readBoard", { board: "triage" });
      const out = read.output as { boardId: string; tasks: Array<{ goal: string }> };
      expect(out.boardId).toBe("eng.feature.triage");
      // Sorted before comparing ON PURPOSE: a board read states no ordering,
      // so asserting one here would pin a rule the contract does not make and
      // would turn an unrelated storage change red.
      expect(out.tasks.map((task) => task.goal).sort()).toEqual(["one", "two"]);
    } finally {
      await lab.dispose();
    }
  });

  it("never hands back `claimedBy`, which is where the work ran and not a caller's to read", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage"] })]);
    try {
      const filed = await lab.act("eng.feature", "fileTask", {
        board: "triage",
        goal: "one",
        assignee: "coder"
      });
      const { taskId } = filed.output as { taskId: string };

      // The row as a claim leaves it. Every field here is an execution
      // coordinate: the session it ran under, the request that took it, and
      // the tenant. `readBoard` is a PUBLIC action and its output reaches a
      // model's context, so none of them may come back.
      await lab.stamp("eng.feature.triage", taskId, {
        status: "in_progress",
        claimedBy: {
          sessionId: "s_private_worker_session",
          requestId: "req_private_00000000",
          tenantId: "org_some_other_tenant"
        }
      });

      // The premise: the field really is on the stored row. Without this the
      // assertion below is green on a row that never had one.
      const stored = await lab.row("eng.feature.triage", taskId);
      expect(stored!.claimedBy).toBeDefined();

      const read = await lab.act("eng.feature", "readBoard", { board: "triage" });
      const out = read.output as { tasks: Array<Record<string, unknown>> };
      expect(out.tasks).toHaveLength(1);
      expect(out.tasks[0]!.claimedBy).toBeUndefined();
      expect("claimedBy" in out.tasks[0]!).toBe(false);
      // Serialized, because a nested copy elsewhere in the payload would
      // satisfy the key check above and still publish the ids.
      expect(JSON.stringify(out)).not.toContain("s_private_worker_session");
      expect(JSON.stringify(out)).not.toContain("org_some_other_tenant");
      // The rest of the row still comes back — a redaction that dropped the
      // task would pass every assertion above.
      expect(out.tasks[0]!.goal).toBe("one");
      expect(out.tasks[0]!.assignee).toBe("coder");
    } finally {
      await lab.dispose();
    }
  });

  it("projects the declared board NAMES on a channel read, and not the rows", async () => {
    const lab = await host([record("eng.feature", { boards: ["triage", "review"] })]);
    try {
      await lab.act("eng.feature", "fileTask", { board: "triage", goal: "a row" });

      const read = await lab.act("eng.feature", "read", {});
      const out = read.output as { boards?: string[]; members: string[] };
      expect(out.boards).toEqual(["review", "triage"]);
      expect(out.members).toEqual(["eng.em", "eng.coder"]);
      // Reading a board is a board read. A channel read that carried rows
      // would make the transcript and the ledger one surface.
      expect(JSON.stringify(out)).not.toContain("a row");
    } finally {
      await lab.dispose();
    }
  });

  it("leaves a channel that declares no board reading exactly as it did", async () => {
    const lab = await host([record("eng.quiet")]);
    try {
      const posted = await lab.act("eng.quiet", "post", {
        body: "still just talking",
        author: "eng.em"
      });
      expect(posted.error).toBeUndefined();

      const read = await lab.act("eng.quiet", "read", {});
      const out = read.output as Record<string, unknown>;
      // Absent, not `[]`. A channel with no board projects the same keys it
      // projected before boards existed.
      expect("boards" in out).toBe(false);
      expect(out.members).toEqual(["eng.em", "eng.coder"]);
    } finally {
      await lab.dispose();
    }
  });
});

/**
 * Adding `boards:` to a `CHANNEL.md` whose channel is ALREADY OPEN.
 *
 * The transcript assertion is the one that matters: a channel's conversation
 * is the only thing it cannot re-derive from its file, so an activation story
 * that rewrites session state is one line away from deleting it. Here the
 * board list is not session state at all — it is re-read from the roster the
 * kind is built from — so the transcript is not merely preserved, it is never
 * on the path.
 */
describe("a board added to a channel that is already open", () => {
  it("becomes usable on the next bind, with the transcript byte-identical", async () => {
    const adapter = inMemoryStores();
    const before = await host([record("eng.feature")], adapter);
    let transcriptBefore: string;
    try {
      const stores: StoreRegistry = before.runtime.stores;

      await before.act("eng.feature", "post", { body: "line one", author: "eng.em" });
      await before.act("eng.feature", "post", { body: "line two", author: "eng.coder" });

      // No board yet — the actions are not even on the kind.
      const early = await before.act("eng.feature", "fileTask", { board: "triage", goal: "early" });
      expect(early.error).toBeDefined();

      transcriptBefore = JSON.stringify(await postedLines(stores, "eng.feature"));
      expect(JSON.parse(transcriptBefore)).toHaveLength(2);
    } finally {
      await before.dispose();
    }

    // The same storage, re-bound from an edited file. `openChannels` finds the
    // channel already open and leaves its session exactly as it is.
    const roster = [record("eng.feature", { boards: ["triage"] })];
    const [channel] = channelInstances(roster);
    const state = createFlowState({
      flows: { [channel!.kind]: channel! },
      stores: { default: { primary: adapter } }
    } as never);
    try {
      const runtime = await state.getRuntime();
      const { openChannels } = await import("../src/index");
      await openChannels(roster, {
        client: sessionApi(runtime.stores),
        userId: USER_ID,      });

      const filed = (await runAction({
        flow: channel!,
        actionName: "fileTask",
        input: { board: "triage", goal: "after the edit" },
        userId: USER_ID,
        orgId: ORG_ID,
        sessionId: "eng.feature",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never)) as { output?: unknown; error?: unknown };
      expect(filed.error).toBeUndefined();
      expect((filed.output as { boardId: string }).boardId).toBe("eng.feature.triage");

      expect(JSON.stringify(await postedLines(runtime.stores, "eng.feature"))).toBe(
        transcriptBefore!
      );
    } finally {
      await state.dispose();
    }
  });
});
