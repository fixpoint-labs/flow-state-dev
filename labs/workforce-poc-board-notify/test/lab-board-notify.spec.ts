/**
 * FIX-1311 static notify proof: post → reactTo → declared dispatcher → onNotify.
 *
 * These tests fail if notify invents a dynamic address, skips reactTo, or
 * prunes a live subscriber on a transient refusal.
 */
import { describe, expect, it } from "vitest";
import type { DispatchRefusal } from "@flow-state-dev/core";
import { bootLab, until } from "../src/bootstrap";
import {
  DECLARED_SEATS,
  FLOW_KIND,
  NOTIFY_ENTRY,
  boardNotifyFlow,
  notifyAlice,
  notifyBob
} from "../src/flow";
import { shouldPruneSubscription } from "../src/prune";

const TOPIC = "standup";

async function openSubscribedBoard(
  host: Awaited<ReturnType<typeof bootLab>>,
  opts?: { ghost?: boolean; posterAsAlice?: boolean; inventedEntry?: boolean }
) {
  const poster = await host.createSession(FLOW_KIND, "poster", "poster");
  const alice = await host.createSession(FLOW_KIND, "alice", "alice");
  const bob = await host.createSession(FLOW_KIND, "bob", "bob");
  expect(poster.status).toBe(201);
  expect(alice.status).toBe(201);
  expect(bob.status).toBe(201);

  const opened = await host.call(FLOW_KIND, "openBoard", { topic: TOPIC }, poster.id);
  expect(opened.error).toBeUndefined();

  if (opts?.posterAsAlice) {
    const sub = await host.call(FLOW_KIND, "subscribe", { topic: TOPIC, seat: "alice" }, poster.id);
    expect(sub.error).toBeUndefined();
  } else {
    const sub = await host.call(FLOW_KIND, "subscribe", { topic: TOPIC, seat: "alice" }, alice.id);
    expect(sub.error).toBeUndefined();
  }

  const bobSub = await host.call(
    FLOW_KIND,
    "subscribe",
    {
      topic: TOPIC,
      seat: "bob",
      ...(opts?.inventedEntry ? { entry: "invented-from-data" } : {})
    },
    bob.id
  );
  expect(bobSub.error).toBeUndefined();

  if (opts?.ghost) {
    const ghost = await host.call(
      FLOW_KIND,
      "subscribe",
      { topic: TOPIC, seat: "bob", sessionId: "ghost-gone" },
      poster.id
    );
    expect(ghost.error).toBeUndefined();
  }

  return { poster, alice, bob };
}

describe("lab — static board notify (FIX-1311)", () => {
  it("declares two dispatchers, both targeting the same static onNotify entry", () => {
    expect(DECLARED_SEATS).toEqual(["alice", "bob"]);
    expect(notifyAlice.dispatch).toEqual({ type: "internal", target: NOTIFY_ENTRY });
    expect(notifyBob.dispatch).toEqual({ type: "internal", target: NOTIFY_ENTRY });
    expect(boardNotifyFlow.internal?.actions[NOTIFY_ENTRY]).toBeDefined();
    expect(boardNotifyFlow.internal?.actions.notifyOnChange).toBeDefined();
  });

  it("prunes only no-entry and session-not-found — never dispatch-rejected", () => {
    const prune: DispatchRefusal[] = ["no-entry", "session-not-found"];
    const keep: DispatchRefusal[] = [
      "dispatch-rejected",
      "session-not-addressable",
      "external-dispatcher",
      "no-dispatch-operation",
      "key-occupied",
      "no-sender"
    ];
    for (const refused of prune) {
      expect(shouldPruneSubscription(refused)).toBe(true);
    }
    for (const refused of keep) {
      expect(shouldPruneSubscription(refused)).toBe(false);
    }
  });

  it("create_session of an existing id is 409 — FIX-1246 is not papered over", async () => {
    const host = await bootLab();
    try {
      const first = await host.createSession(FLOW_KIND, "same-room", "same-room");
      const again = await host.createSession(FLOW_KIND, "same-room", "same-room");
      expect(first.status).toBe(201);
      expect(again.status).toBe(409);
      expect(again.error).toMatch(/already exists/i);
    } finally {
      await host.dispose();
    }
  });

  it("post → reactTo → static notify lands on each subscriber's onNotify entry", async () => {
    const host = await bootLab();
    try {
      const { poster, alice, bob } = await openSubscribedBoard(host, { inventedEntry: true });

      const posted = await host.call(
        FLOW_KIND,
        "post",
        { topic: TOPIC, body: "standup in 10", brief: "daily standup" },
        poster.id
      );
      expect(posted.error).toBeUndefined();
      expect(posted.output).toMatchObject({ topic: TOPIC, brief: "daily standup" });

      await until(async () => {
        const [a, b] = await Promise.all([
          host.sessionState(alice.id),
          host.sessionState(bob.id)
        ]);
        return a?.lastNotify != null && b?.lastNotify != null;
      }, "alice and bob lastNotify");

      const aliceState = await host.sessionState(alice.id);
      const bobState = await host.sessionState(bob.id);
      expect(aliceState?.lastNotify).toMatchObject({
        topic: TOPIC,
        body: "standup in 10",
        fromSessionId: poster.id,
        seat: "alice"
      });
      expect(bobState?.lastNotify).toMatchObject({
        topic: TOPIC,
        body: "standup in 10",
        fromSessionId: poster.id,
        seat: "bob"
      });

      const posterState = await host.sessionState(poster.id);
      expect(posterState?.lastNotify ?? null).toBeNull();

      const read = await host.call(FLOW_KIND, "read", { topic: TOPIC }, poster.id);
      expect(read.error).toBeUndefined();
      expect(read.output).toMatchObject({
        topic: TOPIC,
        brief: "daily standup",
        retired: false
      });
      const board = read.output as { subscribers: Array<{ entry: string; seat: string }> };
      expect(board.subscribers.some((s) => s.entry === "invented-from-data")).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  it("subscribe alone does not notify — reactTo is gated on a new thread row", async () => {
    const host = await bootLab();
    try {
      const { alice } = await openSubscribedBoard(host);
      const state = await host.sessionState(alice.id);
      expect(state?.lastNotify ?? null).toBeNull();
    } finally {
      await host.dispose();
    }
  });

  it("prunes session-not-found and keeps a live sibling", async () => {
    const host = await bootLab();
    try {
      const { poster, alice, bob } = await openSubscribedBoard(host, { ghost: true });

      const posted = await host.call(
        FLOW_KIND,
        "post",
        { topic: TOPIC, body: "ghost should drop" },
        poster.id
      );
      expect(posted.error).toBeUndefined();

      await until(async () => {
        const [a, b] = await Promise.all([
          host.sessionState(alice.id),
          host.sessionState(bob.id)
        ]);
        return a?.lastNotify != null && b?.lastNotify != null;
      }, "live subscribers to wake");

      await until(async () => {
        const read = await host.call(FLOW_KIND, "read", { topic: TOPIC }, poster.id);
        const board = read.output as { subscribers: Array<{ sessionId: string }> };
        return board.subscribers.every((s) => s.sessionId !== "ghost-gone");
      }, "ghost subscriber to prune");

      const read = await host.call(FLOW_KIND, "read", { topic: TOPIC }, poster.id);
      const board = read.output as { subscribers: Array<{ sessionId: string; seat: string }> };
      expect(board.subscribers.map((s) => s.sessionId).sort()).toEqual(["alice", "bob"]);
    } finally {
      await host.dispose();
    }
  });

  it("same-session notify from reactTo lands — and the poster stays subscribed", async () => {
    const host = await bootLab();
    try {
      const { poster, bob } = await openSubscribedBoard(host, { posterAsAlice: true });

      const posted = await host.call(
        FLOW_KIND,
        "post",
        { topic: TOPIC, body: "poster is also a subscriber" },
        poster.id
      );
      expect(posted.error).toBeUndefined();

      await until(async () => {
        const [p, b] = await Promise.all([
          host.sessionState(poster.id),
          host.sessionState(bob.id)
        ]);
        return p?.lastNotify != null && b?.lastNotify != null;
      }, "poster and bob to wake");

      const read = await host.call(FLOW_KIND, "read", { topic: TOPIC }, poster.id);
      const board = read.output as { subscribers: Array<{ sessionId: string; seat: string }> };
      expect(board.subscribers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sessionId: poster.id, seat: "alice" }),
          expect.objectContaining({ sessionId: bob.id, seat: "bob" })
        ])
      );
    } finally {
      await host.dispose();
    }
  });

  it("does not prune session-not-addressable (cross-flow) — do not invent around #1600", async () => {
    const host = await bootLab();
    try {
      const { poster, alice } = await openSubscribedBoard(host);
      const other = await host.createSession("other-kind", "editor-dm", "editor-dm");
      expect(other.status).toBe(201);

      const crossed = await host.call(
        FLOW_KIND,
        "subscribe",
        { topic: TOPIC, seat: "bob", sessionId: other.id, flow: "other-kind" },
        poster.id
      );
      expect(crossed.error).toBeUndefined();

      const posted = await host.call(
        FLOW_KIND,
        "post",
        { topic: TOPIC, body: "cross-flow stays subscribed" },
        poster.id
      );
      expect(posted.error).toBeUndefined();

      await until(async () => {
        const state = await host.sessionState(alice.id);
        return state?.lastNotify != null;
      }, "alice to wake");

      const read = await host.call(FLOW_KIND, "read", { topic: TOPIC }, poster.id);
      const board = read.output as { subscribers: Array<{ sessionId: string }> };
      expect(board.subscribers.some((s) => s.sessionId === other.id)).toBe(true);

      const otherState = await host.sessionState(other.id);
      expect(otherState?.lastNotify ?? null).toBeNull();
    } finally {
      await host.dispose();
    }
  });
});
