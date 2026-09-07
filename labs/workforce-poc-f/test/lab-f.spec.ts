/**
 * Atlas §10 proof: address-the-team is an intake worker's static DM.
 * Routing is claim / ordered-reply / fan-out on today's taskBoard.
 * Dispatcher into a member-flow session is the named gap — stop, do not invent.
 */
import { describe, expect, it } from "vitest";
import { bootLab } from "../src/bootstrap";
import { replyTaskId } from "../src/helpers";
import {
  ENGINEERING,
  INTAKE_KIND,
  MARKETING,
  MEMBER_KIND,
  memberSeats,
  openTeamInbox,
  parseRoute,
} from "../src/roster";

describe("lab F — team intake without TeamFlow", () => {
  it("openTeamInbox looks up the intake seat; two roster keys are two sessions", () => {
    const eng = openTeamInbox("engineering");
    const mkt = openTeamInbox("marketing");
    expect(eng).toMatchObject({
      seat: "intake",
      flowKind: INTAKE_KIND,
      sessionId: "talk-to-eng",
    });
    expect(mkt.sessionId).toBe("talk-to-mkt");
    expect(eng.sessionId).not.toBe(mkt.sessionId);
    expect(eng.flowKind).toBe(mkt.flowKind);
  });

  it("parseRoute picks claim / ordered / fan-out from the message", () => {
    expect(parseRoute("@alice take the API review", ENGINEERING)).toBe("claim");
    expect(parseRoute("ordered: status from each of you", ENGINEERING)).toBe(
      "ordered",
    );
    expect(parseRoute("standup in 10", ENGINEERING)).toBe("fan-out");
    expect(parseRoute("@nobody is not a seat", ENGINEERING)).toBe("fan-out");
  });

  it("talk-to-eng is the intake session; talk stays there — not a TeamFlow", async () => {
    const host = await bootLab();
    try {
      const inbox = await host.openInbox(ENGINEERING.id);
      expect(inbox).toMatchObject({
        id: "talk-to-eng",
        flowKind: INTAKE_KIND,
      });
      expect(inbox.flowKind).not.toBe(MEMBER_KIND);
      expect(INTAKE_KIND).not.toBe(MEMBER_KIND);

      const talked = await host.call(
        inbox.flowKind,
        "talk",
        {
          message: "@alice take the API review",
          roster: ENGINEERING.id,
          postId: "p-dm",
        },
        inbox.id,
      );
      expect(talked.error).toBeUndefined();
      expect(talked.output).toMatchObject({
        sessionId: "talk-to-eng",
        roster: "engineering",
        route: "claim",
        seat: "alice",
      });

      const state = await host.sessionState("talk-to-eng");
      expect(state?.lastTalk).toBe("@alice take the API review");
    } finally {
      await host.dispose();
    }
  });

  it("claim route: message to intake files one task; that member session picks it up", async () => {
    const host = await bootLab();
    try {
      const inbox = await host.openInbox(ENGINEERING.id);
      for (const seat of memberSeats(ENGINEERING)) {
        await host.createSession(seat.flowKind, seat.sessionId, seat.sessionId);
      }

      const talked = await host.call(
        inbox.flowKind,
        "talk",
        {
          message: "@alice take the API review",
          roster: ENGINEERING.id,
          postId: "p-claim",
        },
        inbox.id,
      );
      expect(talked.error).toBeUndefined();
      expect(talked.output).toMatchObject({
        route: "claim",
        taskIds: ["p-claim"],
        seat: "alice",
      });

      const bob = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "bob" },
        "dm-bob",
      );
      expect(bob.output).toMatchObject({ claimed: false, reason: "not-claimable" });

      const alice = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "alice" },
        "dm-alice",
      );
      expect(alice.error).toBeUndefined();
      expect(alice.output).toMatchObject({
        sessionId: "dm-alice",
        claimed: true,
        taskId: "p-claim",
      });

      const aliceState = await host.sessionState("dm-alice");
      expect(aliceState?.lastPickup).toMatchObject({
        taskId: "p-claim",
        body: "@alice take the API review",
      });
    } finally {
      await host.dispose();
    }
  });

  it("ordered route: files deps; later seats stay unclaimable until the prior completes", async () => {
    const host = await bootLab();
    try {
      const inbox = await host.openInbox(ENGINEERING.id);
      for (const seat of memberSeats(ENGINEERING)) {
        await host.createSession(seat.flowKind, seat.sessionId, seat.sessionId);
      }

      const talked = await host.call(
        inbox.flowKind,
        "talk",
        {
          message: "ordered: status from each of you",
          roster: ENGINEERING.id,
          postId: "p-ord",
        },
        inbox.id,
      );
      expect(talked.error).toBeUndefined();
      expect(talked.output).toMatchObject({
        route: "ordered",
        taskIds: [
          replyTaskId("p-ord", "alice"),
          replyTaskId("p-ord", "bob"),
          replyTaskId("p-ord", "cara"),
        ],
      });

      const bobFirst = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "bob", taskId: replyTaskId("p-ord", "bob") },
        "dm-bob",
      );
      expect(bobFirst.output).toMatchObject({ claimed: false });

      const alice = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "alice", taskId: replyTaskId("p-ord", "alice") },
        "dm-alice",
      );
      expect(alice.output).toMatchObject({ claimed: true });

      const bobSecond = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "bob", taskId: replyTaskId("p-ord", "bob") },
        "dm-bob",
      );
      expect(bobSecond.output).toMatchObject({ claimed: true });

      const cara = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "cara", taskId: replyTaskId("p-ord", "cara") },
        "dm-cara",
      );
      expect(cara.output).toMatchObject({ claimed: true });
    } finally {
      await host.dispose();
    }
  });

  it("fan-out files N member tasks; dispatcher into a member-flow session is refused", async () => {
    const host = await bootLab();
    try {
      const inbox = await host.openInbox(ENGINEERING.id);
      for (const seat of memberSeats(ENGINEERING)) {
        await host.createSession(seat.flowKind, seat.sessionId, seat.sessionId);
      }

      const talked = await host.call(
        inbox.flowKind,
        "talk",
        {
          message: "standup in 10",
          roster: ENGINEERING.id,
          postId: "p-fan",
        },
        inbox.id,
      );
      expect(talked.error).toBeUndefined();
      expect(talked.output).toMatchObject({
        route: "fan-out",
        taskIds: [
          replyTaskId("p-fan", "alice"),
          replyTaskId("p-fan", "bob"),
          replyTaskId("p-fan", "cara"),
        ],
      });

      const wake = await host.call(
        inbox.flowKind,
        "wake",
        {
          sessionId: "dm-alice",
          postId: "p-fan",
          body: "should refuse",
          fromSessionId: inbox.id,
        },
        inbox.id,
      );
      expect(wake.error?.message).toMatch(/session-not-addressable/);
      expect(wake.error?.message).toMatch(/cross-flow delivery is not supported/);

      const aliceState = await host.sessionState("dm-alice");
      expect(aliceState?.lastPickup ?? null).toBeNull();

      const alice = await host.call(
        MEMBER_KIND,
        "pickup",
        { seat: "alice", taskId: replyTaskId("p-fan", "alice") },
        "dm-alice",
      );
      expect(alice.output).toMatchObject({ claimed: true, sessionId: "dm-alice" });
    } finally {
      await host.dispose();
    }
  });

  it("marketing inbox is a different session than engineering — no theTeam", async () => {
    const host = await bootLab();
    try {
      const eng = await host.openInbox(ENGINEERING.id);
      const mkt = await host.openInbox(MARKETING.id);
      expect(eng.id).toBe("talk-to-eng");
      expect(mkt.id).toBe("talk-to-mkt");
      expect(eng.id).not.toBe(mkt.id);
      expect(eng.flowKind).toBe(INTAKE_KIND);
      expect(mkt.flowKind).toBe(INTAKE_KIND);
    } finally {
      await host.dispose();
    }
  });
});
