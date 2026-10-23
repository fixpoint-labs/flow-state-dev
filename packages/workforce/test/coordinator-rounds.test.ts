/**
 * The coordinator's two fixed policies beyond best fit, and rounds: how far a
 * delegate's answer goes back out.
 *
 * What is graded is who heard what (the `helper` flow records every delivery
 * it hears), what landed in the conversation, the `coordinator-route`
 * records, and the routed tasks on the conversation's board, never a
 * router's internal decision.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1791/BUSINESS-RULES.md`, V3 and V5):
 *   BR-17  round robin: the next delegate in list order takes each user's post, skipping one
 *          that can't be reached; the turn survives an edit to the list;
 *   BR-18  everyone: each delegate that can be reached gets the post once;
 *   BR-19  a conversation with no delegate that can be reached: nobody runs, recorded and said;
 *   BR-23  at `rounds: 0` an answer goes back out to nobody;
 *   BR-24  below the limit: best fit and round robin route each answer again, never to its author;
 *          everyone hands each delegate the others' answers when the round closes; judgment wakes
 *          the coordinator's turn once per closed round;
 *   BR-24a a judgment dispatch in a wake is the next round's, once per delegate;
 *   BR-24b a round closes without a delegate whose turn failed or whose task the user cancelled, at
 *          once, and without a slow one at its deadline; the late answer lands once and goes no
 *          further; a round whose delegate says nothing closes at its deadline, on the wake its
 *          conversation owes then (FIX-2083 D2), once; past 50 open rounds the oldest is no longer
 *          tracked;
 *   BR-25  at the limit an answer goes nowhere and wakes nothing;
 *   BR-21, BR-22  an ending sent twice goes back out once;
 *   BR-27  a message and a filing can't carry a round; no caller reaches the route-on entry;
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
import type { RoundPost, RoundRows } from "../src/coordinator/coordinator-rounds";
import type { OpenRound } from "../src/coordinator/coordinator-state";
import { ORG, bootHost, messageOf, quiet, standardWorkers } from "./coordinator-harness";

type Host = ReturnType<typeof bootHost>;

const heardBy = (host: Host) => host.heard.map((h) => h.worker);

async function post(host: Host, sessionId: string, message: string, userId = "alice") {
  const result = await host.act(userId, sessionId, "respond", { message });
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
  it("hands each user's post to the next delegate in list order, with no model call (BR-17, BR-28)", async () => {
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
      host.act("alice", id, "respond", { message: "one" }),
      host.act("alice", id, "respond", { message: "two" })
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
    expect(messages.at(-1)!.text).toBe("Nobody took this message: no delegate in this conversation can be reached.");
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
    expect(messages.at(-1)!.text).toMatch(/^Nobody took this message: /);
  });
});

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
  const posted: RoundPost = { postId: "p1", round: 0, delegate };
  /** The round's one post row, `t1`, as the board reads it, with the round's routing counts read just before. */
  const rowsOf =
    (row: { running?: boolean; replied?: boolean }, at: { begun: number; opening: number } = { begun: 1, opening: 0 }): RoundRows =>
    () => ({ ids: ["t1"], running: row.running ?? false, replied: row.replied === true ? [delegate] : [], ...at });

  it("waits while a routing still adds to it, and shares one deadline across its deliveries (BR-24b)", () => {
    let rounds = beginRound([], "p1", 0).rounds;
    const first = roundDeadline(rounds, "p1", 0, 1_000, 500);
    expect(first.deadlineAt).toBe(1_500);
    rounds = first.rounds;
    expect(roundDeadline(rounds, "p1", 0, 1_200, 500).deadlineAt).toBe(1_500);
    // A round nobody opened carries no deadline: nothing waits for it.
    expect(roundDeadline(rounds, "p1", 1, 1_200, 500).deadlineAt).toBeUndefined();

    // Every row ended, but the routing hasn't finished adding: still open.
    const ended = rowsOf({});
    expect(closeRound(rounds, ended, "p1", 0, 1_200).closed).toBeUndefined();
    // The routing's own end closes it: it was still filing when it read its rows.
    expect(closeRound(endRound(rounds, "p1", 0), rowsOf({}, { begun: 1, opening: 1 }), "p1", 0, 1_200, true).closed).toMatchObject({
      deliveries: 1
    });
    // A row still running holds it open until the deadline, then not.
    const done = endRound(rounds, "p1", 0);
    expect(closeRound(done, rowsOf({ running: true }), "p1", 0, 1_499).closed).toBeUndefined();
    expect(closeRound(done, rowsOf({ running: true }), "p1", 0, 1_500).closed).toMatchObject({ round: 0, answers: [] });
  });

  it("holds a round open on a reply whose row ended before the reply landed here", () => {
    // The row's reply is on the board, and the round hasn't kept it yet: closing now
    // would send the round on without it.
    const rounds = endRound(roundDeadline(beginRound([], "p1", 0).rounds, "p1", 0, 1_000, 500).rounds, "p1", 0);
    const replied = rowsOf({ replied: true });
    expect(closeRound(rounds, replied, "p1", 0, 1_200).closed).toBeUndefined();
    // Once it lands, the round closes with it.
    expect(landAnswer(rounds, replied, posted, "on time", 1_200)).toMatchObject({
      kept: true,
      closed: { answers: [{ worker: "eng.em", body: "on time" }] }
    });
  });

  it("doesn't close on a read of its rows that a routing has gone stale since", () => {
    const rounds = endRound(beginRound([], "p1", 0).rounds, "p1", 0);
    // A routing was still filing when the rows were read: it may have filed one the read missed.
    expect(closeRound(rounds, rowsOf({}, { begun: 1, opening: 1 }), "p1", 0, 1_200).closed).toBeUndefined();
    // A routing began after the read, and has finished since: the same.
    const again = endRound(beginRound(rounds, "p1", 0).rounds, "p1", 0);
    expect(closeRound(again, rowsOf({}, { begun: 1, opening: 0 }), "p1", 0, 1_200).closed).toBeUndefined();
    expect(closeRound(again, rowsOf({}, { begun: 2, opening: 0 }), "p1", 0, 1_200).closed).toMatchObject({ round: 0 });
  });

  it("closes without an answer that comes after the deadline, which then goes nowhere (BR-24b)", () => {
    const rounds = endRound(roundDeadline(beginRound([], "p1", 0).rounds, "p1", 0, 1_000, 500).rounds, "p1", 0);
    const rows = rowsOf({ replied: true });
    const late = landAnswer(rounds, rows, posted, "late", 1_600);
    expect(late).toMatchObject({ kept: false, rounds: [], closed: { answers: [] } });
    expect(routeOnAfterAnswer(posted, "late", late.kept, "best-fit", 1)).toBeUndefined();

    const onTime = landAnswer(rounds, rows, posted, "on time", 1_200);
    expect(onTime).toMatchObject({ kept: true, closed: { answers: [{ worker: "eng.em", body: "on time" }] } });
    expect(routeOnAfterAnswer(posted, "on time", onTime.kept, "best-fit", 1)).toEqual({
      postId: "p1",
      round: 1,
      answers: [{ worker: "eng.em", body: "on time" }],
      exclude: { worker: "eng.em" }
    });
    // At the limit, nowhere.
    expect(routeOnAfterAnswer(posted, "on time", true, "best-fit", 0)).toBeUndefined();
    expect(routeOnAfterClose(onTime.closed!, "everyone", 0)).toBeUndefined();
    expect(routeOnAfterClose(onTime.closed!, "everyone", 1)).toMatchObject({ round: 1 });
  });

  it("keeps an answer heard again once, and sends it on once", () => {
    // Two rows out, so the first answer doesn't close the round.
    const open = endRound(beginRound([], "p1", 0).rounds, "p1", 0);
    const two: RoundRows = () => ({ ids: ["t1", "t2"], running: true, replied: [delegate], begun: 1, opening: 0 });
    const first = landAnswer(open, two, posted, "on time", 1_200);
    expect(first).toMatchObject({ kept: true });
    const again = landAnswer(first.rounds, two, posted, "on time", 1_300);
    expect(again).toMatchObject({ kept: false, again: true });
    expect(again.rounds[0]!.answers).toEqual([{ worker: "eng.em", body: "on time" }]);
    expect(routeOnAfterAnswer(posted, "on time", again.kept, "best-fit", 1)).toBeUndefined();
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
    const offered = (call: number) => Object.keys((host.route.calls[call]!.questions as any).worker.criteria);
    // The coordinator is a choice on the user's post only (FIX-1833 BR-3).
    expect(offered(0)).toEqual(["eng.em", "eng.coder", "support.general", "desk"]);
    expect(offered(1)).toEqual(["eng.coder", "support.general"]);
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.round, record.by, record.delegates])).toEqual([
      [0, "evaluated", [{ worker: "eng.em", outcome: "delivered" }]],
      [1, "evaluated", [{ worker: "eng.coder", outcome: "delivered" }]]
    ]);
    expect(await answers(host, id)).toHaveLength(2);
  });

  it("under best fit, holds nobody for the user's next post on an answer going back out (BR-14)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 1 } }) });
    const id = await host.conversation("alice", "desk");
    // The EM answers; the coder, handed the EM's answer in round 1, never does.
    await post(host, id, "who owns it? [route:eng.em] [route:eng.coder] [fail:eng.coder]");
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder"]);

    // The user's next post is theirs to place: an evaluator call, not held for the coder.
    await post(host, id, "and the budget? [route:support.general] [fail:support.general]");
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder", "support.general"]);
    expect((await host.items(id)).records.map((record: any) => [record.round, record.by])).toEqual([
      [0, "evaluated"],
      [1, "evaluated"],
      [0, "evaluated"]
    ]);
  });

  it("under round robin, routes an answer to the delegate after its author, and the user's turn doesn't move (BR-24, BR-17)", async () => {
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

  it("under judgment, wakes the coordinator's turn once per closed round; its dispatches are the next round's, once per delegate (BR-24, BR-24a, BR-25)", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "h1", toolName: "createTask", args: { goal: "Plan it", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } },
            { toolCallId: "h2", toolName: "createTask", args: { goal: "Plan it", assignee: "eng.coder", session: "ongoing", resultTo: "conversation" } }
          ]
        },
        { text: "Asked both." },
        {
          toolCalls: [
            { toolCallId: "h3", toolName: "createTask", args: { goal: "Merge them", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } },
            { toolCallId: "h4", toolName: "createTask", args: { goal: "Merge them", assignee: "eng.em", session: "ongoing", resultTo: "conversation" } }
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
          { worker: "eng.em", outcome: "skipped", reason: "it was already handed this message in this round" }
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
    const failed = (await host.routedRows("alice")).find((row) => row.sealed.round === 0 && row.assignee === "eng.coder");
    expect(failed).toMatchObject({ status: "errored", error: expect.stringMatching(/eng\.coder could not answer/) });
  });

  it("closes a round without a delegate whose answer was empty, at once, and sends the other's answer on (BR-24b)", async () => {
    // A deadline far off: only the empty answer, counted as none, can close the round in time.
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "status? [empty:eng.coder]");
    await quiet(host);

    // The coder heard the post, then the EM's answer in round 1; the EM heard nothing of the coder's.
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
    const late = (await host.routedRows("alice")).find((row) => row.sealed.round === 0 && row.assignee === "eng.coder");
    expect(late).toMatchObject({ status: "completed" });
  });

  it("files nothing for a pick a coordinator before the upgrade already handed the message, as a post row (BP-030)", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    // The coder answers late, so round 0 is still open when the post row is seeded.
    expect((await host.act("alice", id, "respond", { message: "status? [slow:eng.coder]" })).error).toBeUndefined();
    let em: any;
    for (let i = 0; i < 300 && em === undefined; i += 1) {
      em = (await host.routedRows("alice")).find((row) => row.assignee === "eng.em" && row.status === "completed");
      if (em === undefined) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(em).toBeDefined();
    // Round 1's message to the coder, the EM's answer, as the coordinator before FIX-2083 stored it, already answered.
    const runtime = await host.state.getRuntime();
    const scope = `alice:~org:${ORG}`;
    const entries = await runtime.stores.resourceState.getByPrefix("user", scope, "tasks/");
    const [key] = Object.entries(entries).find(([, value]) => (value.state as { id?: string }).id === em.id)!;
    const legacyId = `post:${[em.sealed.postId, "1", "eng.coder"].map(encodeURIComponent).join(":")}`;
    const now = Date.now();
    const legacy = {
      ...em,
      id: legacyId,
      assignee: "eng.coder",
      status: "completed",
      output: "an answer from before the upgrade",
      createdAt: now,
      updatedAt: now,
      incarnationId: "legacy-incarnation",
      // Its ending was heard before the upgrade: its notice is paid.
      metadata: { "noticeOwed:1:completed": null },
      sealed: { ...em.sealed, kind: "post", round: 1, delegate: { worker: "eng.coder" } }
    };
    for (const field of ["session", "resultTo", "run", "filer"]) delete legacy[field];
    // The row's key ends in its id, as the store writes it, encoded or not.
    const legacyKey = key.includes(encodeURIComponent(em.id))
      ? key.replace(encodeURIComponent(em.id), encodeURIComponent(legacyId))
      : key.replace(em.id, legacyId);
    expect(legacyKey).not.toBe(key);
    expect((await runtime.stores.resourceState.set("user", scope, legacyKey, legacy, "any")).ok).toBe(true);
    await quiet(host);

    // The coder heard the post only: round 1's pick of it was the post row, and nothing was filed again.
    expect(host.heard.filter((h) => h.worker === "eng.coder").map((h) => h.message.split(":")[0])).toEqual(["alice, through desk"]);
    const { records } = await host.items(id);
    const roundOne = records.find((record: any) => record.round === 1);
    expect(roundOne.delegates).toEqual(
      expect.arrayContaining([{ worker: "eng.coder", outcome: "skipped", reason: "it was already handed this message in this round" }])
    );
    expect((await host.routedRows("alice")).filter((row) => row.sealed.round === 1 && row.assignee === "eng.coder").map((row) => row.id)).toEqual([legacyId]);
  });

  it("closes a round open across the upgrade whose post row was still running: the row lapses, runs once more, and both answers go on (BP-030)", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 60_000 });
    const id = await host.conversation("alice", "desk");
    // A post that leaves one row on the board to read the board's key off; both answers empty, so nothing goes on.
    await post(host, id, "warm up [empty]");
    const runtime = await host.state.getRuntime();
    const scope = `alice:~org:${ORG}`;
    const entries = await runtime.stores.resourceState.getByPrefix("user", scope, "tasks/");
    const [key, entry] = Object.entries(entries).find(([, value]) => (value.state as { sealed?: unknown }).sealed !== undefined)!;
    const warm = entry.state as Record<string, any>;
    const keyFor = (taskId: string) =>
      key.includes(encodeURIComponent(warm.id)) ? key.replace(encodeURIComponent(warm.id), encodeURIComponent(taskId)) : key.replace(warm.id, taskId);
    const now = Date.now();
    const brief = (worker: string) => ({
      kind: "post",
      postId: "legacy",
      round: 0,
      delegate: { worker },
      session: { key: `delegate:["${worker}",null]` },
      body: "the old post",
      from: "alice",
      coordinator: "desk"
    });
    const base = { ...warm };
    for (const field of ["session", "resultTo", "run", "output", "startedAt", "completedAt", "leaseUntil", "claimedBy", "metadata", "filer", "waitingOn"]) {
      delete base[field];
    }
    // As a coordinator before FIX-2083 left them: the EM's post answered and heard, the coder's still running
    // on the entry the upgrade removed, its lease lapsing.
    const em = { ...base, id: "post:legacy:0:eng.em", goal: "alice, through desk: the old post", assignee: "eng.em", status: "completed",
      attempts: 1, maxAttempts: 1, output: "eng.em heard: the old post", completedAt: now - 5_000, createdAt: now - 10_000, updatedAt: now - 5_000,
      incarnationId: "legacy-em", metadata: { "noticeOwed:1:completed": null }, sealed: brief("eng.em") };
    const coder = { ...base, id: "post:legacy:0:eng.coder", goal: "alice, through desk: the old post", assignee: "eng.coder", status: "in_progress",
      attempts: 1, maxAttempts: 1, claimedBy: "conversation-tasks", leaseUntil: now - 1_000, startedAt: now - 10_000,
      run: { sessionId: "s-before-the-upgrade", requestId: "req-before-the-upgrade", attempt: 1, startedAt: now - 10_000 },
      createdAt: now - 10_000, updatedAt: now - 10_000, incarnationId: "legacy-coder", sealed: brief("eng.coder") };
    for (const row of [em, coder]) {
      expect((await runtime.stores.resourceState.set("user", scope, keyFor(row.id), row, "any")).ok).toBe(true);
    }
    // The round both were filed in, still open, with the EM's answer landed in it.
    const session = (await runtime.stores.session.get(id))!;
    await runtime.stores.session.set(
      id,
      {
        ...session,
        state: {
          ...session.state,
          openRounds: [{ postId: "legacy", round: 0, opening: 0, begun: 1, deadlineAt: now + 60_000, answers: [{ worker: "eng.em", body: "eng.em heard: the old post" }] }]
        },
        version: session.version + 1,
        updatedAt: now
      } as never,
      "any"
    );

    // The next touch of the board.
    await act(host, id, "listTasks_tasks", {});
    await quiet(host);

    // The coder's post ran again once its lease lapsed, as a routed task, and answered.
    const heard = host.heard.filter((h) => h.message.includes("the old post")).map((h) => [h.worker, h.message.split(":")[0]]);
    expect(heard[0]).toEqual(["eng.coder", "alice, through desk"]);
    // Then each answer went on to the other delegate. Those two turns run at
    // once, in two delegates' sessions, and nothing orders one before the
    // other, so which is heard first is not part of this; the round's record
    // below names them in the order they were filed.
    expect(heard.slice(1)).toHaveLength(2);
    expect(heard.slice(1)).toEqual(
      expect.arrayContaining([
        ["eng.em", "eng.coder, through desk"],
        ["eng.coder", "eng.em, through desk"]
      ])
    );
    const rows = await host.routedRows("alice");
    expect(rows.find((row) => row.id === coder.id)).toMatchObject({ status: "completed", output: "eng.coder heard: alice, through desk: the old post" });
    // The round closed on both answers, and each went on once to the other delegate.
    expect((await host.sessionState(id)).openRounds).toEqual([]);
    const roundOne = (await host.items(id)).records.find((record: any) => record.postId === "legacy" && record.round === 1);
    expect(roundOne.delegates).toEqual([
      { worker: "eng.em", outcome: "delivered" },
      { worker: "eng.coder", outcome: "delivered" }
    ]);
    expect(rows.filter((row) => row.sealed.postId === "legacy" && row.sealed.round === 1).map((row) => row.status)).toEqual(["completed", "completed"]);
  });

  it("goes back out once for an ending sent twice (BR-21, BR-22)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 1 } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "who owns it? [route:eng.em] [route:eng.coder]");
    await quiet(host);
    const first = (await host.routedRows("alice")).find((row) => row.sealed.round === 0)!;

    const notice = { boardId: "tasks", taskId: first.id, attempt: first.attempts, ending: "completed", output: "again" };
    expect((await host.act("alice", id, "onTaskSettled", notice, "coordinator", "internal")).error).toBeUndefined();
    expect((await host.routedRows("alice")).find((row) => row.id === first.id)).toMatchObject({ status: "completed" });
    // A post's cancel report has no entry left to forge (FIX-2083).
    await expect(host.act("alice", id, "postCancelled", { taskId: first.id }, "coordinator", "internal")).rejects.toThrow(
      /does not define action "postCancelled"/
    );
    await quiet(host);
    expect(host.heard.map((h) => h.worker)).toEqual(["eng.em", "eng.coder"]);
    expect((await host.items(id)).records).toHaveLength(2);
  });

  it("never takes a round from a message or a filing, and no caller reaches the route-on entry (BR-27)", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            {
              toolCallId: "h1",
              toolName: "createTask",
              args: { goal: "go", assignee: "eng.em", session: "ongoing", resultTo: "conversation", round: 1 }
            }
          ]
        },
        { text: "Tried." }
      ]
    });
    const host = bootHost({ judgment, standard: standardWorkers({ chief: { rounds: 1 } }) });
    const id = await host.conversation("alice", "chief");
    const forgedPost = await host.act("alice", id, "respond", { message: "go", round: 2 });
    expect(messageOf(forgedPost.error)).toMatch(/round/);
    // The filing's extra field reaches nothing: the task is the turn's own round's, round 0.
    const forgedFiling = await host.act("alice", id, "respond", { message: "go" });
    expect(forgedFiling.error).toBeUndefined();
    await quiet(host);
    expect((await host.routedRows("alice")).map((row) => row.sealed.round)).toEqual([0]);
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

  /**
   * The EM's answer to the message went on to the coder in round 1: a routed
   * task for it, filed. While the coder's round-0 task is still stuck in its
   * session (its run stopped and said nothing), this one waits behind it, as
   * a session works one task at a time (FIX-2080, rule 5).
   */
  const routedOnToCoder = async (host: Host) =>
    (await host.routedRows("alice")).filter((row) => row.sealed.round === 1 && row.assignee === "eng.coder" && row.sealed.from === "eng.em");

  /** The coder heard the EM's answer to `post`, passed on in round 1. */
  const passedToCoder = (host: Host, post: string) =>
    host.heard.filter(
      (h) => h.worker === "eng.coder" && h.message.startsWith(`eng.em, through desk: eng.em heard: alice, through desk: ${post}`)
    );

  it("closes a round at once when the user cancels a routed task from the board, while its delegate still works", async () => {
    // A deadline far off: only the cancel can close the round in time. eng.lead takes
    // tasks, so this conversation's board answers the task tools.
    const host = bootHost({
      standard: standardWorkers({ desk: { rounds: 1, delegates: ["eng.em", "eng.coder", "support.general", "eng.lead"] } }),
      roundDeadlineMs: 60_000
    });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "status? [slow:eng.coder] [route:eng.coder]" })).error).toBeUndefined();
    // The coder is working on it.
    for (let i = 0; i < 200 && !host.heard.some((h) => h.worker === "eng.coder"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const row = (await host.routedRows("alice")).find((r) => r.sealed.round === 0 && r.assignee === "eng.coder")!;
    const cancelled = await host.act("alice", id, "updateTask_tasks", { id: row.id, status: "cancelled" });
    expect(cancelled.error, messageOf(cancelled.error)).toBeUndefined();
    // Closed before the coder's turn ends.
    const openNow = async () => (await host.sessionState(id)).openRounds.filter((open: OpenRound) => open.round === 0);
    let open = await openNow();
    for (let i = 0; i < 50 && open.length > 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      open = await openNow();
    }
    expect(open).toEqual([]);
    await quiet(host);
    expect((await host.routedRows("alice")).find((r) => r.id === row.id)).toMatchObject({ status: "cancelled" });
    expect(await answers(host, id)).toEqual([]);
  });

  for (const wake of ["roundDeadline"] as const) {
    it("closes an overdue round when the deadline wake wakes the conversation", async () => {
      const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000 });
      const id = await host.conversation("alice", "desk");
      expect((await host.act("alice", id, "respond", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
      expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
      await quiet(host);
      expect(passedToCoder(host, "status?")).toHaveLength(0);
      const answered = (await host.routedRows("alice")).find((row) => row.assignee === "eng.em")!;

      await untilOverdue(host, id);
      // The EM's row has already ended, so this writes nothing of its own; it only wakes.
      const input =
        wake === "roundDeadline"
          ? {}
          : { boardId: "tasks", taskId: answered.id, attempt: answered.attempts, ending: "completed", output: "again" };
      expect((await host.act("alice", id, wake, input, "coordinator", "internal")).error).toBeUndefined();
      await quiet(host);
      expect(await routedOnToCoder(host)).toEqual([expect.objectContaining({ status: "pending" })]);
      expect((await host.sessionState(id)).openRounds).toEqual([]);
    });
  }

  it("owes a wake on the conversation at the round's deadline, which closes the round with nothing else to wake it (FIX-2083 D2)", async () => {
    // A host that keeps wakes: the deadline is a due time the engine keeps, not a timer in a delegate's run.
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000, durable: true });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);
    const [open] = (await host.sessionState(id)).openRounds as OpenRound[];
    const wakes = (await host.state.getRuntime()).stores.wakes!;
    expect(await wakes.get({ sessionId: id, entry: "roundDeadline" })).toMatchObject({ dueAt: open!.deadlineAt });

    // Nothing else wakes the conversation: the wake closes the round, within a second or so of its deadline.
    for (let i = 0; i < 400 && (await host.sessionState(id)).openRounds.some((r: OpenRound) => r.postId === open!.postId); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const closedBy = Date.now();
    expect((await host.sessionState(id)).openRounds).toEqual([]);
    expect(closedBy - open!.deadlineAt!).toBeLessThan(2_000);
    await quiet(host);
    expect(await routedOnToCoder(host)).toEqual([expect.objectContaining({ status: "pending" })]);
    // Settled once every round is closed: cleared, or, before the fence its writer's lease
    // set, moved to that fence (FIX-2078), never left due at the deadline it paid.
    const left = await wakes.get({ sessionId: id, entry: "roundDeadline" });
    if (left !== null) expect(left.dueAt).toBe(left.landBy);
    expect(left?.dueAt ?? Number.POSITIVE_INFINITY).toBeGreaterThan(open!.deadlineAt!);
  });

  it("closes the round at its deadline on an in-process timer, on a host that keeps no wakes (FIX-2083 D2)", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000 });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);
    const [open] = (await host.sessionState(id)).openRounds as OpenRound[];
    for (let i = 0; i < 400 && (await host.sessionState(id)).openRounds.length > 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await host.sessionState(id)).openRounds).toEqual([]);
    expect(Date.now() - open!.deadlineAt!).toBeLessThan(2_000);
  });

  it("closes an overdue round when the user's post is the only wake", async () => {
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000 });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
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
    const host = bootHost({ standard: pairDesk("everyone", 1), roundDeadlineMs: 2_000 });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "respond", { message: "status? [hang:eng.coder]" })).error).toBeUndefined();
    expect(await host.cancelDelegate("alice", "eng.coder")).toBe(204);
    await quiet(host);
    const [first] = (await host.sessionState(id)).openRounds;
    expect(first).toMatchObject({ round: 0 });
    // Nothing reported, so round 0 waits: nothing has gone on.
    expect(passedToCoder(host, "status?")).toHaveLength(0);
    const silent = (await host.routedRows("alice")).find((row) => row.sealed.round === 0 && row.assignee === "eng.coder");
    expect(silent).toMatchObject({ status: "in_progress" });

    // Past the deadline, the user posts again.
    await untilOverdue(host, id);
    await post(host, id, "and the release?");
    await quiet(host);

    // The overdue round closed once, and its one delivery went on: the coder got the EM's answer.
    expect(await routedOnToCoder(host)).toEqual([expect.objectContaining({ status: "pending" })]);
    const stale = await recordsOf(host, id, first.postId);
    expect(stale.map((record: any) => [record.round, record.by])).toEqual([
      [0, "everyone"],
      [1, "everyone"]
    ]);
    expect(stale[1].delegates).toEqual([
      { worker: "eng.coder", outcome: "delivered" },
      { worker: "eng.em", outcome: "skipped", reason: "no other delegate answered in round 0" }
    ]);
    // The new post routed as usual, to both delegates. The coder's session still holds its
    // stuck task, so the new one for it waits behind it (FIX-2080, rule 5), and the new
    // round waits for its answer, or its own deadline.
    const fresh = (await host.items(id)).records.filter((record: any) => record.postId !== first.postId);
    expect(fresh.map((record: any) => [record.round, record.by, record.delegates.length])).toEqual([[0, "everyone", 2]]);
    const freshCoder = (await host.routedRows("alice")).filter(
      (row) => row.sealed.postId !== first.postId && row.sealed.round === 0 && row.assignee === "eng.coder"
    );
    expect(freshCoder).toEqual([expect.objectContaining({ status: "pending" })]);
    expect((await host.sessionState(id)).openRounds.map((open: OpenRound) => open.postId)).not.toContain(first.postId);
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
    expect((await host.act("alice", id, "respond", { message: "status? [slow:eng.coder]" })).error).toBeUndefined();
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
        answers: [],
        begun: 1
      }));
      const state = { ...session.state, openRounds: [...open, ...others] };
      written = (await runtime.stores.session.set(id, { ...session, state } as never, session.version as never)).ok;
    }

    // The new post is delivered as usual, but nothing waits for its answers.
    expect((await host.act("alice", id, "respond", { message: "ship it?" })).error).toBeUndefined();
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
  it("passes a closed round's answers on when the write that closes it loses to four others in a row", async () => {
    // Each delegate's answer, each routing and each pass-on writes this one conversation's
    // state. Here the write that lands round 0's second answer, and so closes it, loses to
    // another writer four times in a row.
    const adapter = inMemoryStores();
    const registry = await adapter.resolve();
    const set = registry.session.set.bind(registry.session);
    const landed = (state: unknown) => ((state as { landedAnswers?: unknown[] } | undefined)?.landedAnswers ?? []).length;
    const opensPassOnToEm = (state: unknown) => landed(state) >= 2;
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
