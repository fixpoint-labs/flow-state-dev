/**
 * Atlas lock proof: one-worker factory → create_session DM → N subscriber wakes.
 *
 * These tests fail if the hop invents a shared group session, skips
 * `create_session`, or delivers across flow kinds.
 */
import { describe, expect, it } from "vitest";
import { bootLab, clerkWorker, until } from "../src/bootstrap";
import { createWorkerFlow, readWorkerFolder } from "../src/factory";
import { CLERK_FOLDER } from "../src/bootstrap";

const SUBSCRIBERS = ["sub-alice", "sub-bob", "sub-cara"] as const;

describe("lab A — factory / DM / group fan-out", () => {
  it("factory reads the worker folder and emits one flow of that kind", () => {
    const config = readWorkerFolder(CLERK_FOLDER);
    expect(config).toMatchObject({
      name: "clerk",
      tools: ["board", "notes"],
      skills: ["file-note"]
    });
    expect(config.role.length).toBeGreaterThan(0);

    const flow = createWorkerFlow(config);
    expect(flow.kind).toBe("clerk");
    expect(flow.actions.talk).toBeDefined();
    expect(flow.actions.post).toBeDefined();
    expect(flow.internal?.actions.receive).toBeDefined();
  });

  it("bootstrap opens a DM via create_session; talk stays on that session", async () => {
    const clerk = clerkWorker();
    const host = await bootLab({ [clerk.kind]: clerk });
    try {
      const dm = await host.createSession(clerk.kind, "talk-to-clerk", "talk-to-clerk");
      expect(dm).toMatchObject({ id: "talk-to-clerk", flowKind: "clerk" });

      const who = await host.call(clerk.kind, "whoami", {}, dm.id);
      expect(who.error).toBeUndefined();
      expect(who.output).toMatchObject({
        kind: "clerk",
        tools: ["board", "notes"],
        skills: ["file-note"]
      });

      const talked = await host.call(clerk.kind, "talk", { message: "hello clerk" }, dm.id);
      expect(talked.error).toBeUndefined();
      expect(talked.output).toEqual({
        sessionId: "talk-to-clerk",
        heard: "hello clerk"
      });

      const state = await host.sessionState("talk-to-clerk");
      expect(state?.lastTalk).toBe("hello clerk");
      expect(state?.lastWake).toBeNull();
    } finally {
      await host.dispose();
    }
  });

  it("a board post wakes N subscriber sessions — not one shared group session", async () => {
    const clerk = clerkWorker();
    const host = await bootLab({ [clerk.kind]: clerk });
    try {
      const dm = await host.createSession(clerk.kind, "talk-to-clerk", "talk-to-clerk");
      const subs = [];
      for (const id of SUBSCRIBERS) {
        subs.push(await host.createSession(clerk.kind, id, id));
      }

      for (const sub of subs) {
        const subscribed = await host.call(clerk.kind, "subscribe", {}, sub.id);
        expect(subscribed.error).toBeUndefined();
      }

      const posted = await host.call(clerk.kind, "post", { body: "standup in 10" }, dm.id);
      expect(posted.error).toBeUndefined();
      const handles = (posted.output as { sessionId?: string }[]) ?? [];
      expect(handles).toHaveLength(SUBSCRIBERS.length);
      const wokenIds = new Set(handles.map((h) => h.sessionId));
      expect(wokenIds).toEqual(new Set(SUBSCRIBERS));
      expect(wokenIds.has(dm.id)).toBe(false);

      await until(async () => {
        const states = await Promise.all(subs.map((s) => host.sessionState(s.id)));
        return states.every((state) => state?.lastWake != null);
      }, "each subscriber session to record its own wake");

      for (const sub of subs) {
        const state = await host.sessionState(sub.id);
        expect(state?.lastWake).toMatchObject({
          body: "standup in 10",
          fromSessionId: dm.id
        });
      }

      const dmState = await host.sessionState(dm.id);
      expect(dmState?.lastWake).toBeNull();
    } finally {
      await host.dispose();
    }
  });

  it("dispatcher { id } into another flow kind is session-not-addressable", async () => {
    const clerk = clerkWorker();
    const editor = createWorkerFlow({
      name: "editor",
      role: "edit copy",
      personality: "brief",
      tools: [],
      skills: []
    });
    const host = await bootLab({ [clerk.kind]: clerk, [editor.kind]: editor });
    try {
      const clerkDm = await host.createSession(clerk.kind, "talk-to-clerk", "talk-to-clerk");
      const editorDm = await host.createSession(editor.kind, "talk-to-editor", "talk-to-editor");

      const cross = await host.call(
        clerk.kind,
        "deliver",
        {
          sessionId: editorDm.id,
          postId: "cross",
          body: "should refuse",
          fromSessionId: clerkDm.id
        },
        clerkDm.id
      );

      expect(cross.error?.message).toMatch(/session-not-addressable/);
      expect(cross.error?.message).toMatch(/cross-flow delivery is not supported/);

      const editorState = await host.sessionState(editorDm.id);
      expect(editorState?.lastWake ?? null).toBeNull();
    } finally {
      await host.dispose();
    }
  });
});
