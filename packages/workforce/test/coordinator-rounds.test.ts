/**
 * The coordinator's two fixed policies beyond best fit, and rounds: how far a
 * delegate's answer goes back out.
 *
 * What is graded is who heard what (the `helper` flow records every delivery
 * it hears), what landed in the conversation, the `coordinator-route`
 * records, and the delivery ledger, never a router's internal decision.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1791/BUSINESS-RULES.md`, V3 and V5):
 *   BR-17  round robin: the next delegate in list order takes each person's post, skipping one
 *          that can't be reached; the turn survives an edit to the list;
 *   BR-18  everyone: each delegate that can be reached gets the post once;
 *   BR-19  a conversation with no delegate that can be reached: nobody runs, recorded and said;
 *   BR-23  at `rounds: 0` an answer goes back out to nobody;
 *   BR-24  below the limit: best fit and round robin route each answer again, never to its author;
 *          everyone hands each delegate the others' answers when the round closes; judgment wakes
 *          the coordinator's turn once per closed round;
 *   BR-24a a judgment hand-off in a wake is the next round's, once per delegate;
 *   BR-24b a round closes without a delegate whose turn failed or whose run was cancelled, at once,
 *          and without a slow one at its deadline; the late answer lands once and goes no further;
 *          a round whose delegate says nothing closes on the conversation's next wake after its
 *          deadline, once; past 50 open rounds the oldest is no longer tracked;
 *   BR-25  at the limit an answer goes nowhere and wakes nothing;
 *   BR-21, BR-22  an answer sent twice goes back out once; a report on a token no delivery carries
 *          is refused;
 *   BR-27  a post and a hand-off can't carry a round; no caller reaches the route-on entry;
 *   BR-28  every decision, in every round, is one `coordinator-route` record.
 */
import { describe, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator } from "@flow-state-dev/testing";
import {
  MAX_OPEN_ROUNDS,
  beginRound,
  closeRound,
  endRound,
  landAnswer,
  roundDeadline,
  routeOnAfterAnswer,
  routeOnAfterClose
} from "../src/coordinator/coordinator-rounds";
import type { OpenRound } from "../src/coordinator/coordinator-delegates";
import { claimAnswer, openDelivery, type DeliveryLedger, type DeliveryRecord } from "../src/delivery-ledger";
import { bootHost, messageOf, standardWorkers } from "./coordinator-harness";

type Host = ReturnType<typeof bootHost>;

const heardBy = (host: Host) => host.heard.map((h) => h.worker);

async function post(host: Host, sessionId: string, message: string, userId = "alice") {
  const result = await host.act(userId, sessionId, "run", { message });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  await host.settled();
  return result;
}

async function act(host: Host, sessionId: string, action: string, input: unknown) {
  const result = await host.act("alice", sessionId, action, input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result;
}

describe("round robin (V3)", () => {
  it("hands each person's post to the next delegate in list order, with no model call (BR-17, BR-28)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "round-robin" } }) });
    const id = await host.conversation("alice", "desk");
    for (const message of ["one", "two", "three", "four"]) await post(host, id, message);
    expect(heardBy(host)).toEqual(["eng.em", "eng.coder", "support.general", "eng.em"]);
    expect(host.route.calls).toHaveLength(0);
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.by, record.round, record.delegates])).toEqual([
      ["round-robin", 0, [{ worker: "eng.em", outcome: "delivered" }]],
      ["round-robin", 0, [{ worker: "eng.coder", outcome: "delivered" }]],
      ["round-robin", 0, [{ worker: "support.general", outcome: "delivered" }]],
      ["round-robin", 0, [{ worker: "eng.em", outcome: "delivered" }]]
    ]);
  });

  it("skips a delegate that can't be reached, and goes on from where it stood when the last one is removed (BR-17, BR-9)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "round-robin" } }) });
    expect((await host.hire("alice", { id: "temp", flow: "helper", description: "Temporary." })).error).toBeUndefined();
    const id = await host.conversation("alice", "desk");
    await act(host, id, "addDelegate", { worker: "temp" });
    // eng.em, eng.coder, support.general, temp
    await post(host, id, "one");
    await post(host, id, "two");
    // The last turn was eng.coder's. Removing it, the turn goes on from its place.
    await act(host, id, "removeDelegate", { worker: "eng.coder" });
    await post(host, id, "three");
    // Fired, temp is skipped and the turn wraps to the top.
    expect((await host.fire("alice", "temp")).error).toBeUndefined();
    await post(host, id, "four");
    expect(heardBy(host)).toEqual(["eng.em", "eng.coder", "support.general", "eng.em"]);
    const last = (await host.items(id)).records.at(-1);
    expect(last.by).toBe("round-robin");
    expect(last.delegates).toEqual([
      { worker: "eng.em", outcome: "delivered" },
      { worker: "temp", outcome: "skipped", reason: 'No worker "temp" on your roster.' }
    ]);
  });

  it("gives two posts that arrive together two different turns (BR-17)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "round-robin" } }) });
    const id = await host.conversation("alice", "desk");
    // Each roster check takes a while, so both posts are choosing at once.
    const read = host.installation.rosterWorker;
    host.installation.rosterWorker = async (ctx, workerId) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return read(ctx, workerId);
    };
    const [one, two] = await Promise.all([
      host.act("alice", id, "run", { message: "one" }),
      host.act("alice", id, "run", { message: "two" })
    ]);
    expect(one.error, messageOf(one.error)).toBeUndefined();
    expect(two.error, messageOf(two.error)).toBeUndefined();
    await host.settled();
    expect([...heardBy(host)].sort()).toEqual(["eng.coder", "eng.em"]);
  });

  it("runs nobody when no delegate can be reached, and says so (BR-19)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "round-robin", fallback: undefined } }) });
    const id = await host.conversation("alice", "desk");
    for (const worker of ["eng.em", "eng.coder", "support.general"]) await act(host, id, "removeDelegate", { worker });
    await post(host, id, "anyone there?");
    expect(host.heard).toEqual([]);
    const { records, messages } = await host.items(id);
    expect(records).toEqual([
      expect.objectContaining({ by: "unplaced", policy: "round-robin", none: "no delegate in this conversation can be reached" })
    ]);
    expect(messages.at(-1)!.text).toBe("Nobody took this post: no delegate in this conversation can be reached.");
  });
});

describe("everyone (V3)", () => {
  it("hands the post to each delegate that can be reached, once, recorded by everyone (BR-18, BR-28)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "everyone" } }) });
    expect((await host.hire("alice", { id: "temp", flow: "helper", description: "Temporary." })).error).toBeUndefined();
    const id = await host.conversation("alice", "desk");
    await act(host, id, "addDelegate", { worker: "temp" });
    expect((await host.fire("alice", "temp")).error).toBeUndefined();

    await post(host, id, "standup notes, please");
    expect([...heardBy(host)].sort()).toEqual(["eng.coder", "eng.em", "support.general"]);
    // No model call picks anyone.
    expect(host.route.calls).toHaveLength(0);
    const { records, messages } = await host.items(id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ round: 0, policy: "everyone", by: "everyone" });
    expect(records[0].delegates).toEqual(
      expect.arrayContaining([
        { worker: "eng.em", outcome: "delivered" },
        { worker: "eng.coder", outcome: "delivered" },
        { worker: "support.general", outcome: "delivered" },
        { worker: "temp", outcome: "skipped", reason: 'No worker "temp" on your roster.' }
      ])
    );
    expect(records[0].delegates).toHaveLength(4);
    const lines = messages.filter((m) => m.agentName !== undefined).map((m) => m.agentName);
    expect([...lines].sort()).toEqual(["eng.coder", "eng.em", "support.general"]);
  });

  it("runs nobody when no delegate can be reached, and says so (BR-19)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "everyone", fallback: undefined } }) });
    const id = await host.conversation("alice", "desk");
    for (const worker of ["eng.em", "eng.coder", "support.general"]) await act(host, id, "removeDelegate", { worker });

    await post(host, id, "anyone there?");
    expect(host.heard).toEqual([]);
    const { records, messages } = await host.items(id);
    expect(records).toEqual([expect.objectContaining({ by: "unplaced", policy: "everyone", delegates: [] })]);
    expect(records[0].none).toMatch(/no delegate in this conversation can be reached/);
    expect(messages.at(-1)!.text).toMatch(/^Nobody took this post: /);
  });
});

/**
 * Every request settled, read again after a grace period, until nothing new
 * starts: answers that go back out run in requests of their own.
 */
async function quiet(host: Host) {
  let seen = -1;
  for (;;) {
    const settled = await host.settled();
    if (settled.length === seen) return settled;
    seen = settled.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The delegates' lines in the conversation, oldest first. */
async function answers(host: Host, sessionId: string) {
  return (await host.items(sessionId)).messages.filter(
    (m) => m.agentName !== undefined && m.agentName !== "coordinator-judgment"
  );
}

/** A two-delegate coordinator, `eng.em` then `eng.coder`, on `routing` with `rounds`. */
function pairDesk(routing: string, rounds: number) {
  return standardWorkers({ desk: { routing, rounds, delegates: ["eng.em", "eng.coder"], fallback: undefined } });
}

describe("a round, on its own (V5)", () => {
  it("refuses a round deadline that isn't a positive whole number of milliseconds", () => {
    for (const roundDeadlineMs of [0, -1, 0.5, 1_500.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => bootHost({ roundDeadlineMs })).toThrow(/roundDeadlineMs must be a positive whole number of milliseconds/);
    }
  });

  const delegate = { worker: "eng.em" };
  const opened = (round = 0) => openDelivery([], { postId: "p1", round, delegate }, "t1").ledger;

  it("waits while a routing still adds to it, and shares one deadline across its deliveries (BR-24b)", () => {
    let rounds = beginRound([], "p1", 0).rounds;
    const first = roundDeadline(rounds, "p1", 0, 1_000, 500);
    expect(first.deadlineAt).toBe(1_500);
    rounds = first.rounds;
    expect(roundDeadline(rounds, "p1", 0, 1_200, 500).deadlineAt).toBe(1_500);
    // A round nobody opened carries no deadline: nothing waits for it.
    expect(roundDeadline(rounds, "p1", 1, 1_200, 500).deadlineAt).toBeUndefined();

    const answered = (claimAnswer(opened(), "t1") as { ledger: DeliveryLedger }).ledger;
    // Every delivery ended, but the routing hasn't finished adding: still open.
    expect(closeRound(rounds, answered, "p1", 0, 1_200).closed).toBeUndefined();
    expect(closeRound(endRound(rounds, "p1", 0), answered, "p1", 0, 1_200).closed).toMatchObject({ deliveries: 1 });
    // A delivery still out holds it open until the deadline, then not.
    const ended = endRound(rounds, "p1", 0);
    expect(closeRound(ended, opened(), "p1", 0, 1_499).closed).toBeUndefined();
    expect(closeRound(ended, opened(), "p1", 0, 1_500).closed).toMatchObject({ round: 0, answers: [] });
  });

  it("closes without an answer that comes after the deadline, which then goes nowhere (BR-24b)", () => {
    const rounds = endRound(roundDeadline(beginRound([], "p1", 0).rounds, "p1", 0, 1_000, 500).rounds, "p1", 0);
    const claimed = claimAnswer(opened(), "t1") as { ledger: DeliveryLedger; delivery: DeliveryRecord };
    const late = landAnswer(rounds, claimed.ledger, claimed.delivery, "late", 1_600);
    expect(late).toMatchObject({ kept: false, rounds: [], closed: { answers: [] } });
    expect(routeOnAfterAnswer(claimed.delivery, "late", late.kept, "best-fit", 1)).toBeUndefined();

    const onTime = landAnswer(rounds, claimed.ledger, claimed.delivery, "on time", 1_200);
    expect(onTime).toMatchObject({ kept: true, closed: { answers: [{ worker: "eng.em", body: "on time" }] } });
    expect(routeOnAfterAnswer(claimed.delivery, "on time", onTime.kept, "best-fit", 1)).toEqual({
      postId: "p1",
      round: 1,
      answers: [{ worker: "eng.em", body: "on time" }],
      exclude: { worker: "eng.em" }
    });
    // At the limit, nowhere.
    expect(routeOnAfterAnswer(claimed.delivery, "on time", true, "best-fit", 0)).toBeUndefined();
    expect(routeOnAfterClose(onTime.closed!, "everyone", 0)).toBeUndefined();
    expect(routeOnAfterClose(onTime.closed!, "everyone", 1)).toMatchObject({ round: 1 });
  });
});

describe("rounds (V5)", () => {
  it("under everyone, hands each delegate the other's answer once at rounds 1: four answers, then none (BR-24, BR-25)", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "ship it?");
    await quiet(host);

    expect(host.heard.map((h) => [h.worker, h.message])).toEqual(
      expect.arrayContaining([
        ["eng.em", "alice, through desk: ship it?"],
        ["eng.coder", "alice, through desk: ship it?"],
        ["eng.em", "eng.coder, through desk: eng.coder heard: alice, through desk: ship it?"],
        ["eng.coder", "eng.em, through desk: eng.em heard: alice, through desk: ship it?"]
      ])
    );
    expect(host.heard).toHaveLength(4);
    expect(await answers(host, id)).toHaveLength(4);
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.round, record.by, record.delegates.map((d: any) => d.outcome)])).toEqual([
      [0, "everyone", ["delivered", "delivered"]],
      [1, "everyone", ["delivered", "delivered"]]
    ]);
    // Nothing is left waiting.
    expect((await host.sessionState(id)).openRounds).toEqual([]);
  });

  it("at rounds 0, hands nothing back out under everyone (BR-23)", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 0) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "ship it?");
    await quiet(host);
    expect(host.heard).toHaveLength(2);
    expect(await answers(host, id)).toHaveLength(2);
    expect((await host.items(id)).records).toHaveLength(1);
  });

  it("under best fit, routes an answer again in the next round, never to its author, and holds nothing for it (BR-24, BR-14)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 1 } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "who owns the release? [route:eng.em] [route:eng.coder]");
    await quiet(host);

    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder"]);
    expect(host.heard[1]!.message).toMatch(/^eng\.em, through desk: eng\.em heard: /);
    expect(host.route.calls).toHaveLength(2);
    const offered = (call: number) => Object.keys((host.route.calls[call]!.questions as any).member.criteria);
    expect(offered(0)).toEqual(["eng.em", "eng.coder", "support.general"]);
    expect(offered(1)).toEqual(["eng.coder", "support.general"]);
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.round, record.by, record.delegates])).toEqual([
      [0, "evaluated", [{ worker: "eng.em", outcome: "delivered" }]],
      [1, "evaluated", [{ worker: "eng.coder", outcome: "delivered" }]]
    ]);
    expect(await answers(host, id)).toHaveLength(2);
  });

  it("under best fit, holds nobody for the person's next post on an answer going back out (BR-14)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 1 } }) });
    const id = await host.conversation("alice", "desk");
    // The EM answers; the coder, handed the EM's answer in round 1, never does.
    await post(host, id, "who owns it? [route:eng.em] [route:eng.coder] [fail:eng.coder]");
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder"]);

    // The person's next post is theirs to place: an evaluator call, not held for the coder.
    await post(host, id, "and the budget? [route:support.general] [fail:support.general]");
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder", "support.general"]);
    expect((await host.items(id)).records.map((record: any) => [record.round, record.by])).toEqual([
      [0, "evaluated"],
      [1, "evaluated"],
      [0, "evaluated"]
    ]);
  });

  it("under round robin, routes an answer to the delegate after its author, and the person's turn doesn't move (BR-24, BR-17)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { routing: "round-robin", rounds: 1 } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "one");
    await quiet(host);
    await post(host, id, "two");
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder", "eng.coder", "support.general"]);
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.round, record.by, record.delegates[0].worker])).toEqual([
      [0, "round-robin", "eng.em"],
      [1, "round-robin", "eng.coder"],
      [0, "round-robin", "eng.coder"],
      [1, "round-robin", "support.general"]
    ]);
  });

  it("under judgment, wakes the coordinator's turn once per closed round; its hand-offs are the next round's, once per delegate (BR-24, BR-24a, BR-25)", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "h1", toolName: "handOff", args: { worker: "eng.em" } },
            { toolCallId: "h2", toolName: "handOff", args: { worker: "eng.coder" } }
          ]
        },
        { text: "Asked both." },
        {
          toolCalls: [
            { toolCallId: "h3", toolName: "handOff", args: { worker: "eng.em" } },
            { toolCallId: "h4", toolName: "handOff", args: { worker: "eng.em" } }
          ]
        },
        { text: "Passed the answers to the EM." }
      ]
    });
    const host = bootHost({
      judgment,
      standard: standardWorkers({ chief: { rounds: 1, delegates: ["eng.em", "eng.coder"] } })
    });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "plan the release");
    await quiet(host);

    // Two turns: the post's, and one wake when round 0 closed. Round 1 is the last: no third.
    expect(judgment.calls).toHaveLength(2);
    const woken = JSON.stringify(judgment.calls[1]!.input);
    expect(woken).toContain("Your delegates answered (round 0)");
    expect(woken).toContain("eng.em heard: alice, through chief: plan the release");
    expect(woken).toContain("eng.coder heard: alice, through chief: plan the release");
    expect(host.heard).toHaveLength(3);
    expect(host.heard[2]).toMatchObject({ worker: "eng.em" });
    expect(host.heard[2]!.message).toMatch(/^eng\.(em|coder), eng\.(em|coder), through chief: /);
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.round, record.by, record.delegates])).toEqual([
      [
        0,
        "judgment",
        expect.arrayContaining([
          { worker: "eng.em", outcome: "delivered" },
          { worker: "eng.coder", outcome: "delivered" }
        ])
      ],
      [
        1,
        "judgment",
        expect.arrayContaining([
          { worker: "eng.em", outcome: "delivered" },
          { worker: "eng.em", outcome: "skipped", reason: "it was already handed this post in this round" }
        ])
      ]
    ]);
    expect(await answers(host, id)).toHaveLength(3);
  });

  it("closes a round without a delegate whose turn failed, at once, and sends the other's answer on (BR-24b)", async () => {
    // A deadline far off: only the failure can close the round in time.
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "status? [fail:eng.coder]");
    await quiet(host);

    expect(host.heard.map((h) => [h.worker, h.message.split(":")[0]])).toEqual(
      expect.arrayContaining([
        ["eng.em", "alice, through desk"],
        ["eng.coder", "alice, through desk"],
        ["eng.coder", "eng.em, through desk"]
      ])
    );
    expect(host.heard).toHaveLength(3);
    const { records } = await host.items(id);
    expect(records[1]).toMatchObject({ round: 1, by: "everyone" });
    expect(records[1].delegates).toEqual([
      { worker: "eng.coder", outcome: "delivered" },
      { worker: "eng.em", outcome: "skipped", reason: "no other delegate answered in round 0" }
    ]);
    const failed = (await host.sessionState(id)).deliveries.find(
      (d: any) => d.round === 0 && d.delegate.worker === "eng.coder"
    );
    expect(failed).toMatchObject({
      answered: false,
      missed: expect.stringMatching(/^its turn failed: .*eng\.coder could not answer/)
    });
  });

  it("closes a round at its deadline without a slow delegate; its late answer lands once and goes no further (BR-24b)", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 500 });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "status? [slow:eng.coder]");
    await quiet(host);

    // The EM heard the post and nothing else: the coder's late answer never went back out to it.
    expect(host.heard.filter((h) => h.worker === "eng.em")).toHaveLength(1);
    // The coder got the EM's answer in round 1.
    expect(host.heard.filter((h) => h.worker === "eng.coder").map((h) => h.message.split(":")[0])).toEqual([
      "alice, through desk",
      "eng.em, through desk"
    ]);
    const { records, all } = await host.items(id);
    expect(records[1].delegates).toEqual([
      { worker: "eng.coder", outcome: "delivered" },
      { worker: "eng.em", outcome: "skipped", reason: "no other delegate answered in round 0" }
    ]);
    // Round 0 closed at its deadline, before the coder's late answer came in.
    const roundOne = all.findIndex((item: any) => item.type === "component" && item.data?.round === 1);
    const coderLine = all.findIndex((item: any) => item.type === "message" && item.agentName === "eng.coder");
    expect(roundOne).toBeGreaterThanOrEqual(0);
    expect(roundOne).toBeLessThan(coderLine);
    // The EM's answer, the coder's late one, then the coder's to round 1: each once.
    expect((await answers(host, id)).map((line) => line.agentName)).toEqual(["eng.em", "eng.coder", "eng.coder"]);
    const late = (await host.sessionState(id)).deliveries.find(
      (d: any) => d.round === 0 && d.delegate.worker === "eng.coder"
    );
    expect(late).toMatchObject({ answered: true, missed: "it hadn't answered by the round's deadline" });
  });

  it("goes back out once for an answer sent twice, and refuses a report on a token no delivery carries (BR-21, BR-22)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 1 } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "who owns it? [route:eng.em] [route:eng.coder]");
    await quiet(host);
    const first = (await host.sessionState(id)).deliveries.find((d: any) => d.round === 0);

    const again = await host.act("alice", id, "delegateAnswer", { token: first.token, body: "again" }, "coordinator", "internal");
    expect(again.output).toEqual({ landed: false });
    const missed = await host.act("alice", id, "delegateMissed", { token: first.token }, "coordinator", "internal");
    expect(missed.output).toEqual({ missed: false });
    const forged = await host.act("alice", id, "delegateMissed", { token: "made-up" }, "coordinator", "internal");
    expect(messageOf(forged.error)).toMatch(/No delivery in this conversation carries that token/);
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder"]);
    expect((await host.items(id)).records).toHaveLength(2);
  });

  it("never takes a round from a post or a hand-off, and no caller reaches the route-on entry (BR-27)", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.em", round: 1 } }] },
        { text: "Tried." }
      ]
    });
    const host = bootHost({ judgment, standard: standardWorkers({ chief: { rounds: 1 } }) });
    const id = await host.conversation("alice", "chief");
    const forgedPost = await host.act("alice", id, "run", { message: "go", round: 2 });
    expect(messageOf(forgedPost.error)).toMatch(/round/);
    const forgedHandOff = await host.act("alice", id, "run", { message: "go" });
    expect(messageOf(forgedHandOff.error)).toMatch(/Unrecognized key\(s\) in object: 'round'/);
    await quiet(host);
    // Neither reached a delegate.
    expect(host.heard).toEqual([]);
    await expect(
      host.act("alice", id, "routeOn", { postId: "p", round: 1, answers: [{ worker: "eng.em", body: "x" }] })
    ).rejects.toThrow(/does not define action "routeOn"/);
  });
});

describe("a delegate that never answers (V5, BR-24b)", () => {
  /** Wait until every open round of the conversation is past its deadline. */
  const untilOverdue = async (host: Host, id: string) => {
    const open = (await host.sessionState(id)).openRounds as Array<{ deadlineAt?: number }>;
    const last = Math.max(...open.map((round) => round.deadlineAt ?? 0));
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, last - Date.now()) + 20));
  };

  /** The records of one post, by round. */
  const recordsOf = async (host: Host, id: string, postId: string) =>
    (await host.items(id)).records.filter((record: any) => record.postId === postId);

  /** The coder heard the EM's answer to `post`, passed on in round 1. */
  const passedToCoder = (host: Host, post: string) =>
    host.heard.filter(
      (h) => h.worker === "eng.coder" && h.message.startsWith(`eng.em, through desk: eng.em heard: alice, through desk: ${post}`)
    );

  it("reports a cancelled run, so its round closes at once and the other answer goes on", async () => {
    // A deadline far off: only the report can close the round in time.
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "run", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);

    const cancelled = (await host.sessionState(id)).deliveries.find(
      (d: any) => d.round === 0 && d.delegate.worker === "eng.coder"
    );
    expect(cancelled).toMatchObject({ answered: false, missed: "its turn failed: its run was cancelled" });
    expect(passedToCoder(host, "status?")).toHaveLength(1);
    expect((await host.sessionState(id)).openRounds).toEqual([]);
  });

  for (const wake of ["delegateAnswer", "delegateMissed"] as const) {
    it(`closes an overdue round when a ${wake === "delegateAnswer" ? "repeated answer" : "missed report"} wakes the conversation`, async () => {
      const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000, reportCancel: false });
      const id = await host.conversation("alice", "desk");
      expect((await host.act("alice", id, "run", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
      expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
      await quiet(host);
      expect(passedToCoder(host, "status?")).toHaveLength(0);
      const answered = (await host.sessionState(id)).deliveries.find((d: any) => d.delegate.worker === "eng.em");

      await untilOverdue(host, id);
      // The EM's delivery already has its answer, so this writes nothing of its own; it only wakes.
      const input = wake === "delegateAnswer" ? { token: answered.token, body: "again" } : { token: answered.token };
      expect((await host.act("alice", id, wake, input, "coordinator", "internal")).error).toBeUndefined();
      await quiet(host);
      expect(passedToCoder(host, "status?")).toHaveLength(1);
      expect((await host.sessionState(id)).openRounds).toEqual([]);
    });
  }

  it("closes an overdue round when the person's post is the only wake", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000, reportCancel: false });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "run", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);
    const [stale] = (await host.sessionState(id)).openRounds;
    // With no delegates left, the next post makes no delivery, so no answer wakes anything.
    for (const worker of ["eng.em", "eng.coder"]) await act(host, id, "removeDelegate", { worker });

    await untilOverdue(host, id);
    await post(host, id, "anyone?");
    await quiet(host);
    // The stale round closed once, and its one routing ran: nobody can take the EM's answer now.
    expect((await recordsOf(host, id, stale.postId)).map((record: any) => [record.round, record.by])).toEqual([
      [0, "everyone"],
      [1, "unplaced"]
    ]);
    expect((await host.sessionState(id)).openRounds).toEqual([]);
  });

  it("closes an overdue round on the conversation's next wake, once, and the new post routes as well", async () => {
    // The coder's run is cancelled and says nothing, as one whose process stopped would.
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000, reportCancel: false });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "run", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);
    const [first] = (await host.sessionState(id)).openRounds;
    expect(first).toMatchObject({ round: 0 });
    // Nothing reported, so round 0 waits: nothing has gone on.
    expect(passedToCoder(host, "status?")).toHaveLength(0);
    const silent = (await host.sessionState(id)).deliveries.find(
      (d: any) => d.round === 0 && d.delegate.worker === "eng.coder"
    );
    expect(silent).toMatchObject({ answered: false });
    expect(silent.missed).toBeUndefined();

    // Past the deadline, the person posts again.
    await untilOverdue(host, id);
    await post(host, id, "and the release?");
    await quiet(host);

    // The overdue round closed once, and its one delivery went on: the coder got the EM's answer.
    expect(passedToCoder(host, "status?")).toHaveLength(1);
    const stale = await recordsOf(host, id, first.postId);
    expect(stale.map((record: any) => [record.round, record.by])).toEqual([
      [0, "everyone"],
      [1, "everyone"]
    ]);
    expect(stale[1].delegates).toEqual([
      { worker: "eng.coder", outcome: "delivered" },
      { worker: "eng.em", outcome: "skipped", reason: "no other delegate answered in round 0" }
    ]);
    // The new post routed as usual: both delegates, then each the other's answer.
    const fresh = (await host.items(id)).records.filter((record: any) => record.postId !== first.postId);
    expect(fresh.map((record: any) => [record.round, record.by, record.delegates.length])).toEqual([
      [0, "everyone", 2],
      [1, "everyone", 2]
    ]);
    expect((await host.sessionState(id)).openRounds).toEqual([]);
  });

  it(`refuses a round past ${MAX_OPEN_ROUNDS} open ones, keeping the open ones as they were`, () => {
    let rounds: OpenRound[] = [];
    for (let n = 0; n < MAX_OPEN_ROUNDS; n += 1) rounds = beginRound(rounds, `p${n}`, 0).rounds;
    expect(rounds).toHaveLength(MAX_OPEN_ROUNDS);
    expect(beginRound(rounds, "p-new", 0)).toEqual({ rounds, opened: false });
    // A round already open is still held open by a second routing.
    expect(beginRound(rounds, "p0", 0)).toMatchObject({ opened: true, rounds: expect.arrayContaining([expect.objectContaining({ postId: "p0", opening: 2 })]) });
  });

  it(`refuses a post's round at ${MAX_OPEN_ROUNDS} open, says so in its record, and the open rounds still go on`, async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    // A live round: the coder is still working on it.
    expect((await host.act("alice", id, "run", { message: "status? [slow:eng.coder]" })).error).toBeUndefined();
    const live = (await host.sessionState(id)).openRounds[0];
    expect(live).toMatchObject({ round: 0 });
    // Fill the rest of the conversation with rounds still within their deadline.
    const runtime = await host.state.getRuntime();
    for (let written = false; !written; ) {
      const session = (await runtime.stores.session.get(id))!;
      const open = session.state.openRounds as unknown[];
      const others = Array.from({ length: MAX_OPEN_ROUNDS - open.length }, (_, n) => ({
        postId: `earlier-${n}`,
        round: 0,
        opening: 0,
        deadlineAt: Date.now() + 60_000,
        answers: []
      }));
      const state = { ...session.state, openRounds: [...open, ...others] };
      written = (await runtime.stores.session.set(id, { ...session, state } as never, session.version as never)).ok;
    }

    // The new post is delivered as usual, but nothing waits for its answers.
    expect((await host.act("alice", id, "run", { message: "ship it?" })).error).toBeUndefined();
    await quiet(host);
    const records = (await host.items(id)).records;
    const refused = records.filter((record: any) => record.postId !== live.postId);
    expect(refused).toEqual([
      expect.objectContaining({
        round: 0,
        by: "everyone",
        note: `this conversation already has ${MAX_OPEN_ROUNDS} rounds waiting for answers, so answers in round 0 go no further`
      })
    ]);
    // The live round was kept, and went on once the coder answered.
    expect(records.filter((record: any) => record.postId === live.postId).map((record: any) => record.round)).toEqual([0, 1]);
    expect(passedToCoder(host, "status?")).toHaveLength(1);
    expect((await host.sessionState(id)).openRounds).toHaveLength(MAX_OPEN_ROUNDS - 1);
  });
});

describe("a conversation's writes under contention (V5)", () => {
  it("passes a closed round's answers on when its first delivery loses its write to four others in a row", async () => {
    // Each delegate's answer, each routing and each pass-on writes this one conversation's
    // state. Here the write that opens the EM's pass-on delivery loses to another writer
    // four times in a row.
    const adapter = inMemoryStores();
    const registry = await adapter.resolve();
    const set = registry.session.set.bind(registry.session);
    const opensPassOnToEm = (state: unknown) =>
      ((state as { deliveries?: Array<{ round: number; delegate: { worker: string } }> } | undefined)?.deliveries ?? []).some(
        (d) => d.round === 1 && d.delegate.worker === "eng.em"
      );
    let lost = 0;
    registry.session.set = async (id, value, expected) => {
      const stored = await registry.session.get(id);
      if (stored !== undefined && lost < 4 && opensPassOnToEm(value.state) && !opensPassOnToEm(stored.state)) {
        lost += 1;
        return { ok: false, conflict: { currentValue: stored, currentVersion: stored.version } };
      }
      return set(id, value, expected);
    };
    const host = bootHost({ standard: pairDesk("everyone", 1), stores: adapter as never });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "status?");
    await quiet(host);

    expect(lost).toBe(4);
    const passed = (to: string, from: string) =>
      host.heard.filter((h) => h.worker === to && h.message.startsWith(`${from}, through desk: ${from} heard: alice, through desk: status?`));
    expect(passed("eng.coder", "eng.em")).toHaveLength(1);
    expect(passed("eng.em", "eng.coder")).toHaveLength(1);
    const runtime = await host.state.getRuntime();
    expect((await runtime.stores.request.list({ sessionId: id })).filter((r) => r.status === "failed")).toEqual([]);
  });
});
