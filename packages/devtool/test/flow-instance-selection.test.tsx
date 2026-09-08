/**
 * Selecting a flow INSTANCE, and what must never be guessed on the way.
 *
 * The defect these pin is one shape seen from several sides: the panel used a
 * flow's KIND as its identity, so two registered copies of one kind agreed with
 * each other. They selected together, they shared a saved session, and a switch
 * left the previous copy's work on screen. A kind names a family; only an id
 * names a copy.
 *
 * Every case here is written against an observable outcome — which instance is
 * selected, which session is installed, what a stale hint does — never against a
 * React key, a label's wording, or a mock's forwarding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { FlowListEntry } from "@flow-state-dev/client";
import { ClientHttpError } from "@flow-state-dev/client";

const listFlows = vi.fn();
const getSession = vi.fn();
const checkInterrupted = vi.fn().mockResolvedValue([]);

// Fresh objects per call, as the real factories return: rebuilding a client on a
// credential change is one of the things the read fences key on, so a shared
// singleton here would hide it.
vi.mock("../src/react/lib/client", () => ({
  createDevToolClient: () => ({ listFlows }),
  createDevToolSessionClient: () => ({ getSession }),
  createDevToolRecoveryClient: () => ({ checkInterrupted }),
}));

import { DevToolProvider, useDevTool } from "../src/react/context/devtool-context";

const engineerA: FlowListEntry = {
  id: "engineer-a",
  kind: "engineer",
  cardinality: "collection",
  requireUser: false,
  actions: ["inspect"],
  actionSchemas: { inspect: { type: "object", fields: {} } },
};
const engineerB: FlowListEntry = {
  id: "engineer-b",
  kind: "engineer",
  cardinality: "collection",
  requireUser: false,
  actions: ["review"],
  actionSchemas: { review: { type: "object", fields: {} } },
};
const reports: FlowListEntry = {
  id: "reports",
  kind: "reports",
  cardinality: "singleton",
  requireUser: false,
  actions: ["summarize"],
};

/** The live context value, so a test can act on it and then read it back. */
let ctx: ReturnType<typeof useDevTool>;

function Probe() {
  ctx = useDevTool();
  return null;
}

async function mount(userId = "u1") {
  await act(async () => {
    render(
      <DevToolProvider initialConfig={{ userId }} baseUrl={undefined}>
        <Probe />
      </DevToolProvider>,
    );
  });
}

/** Let the provider's revalidation round-trip settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("flow instance selection", () => {
  beforeEach(() => {
    localStorage.clear();
    listFlows.mockReset().mockResolvedValue([engineerA, engineerB, reports]);
    getSession.mockReset();
    checkInterrupted.mockClear();
  });

  describe("distinct same-kind instances", () => {
    it("selects the exact copy and carries its own configuration", async () => {
      await mount();

      await act(async () => ctx.selectInstance("engineer-b"));

      expect(ctx.activeFlowId).toBe("engineer-b");
      // Not the first entry of the kind. `engineer-a` declares `inspect`;
      // resolving by kind would offer that action against `engineer-b`.
      expect(ctx.activeFlow?.actions).toEqual(["review"]);
      expect(ctx.activeFlow?.actionSchemas).toHaveProperty("review");
    });

    it("ends the open session when the selected copy changes", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-a", "sess-a"));
      expect(ctx.activeSessionId).toBe("sess-a");

      await act(async () => ctx.selectInstance("engineer-b"));

      // A's session is not B's to show, and B has not said which of its own
      // sessions to open.
      expect(ctx.activeSessionId).toBeNull();
    });

    it("gives every transition its own visit token", async () => {
      await mount();
      const seen: number[] = [];

      await act(async () => ctx.selectInstance("engineer-a"));
      seen.push(ctx.workspaceToken);
      await act(async () => ctx.selectInstance("engineer-b"));
      seen.push(ctx.workspaceToken);
      await act(async () => ctx.selectInstance("engineer-a"));
      seen.push(ctx.workspaceToken);

      // A → B → A restores the same instance id. If the token came back too,
      // every read retired on the way out would agree with the tuple again and
      // write itself into the workspace the operator has re-entered.
      expect(new Set(seen).size).toBe(3);
      expect(seen[2]).toBeGreaterThan(seen[1]!);
    });
  });

  describe("a copy that leaves the catalog", () => {
    it("empties the workspace rather than falling back to a same-kind peer", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-a", "sess-a"));

      listFlows.mockResolvedValue([engineerB, reports]);
      await act(async () => {
        await ctx.refreshFlows();
      });

      expect(ctx.activeFlowId).toBeNull();
      expect(ctx.activeSessionId).toBeNull();
      // Reselection stays available — the catalog still lists the peer.
      expect(ctx.flows.map((f) => f.id)).toEqual(["engineer-b", "reports"]);
    });

    it("keeps an exact selection that is still listed", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-b", "sess-b"));

      await act(async () => {
        await ctx.refreshFlows();
      });

      expect(ctx.activeFlowId).toBe("engineer-b");
      expect(ctx.activeSessionId).toBe("sess-b");
    });
  });

  describe("a saved session is a hint, not permission", () => {
    it("refuses one whose admitted owner is a different copy, and forgets it", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-b", "sess-b"));
      // Now the same key names a session the server says belongs to the peer —
      // a backend the operator has switched to, or data that moved.
      getSession.mockResolvedValue({
        id: "sess-b",
        flowId: "engineer-a",
        flowKind: "engineer",
        userId: "u1",
      });

      await act(async () => ctx.selectInstance(null));
      await act(async () => ctx.selectInstance("engineer-b"));
      await settle();

      expect(ctx.activeSessionId).toBeNull();
      expect(
        localStorage.getItem("fsd.devtool.activeSession.|u1|engineer-b"),
      ).toBeNull();
    });

    it("refuses one the server says is not there", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-b", "sess-b"));
      getSession.mockRejectedValue(
        new ClientHttpError("gone", { status: 404, body: {} }),
      );

      await act(async () => ctx.selectInstance(null));
      await act(async () => ctx.selectInstance("engineer-b"));
      await settle();

      expect(ctx.activeSessionId).toBeNull();
      // A definite "not there" is worth acting on.
      expect(
        localStorage.getItem("fsd.devtool.activeSession.|u1|engineer-b"),
      ).toBeNull();
    });

    it("keeps a hint the server merely failed to answer for, and restores it later", async () => {
      // The asymmetry that matters: wrongly keeping a hint costs one failed
      // restore that revalidates next time; wrongly deleting one is
      // unrecoverable, and a single blip would silently turn off session
      // restore for this operator on every reload afterwards.
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-b", "sess-b"));
      getSession.mockRejectedValue(
        new ClientHttpError("server error", { status: 500, body: {} }),
      );

      await act(async () => ctx.selectInstance(null));
      await act(async () => ctx.selectInstance("engineer-b"));
      await settle();

      expect(ctx.activeSessionId).toBeNull();
      expect(
        localStorage.getItem("fsd.devtool.activeSession.|u1|engineer-b"),
      ).toBe("sess-b");

      // The outage clears; the next attempt restores it.
      getSession.mockReset().mockResolvedValue({
        id: "sess-b",
        flowId: "engineer-b",
        flowKind: "engineer",
        userId: "u1",
      });
      await act(async () => ctx.selectInstance(null));
      await act(async () => ctx.selectInstance("engineer-b"));
      await settle();

      expect(ctx.activeSessionId).toBe("sess-b");
    });

    it("installs one the server confirms belongs to the selected copy", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-b", "sess-b"));
      getSession.mockResolvedValue({
        id: "sess-b",
        flowId: "engineer-b",
        flowKind: "engineer",
        userId: "u1",
      });

      await act(async () => ctx.selectInstance(null));
      await act(async () => ctx.selectInstance("engineer-b"));
      await settle();

      expect(ctx.activeSessionId).toBe("sess-b");
    });

    it("never offers one copy's hint to its peer", async () => {
      await mount();
      await act(async () => ctx.selectWorkspace("engineer-a", "sess-a"));
      getSession.mockResolvedValue({
        id: "sess-a",
        flowId: "engineer-a",
        flowKind: "engineer",
        userId: "u1",
      });

      await act(async () => ctx.selectInstance("engineer-b"));
      await settle();

      // The peer has no hint of its own, so nothing is read and nothing opens.
      expect(getSession).not.toHaveBeenCalled();
      expect(ctx.activeSessionId).toBeNull();
    });
  });

  describe("singleton compatibility", () => {
    it("accepts a kind-keyed hint written by an earlier panel, once validated", async () => {
      // A singleton's id IS its kind, so there is exactly one possible owner and
      // nothing is being guessed.
      localStorage.setItem("fsd.devtool.activeSession.reports", "sess-legacy");
      getSession.mockResolvedValue({
        id: "sess-legacy",
        flowKind: "reports",
        userId: "u1",
      });
      await mount();

      await act(async () => ctx.selectInstance("reports"));
      await settle();

      expect(ctx.activeSessionId).toBe("sess-legacy");
    });

    it("does not offer a kind-keyed hint to a collection member", async () => {
      // `engineer` names two copies. A session saved under the kind could belong
      // to either, so it is offered to neither.
      localStorage.setItem("fsd.devtool.activeSession.engineer", "sess-ambiguous");
      await mount();

      await act(async () => ctx.selectInstance("engineer-a"));
      await settle();

      expect(getSession).not.toHaveBeenCalled();
      expect(ctx.activeSessionId).toBeNull();
    });

    it("drops a legacy hint the server says is gone", async () => {
      localStorage.setItem("fsd.devtool.activeSession.reports", "sess-gone");
      getSession.mockRejectedValue(
        new ClientHttpError("gone", { status: 404, body: {} }),
      );
      await mount();

      await act(async () => ctx.selectInstance("reports"));
      await settle();

      expect(ctx.activeSessionId).toBeNull();
      expect(localStorage.getItem("fsd.devtool.activeSession.reports")).toBeNull();
    });
  });

  describe("a credential change", () => {
    it("retires the visit and drops the previous operator's session", async () => {
      await mount("u1");
      await act(async () => ctx.selectWorkspace("engineer-a", "sess-a"));
      const before = ctx.workspaceToken;

      await act(async () => ctx.setConfig({ userId: "u2" }));

      // A conversation belongs to the operator who was signed in. Re-reading it
      // under another identity is either refused or, worse, a disclosure.
      expect(ctx.activeSessionId).toBeNull();
      expect(ctx.workspaceToken).toBeGreaterThan(before);
    });

    it("retires the visit on a token-only change, with the ids unmoved", async () => {
      await mount("u1");
      await act(async () => ctx.selectWorkspace("engineer-a", "sess-a"));
      const before = ctx.workspaceToken;

      await act(async () => ctx.setConfig({ userId: "u1", bearerToken: "t2" }));

      // Nothing visible moved, but every read in flight was made by the client
      // built for the previous credentials.
      expect(ctx.activeFlowId).toBe("engineer-a");
      expect(ctx.activeSessionId).toBe("sess-a");
      expect(ctx.workspaceToken).toBeGreaterThan(before);
    });
  });
});
