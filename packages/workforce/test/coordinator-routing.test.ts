/**
 * How a coordinator routes a person's post, at `rounds: 0`: best fit's
 * ladder, the judgment turn, delivery into each delegate's own session, the
 * answer claimed once, and the record every decision leaves.
 *
 * What is graded is who heard the post (the `helper` flow records every
 * delivery), what landed in the conversation, and the `coordinator-route`
 * records, never a router's internal decision.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1791/BUSINESS-RULES.md`, V3, V4, V6, V7):
 *   BR-13  one evaluator call picks one delegate, by its note or else its description; one with neither isn't a choice;
 *   BR-14  the person's next post goes to the delegate still on the last one, with no call; a removed holder holds nothing;
 *   BR-15  a failed call, or a pick that isn't a delegate, goes to the fallback;
 *   BR-16  with no fallback, best fit's miss goes to the judgment turn, recorded `by: judgment`;
 *   BR-16a when that turn fails too, the post is unplaced, recorded and said in the conversation;
 *   BR-9   a fired delegate is skipped on the next post, with why; its entry stays;
 *   BR-12  judgment: the coordinator's turn hands off with its tool, or answers itself;
 *   BR-10  asked who its delegates are, the turn's delegate read equals the conversation's list;
 *   BR-20  an answer lands once, under the delegate's name, carrying its delivery's token;
 *   BR-20a each conversation gets its own session per delegate, linked at create; a later delivery reuses it;
 *          a conversation deleted and created again under the same id opens fresh delegate sessions;
 *   BR-21  an answer sent twice lands once; a second hand-off of one post to one delegate is skipped;
 *   BR-22  a token no delivery carries is refused, and nothing lands;
 *   BR-23  at `rounds: 0` an answer routes nowhere and wakes no judgment turn;
 *   BR-27  an answer can't name its own round, author or post;
 *   BR-28  every decision is one `coordinator-route` record; BR-31: a delegate fired between pick and
 *          delivery is not delivered, refused by its create check.
 *
 * And best fit's own choice and floor (`specs/issues/FIX-1833/BUSINESS-RULES.md`, V3 and V4):
 *   BR-1/2 the coordinator is a choice by its description, beside its delegates; with no description, or no
 *          delegate to pick, it isn't, and best fit misses as before;
 *   BR-4   a coordinator named in its own `delegates:` is a choice once, as itself;
 *   BR-5   one delegate and the coordinator still make a call;
 *   BR-7   a pick of the coordinator runs its own turn on the post, even with a fallback set; the hold clears;
 *   BR-8/9 under `minConfidence:`, a delegate pick below it, or with no confidence, goes to the fallback, else the turn;
 *   BR-10  with no floor, any delegate pick is used;
 *   BR-11  a pick of the coordinator is used below the floor;
 *   BR-12  a failed call, or an answer that isn't a choice, goes down the ladder, and the record says which;
 *   BR-13  a held post makes no call, whatever it asks;
 *   BR-14  a coordinator pick whose turn fails is unplaced, and said;
 *   BR-22  a `by: fallback` or `by: judgment` record from best fit says why, in `fit`;
 *   BR-23  the judgment policy's own record carries no `fit` (the judgment tests' exact records).
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { bootHost, messageOf, standardWorkers } from "./coordinator-harness";

const heardBy = (host: ReturnType<typeof bootHost>) => host.heard.map((h) => h.worker);

async function post(host: ReturnType<typeof bootHost>, sessionId: string, message: string, userId = "alice") {
  const result = await host.act(userId, sessionId, "run", { message });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  await host.settled();
  return result;
}

describe("best fit (V3)", () => {
  it("runs one evaluator call over the delegates with a note or description, and delivers to its pick alone (BR-13, BR-28)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "addDelegate", { worker: "silent" })).error).toBeUndefined();
    expect((await host.hire("alice", { id: "licenses", flow: "helper" })).error).toBeUndefined();
    expect((await host.act("alice", id, "addDelegate", { worker: "licenses", note: "Audits licenses." })).error).toBeUndefined();

    await post(host, id, "check the licenses [route:licenses]");
    expect(host.route.calls).toHaveLength(1);
    const options = (host.route.calls[0]!.questions as any).member.criteria;
    expect(options).toEqual({
      "eng.em": "Plans and staffs engineering work.",
      "eng.coder": "Writes code.",
      "support.general": "Anything that fits no one else.",
      licenses: "Audits licenses.",
      // The coordinator itself, by its own description (FIX-1833 BR-1).
      desk: "Ask the team anything."
    });
    expect(heardBy(host)).toEqual(["licenses"]);
    const { records } = await host.items(id);
    expect(records).toEqual([
      expect.objectContaining({ round: 0, policy: "best-fit", by: "evaluated", delegates: [{ worker: "licenses", outcome: "delivered" }] })
    ]);
  });

  it("holds the next post for the delegate still on the last one, with no call; a removed holder holds nothing (BR-14)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    // `[fail]` keeps eng.coder from answering, so it is still on the post.
    await post(host, id, "the build is red [route:eng.coder] [fail]");
    await post(host, id, "any news?");
    expect(host.route.calls).toHaveLength(1);
    expect(heardBy(host)).toEqual(["eng.coder", "eng.coder"]);

    expect((await host.act("alice", id, "removeDelegate", { worker: "eng.coder" })).error).toBeUndefined();
    await post(host, id, "who plans this? [route:eng.em]");
    expect(host.route.calls).toHaveLength(2);
    expect(heardBy(host)).toEqual(["eng.coder", "eng.coder", "eng.em"]);
    const bys = (await host.items(id)).records.map((record: any) => record.by);
    expect(bys).toEqual(["evaluated", "held", "evaluated"]);
  });

  it("releases the hold once the holder answers", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "the build is red [route:eng.coder]");
    await post(host, id, "and who plans the fix? [route:eng.em]");
    expect(host.route.calls).toHaveLength(2);
    expect(heardBy(host)).toEqual(["eng.coder", "eng.em"]);
  });

  it("sends a failed call, and a pick that isn't a delegate, to the fallback (BR-15)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "no mark here");
    await post(host, id, "pick nobody [route:none]");
    expect(heardBy(host)).toEqual(["support.general", "support.general"]);
    const records = (await host.items(id)).records;
    expect(records.map((r: any) => r.by)).toEqual(["fallback", "fallback"]);
  });

  it("with no fallback, hands best fit's miss to the judgment turn, recorded by judgment (BR-16)", async () => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.em" } }] }, { text: "Handed to the EM." }]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "setFallback", { worker: null })).error).toBeUndefined();
    await post(host, id, "no mark, so the call fails");
    expect(judgment.calls).toHaveLength(1);
    expect(heardBy(host)).toEqual(["eng.em"]);
    const records = (await host.items(id)).records;
    expect(records).toEqual([
      expect.objectContaining({ by: "judgment", policy: "best-fit", delegates: [{ worker: "eng.em", outcome: "delivered" }] })
    ]);
  });

  it("records the post unplaced, and says so, when the judgment turn fails too (BR-16a)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "setFallback", { worker: null })).error).toBeUndefined();
    await post(host, id, "no mark, and no judgment script");
    expect(host.heard).toEqual([]);
    const { records, messages } = await host.items(id);
    expect(records).toEqual([expect.objectContaining({ by: "unplaced", delegates: [] })]);
    expect(records[0].none).toMatch(/best fit couldn't place it, and the coordinator's own turn failed/);
    expect(messages.at(-1)!.text).toMatch(/^Nobody took this post: /);
  });

  it("skips a delegate fired since it was added, says why, and keeps its entry (BR-9)", async () => {
    const host = bootHost();
    expect((await host.hire("alice", { id: "temp", flow: "helper", description: "Temporary." })).error).toBeUndefined();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "addDelegate", { worker: "temp" })).error).toBeUndefined();
    expect((await host.fire("alice", "temp")).error).toBeUndefined();
    await post(host, id, "for temp [route:temp]");
    expect(heardBy(host)).toEqual(["support.general"]);
    const [record] = (await host.items(id)).records;
    expect(record.delegates).toContainEqual({ worker: "temp", outcome: "skipped", reason: 'No worker "temp" on your roster.' });
    expect((await host.sessionState(id)).delegates.map((d: any) => d.worker)).toContain("temp");
  });
});

describe("best fit's own choice and floor (FIX-1833 V3, V4)", () => {
  /** A judgment turn that answers the post itself. */
  const answersItself = () => mockGenerator({ script: [{ text: "That one is mine." }] });
  /** The desk with a floor of 0.7. */
  const floored = (over: Record<string, unknown> = {}) => standardWorkers({ desk: { minConfidence: 0.7, ...over } });

  it("runs its own turn on a post the call gives the coordinator, skipping the fallback, at any confidence (BR-7, BR-11, BR-22)", async () => {
    const judgment = answersItself();
    const host = bootHost({ standard: floored(), judgment });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "who works here? [route:desk] [conf:0.31]");
    expect(host.route.calls).toHaveLength(1);
    expect(judgment.calls).toHaveLength(1);
    // The turn reads the person's post as it was sent.
    expect(JSON.stringify(judgment.calls[0]!.input)).toContain("who works here? [route:desk] [conf:0.31]");
    expect(host.heard).toEqual([]);
    const { records, messages } = await host.items(id);
    expect(records).toEqual([
      {
        postId: expect.any(String),
        round: 0,
        policy: "best-fit",
        by: "judgment",
        delegates: [],
        none: "the coordinator handed it to no delegate",
        fit: { reason: "coordinator", choice: "desk", confidence: 0.31, minConfidence: 0.7 }
      }
    ]);
    expect(messages.at(-1)!.text).toBe("That one is mine.");
    expect((await host.sessionState(id)).bestFitHold).toBeNull();
  });

  it("clears the hold when the call gives the coordinator the post", async () => {
    const judgment = answersItself();
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "desk");
    // `[fail]` keeps eng.coder from answering, so it holds the person's next post...
    await post(host, id, "the build is red [route:eng.coder] [fail]");
    expect((await host.sessionState(id)).bestFitHold).toMatchObject({ delegate: { worker: "eng.coder" } });
    // ...until it is removed, and the call gives the next post to the coordinator.
    expect((await host.act("alice", id, "removeDelegate", { worker: "eng.coder" })).error).toBeUndefined();
    await post(host, id, "who works here? [route:desk]");
    expect(judgment.calls).toHaveLength(1);
    expect((await host.sessionState(id)).bestFitHold).toBeNull();
  });

  it("delivers a delegate pick at or above the floor, recorded evaluated with no fit (BR-6)", async () => {
    const host = bootHost({ standard: floored() });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "file this feature [route:eng.em] [conf:0.7]");
    expect(heardBy(host)).toEqual(["eng.em"]);
    const { records } = await host.items(id);
    expect(records).toEqual([expect.objectContaining({ by: "evaluated", delegates: [{ worker: "eng.em", outcome: "delivered" }] })]);
    expect(records[0].fit).toBeUndefined();
  });

  it("sends a delegate pick below the floor, or with no confidence, to the fallback, saying why (BR-8, BR-9, BR-22)", async () => {
    const host = bootHost({ standard: floored() });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "can engineering pick this up? [route:eng.em] [conf:0.36]");
    await post(host, id, "and this one? [route:eng.coder]");
    expect(heardBy(host)).toEqual(["support.general", "support.general"]);
    const { records } = await host.items(id);
    expect(records).toEqual([
      expect.objectContaining({
        by: "fallback",
        delegates: [{ worker: "support.general", outcome: "delivered" }],
        fit: { reason: "below-floor", choice: "eng.em", confidence: 0.36, minConfidence: 0.7 }
      }),
      expect.objectContaining({ by: "fallback", fit: { reason: "no-confidence", choice: "eng.coder", minConfidence: 0.7 } })
    ]);
  });

  it("with no fallback, hands a doubtful pick to the coordinator's turn, saying why (BR-8, BR-22)", async () => {
    const judgment = answersItself();
    const host = bootHost({ standard: floored({ fallback: undefined }), judgment });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "can engineering pick this up? [route:eng.em] [conf:0.2]");
    expect(host.heard).toEqual([]);
    expect(judgment.calls).toHaveLength(1);
    expect((await host.items(id)).records).toEqual([
      expect.objectContaining({ by: "judgment", fit: { reason: "below-floor", choice: "eng.em", confidence: 0.2, minConfidence: 0.7 } })
    ]);
  });

  it("uses any delegate pick when no floor is set (BR-10)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "file this [route:eng.em] [conf:0.01]");
    await post(host, id, "and this [route:eng.coder]");
    expect(heardBy(host)).toEqual(["eng.em", "eng.coder"]);
  });

  // An answer that isn't a choice is refused by the evaluation SDK, so it reaches the ladder as a failed call;
  // the ladder's own `not-a-choice` is covered in best-fit.test.ts.
  it("says why a failed call went to the fallback or the turn (BR-12, BR-20, BR-22)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "no mark here");
    await post(host, id, "pick nobody [route:none] [conf:0.9]");
    const { records } = await host.items(id);
    expect(records.map((record: any) => [record.by, record.fit])).toEqual([
      ["fallback", { reason: "failed" }],
      ["fallback", { reason: "failed" }]
    ]);

    const judgment = answersItself();
    const noFallback = bootHost({ judgment });
    const other = await noFallback.conversation("alice", "desk");
    expect((await noFallback.act("alice", other, "setFallback", { worker: null })).error).toBeUndefined();
    await post(noFallback, other, "the gateway is down, so no mark");
    expect(judgment.calls).toHaveLength(1);
    expect((await noFallback.items(other)).records).toEqual([expect.objectContaining({ by: "judgment", fit: { reason: "failed" } })]);
  });

  it("doesn't offer a coordinator with no description, and offers nothing when no delegate is a choice (BR-2)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { description: undefined } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "file this [route:eng.em]");
    expect(Object.keys((host.route.calls[0]!.questions as any).member.criteria)).toEqual(["eng.em", "eng.coder", "support.general"]);

    // Only `silent`, with nothing to pick it by: no call, and today's miss.
    const bare = bootHost({ standard: standardWorkers({ desk: { delegates: ["silent"], fallback: "silent" } }) });
    const conv = await bare.conversation("alice", "desk");
    await post(bare, conv, "who works here? [route:desk]");
    expect(bare.route.calls).toHaveLength(0);
    expect(heardBy(bare)).toEqual(["silent"]);
    expect((await bare.items(conv)).records).toEqual([expect.objectContaining({ by: "fallback", fit: { reason: "no-delegates" } })]);
  });

  it("calls with one delegate and the coordinator: two choices (BR-5)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { delegates: ["eng.em"], fallback: undefined } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "file this [route:eng.em]");
    expect(host.route.calls).toHaveLength(1);
    expect((host.route.calls[0]!.questions as any).member.criteria).toEqual({
      "eng.em": "Plans and staffs engineering work.",
      desk: "Ask the team anything."
    });
  });

  it("offers a coordinator named in its own delegates once, as itself (BR-4)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { delegates: ["eng.em", "desk"], fallback: undefined } }) });
    const id = await host.conversation("alice", "desk");
    await post(host, id, "file this [route:eng.em]");
    expect(Object.keys((host.route.calls[0]!.questions as any).member.criteria)).toEqual(["eng.em", "desk"]);
  });

  it("holds a post for the delegate still on the last one with no call, even one meant for the coordinator (BR-13)", async () => {
    const host = bootHost({ standard: floored() });
    const id = await host.conversation("alice", "desk");
    // `[fail]` keeps eng.coder from answering, so it is still on the post.
    await post(host, id, "the build is red [route:eng.coder] [conf:0.9] [fail]");
    await post(host, id, "who works here? [route:desk] [conf:1]");
    expect(host.route.calls).toHaveLength(1);
    expect(heardBy(host)).toEqual(["eng.coder", "eng.coder"]);
    expect((await host.items(id)).records.map((record: any) => record.by)).toEqual(["evaluated", "held"]);
  });

  it("shows its own turn a delegate's answer to a post routed past it under the delegate's name, never as its own reply", async () => {
    const judgment = answersItself();
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "desk");
    // Routed straight to the EM: no turn of the desk's runs, and the EM's answer lands in the conversation.
    await post(host, id, "file the cart badge [route:eng.em]");
    const answer = (await host.items(id)).messages.find((m) => m.agentName === "eng.em")?.text ?? "";
    expect(answer).toMatch(/^eng\.em heard: /);
    await post(host, id, "who works here? [route:desk]");
    const messages = judgment.calls[0]!.input as Array<{ role: string; content: unknown }>;
    const holding = messages.filter((m) => JSON.stringify(m.content).includes("eng.em heard:"));
    // The answer is in the turn's history once, as a line from eng.em, not as an assistant turn of its own.
    expect(holding).toHaveLength(1);
    // An assistant message only with the delegate named on it, so it never reads as the coordinator's own words.
    expect(holding[0]!.role).toBe("assistant");
    expect(String(holding[0]!.content)).toBe(`eng.em, a delegate in this conversation, answered:\n${answer}`);
    expect(messages.some((m) => m.role === "system" && JSON.stringify(m.content).includes("eng.em heard:"))).toBe(false);
    // The routed post reads as handled: right after it, the turn's history says where best fit sent it.
    const at = messages.findIndex((m) => m.role === "user" && m.content === "file the cart badge [route:eng.em]");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(messages[at + 1]).toEqual({
      role: "assistant",
      content: "Handed this post to eng.em by its routing, with no turn of mine. Its answer lands in this conversation under its name."
    });
  });

  it("records a coordinator pick unplaced, and says so, when its turn fails (BR-14)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "who works here? [route:desk]");
    const { records, messages } = await host.items(id);
    expect(records).toEqual([expect.objectContaining({ by: "unplaced", delegates: [] })]);
    expect(messages.at(-1)!.text).toMatch(/^Nobody took this post: /);
  });
});

describe("delivery and answers (V4)", () => {
  it("lands each answer once, under the delegate's name (BR-20)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "fix it [route:eng.coder]");
    const { messages } = await host.items(id);
    expect(messages.filter((m) => m.agentName === "eng.coder")).toEqual([
      { agentName: "eng.coder", text: "eng.coder heard: alice, through desk: fix it [route:eng.coder]" }
    ]);
  });

  it("opens one session per conversation per delegate, linked at create, and reuses it (BR-20a)", async () => {
    const host = bootHost();
    const first = await host.conversation("alice", "desk");
    const second = await host.conversation("alice", "desk");
    await post(host, first, "one [route:eng.coder]");
    await post(host, first, "two [route:eng.coder]");
    await post(host, second, "three [route:eng.coder]");
    const [a, b, c] = host.heard.map((h) => h.sessionId);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    const runtime = await host.state.getRuntime();
    for (const sessionId of [a!, c!]) {
      const record = await runtime.stores.session.get(sessionId);
      expect(record?.state).toMatchObject({ workerId: "eng.coder" });
      expect(record?.userId).toBe("alice");
    }
  });

  it("opens fresh delegate sessions for a conversation deleted and created again under the same id (BR-20a)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk", "talk-1");
    await post(host, id, "before [route:eng.coder]");
    const runtime = await host.state.getRuntime();
    await runtime.stores.session.delete(id);
    const again = await host.conversation("alice", "desk", "talk-1");
    expect(again).toBe(id);
    await post(host, again, "after [route:eng.coder]");
    const [before, after] = host.heard.map((h) => h.sessionId);
    expect(after).not.toBe(before);
  });

  it("lands an answer sent twice once, and refuses a token no delivery carries (BR-21, BR-22, BR-27)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "fix it [route:eng.coder]");
    const [delivery] = (await host.sessionState(id)).deliveries;
    expect(delivery).toMatchObject({ status: "delivered", answered: true, round: 0, delegate: { worker: "eng.coder" } });

    const again = await host.act("alice", id, "delegateAnswer", { token: delivery.token, body: "a second answer" }, "coordinator", "internal");
    expect(again.output).toEqual({ landed: false });
    const forged = await host.act("alice", id, "delegateAnswer", { token: "made-up", body: "forged" }, "coordinator", "internal");
    expect(messageOf(forged.error)).toMatch(/No delivery in this conversation carries that token/);
    const withRound = await host.act(
      "alice",
      id,
      "delegateAnswer",
      { token: delivery.token, body: "mine", round: 2, author: "eng.em" },
      "coordinator",
      "internal"
    );
    expect(withRound.error).toBeDefined();
    const lines = (await host.items(id)).messages.filter((m) => m.agentName !== undefined);
    expect(lines).toHaveLength(1);
    // Not reachable by a caller at all.
    await expect(host.act("alice", id, "delegateAnswer", { token: delivery.token, body: "x" })).rejects.toThrow(
      /does not define action "delegateAnswer"/
    );
  });

  it("doesn't deliver to a delegate fired between pick and delivery: its create check refuses (BR-31)", async () => {
    const host = bootHost();
    expect((await host.hire("alice", { id: "temp", flow: "helper", description: "Temporary." })).error).toBeUndefined();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "addDelegate", { worker: "temp" })).error).toBeUndefined();
    // Fire `temp` the moment the pick has checked it, before its delivery.
    const read = host.installation.rosterWorker;
    let fired = false;
    host.installation.rosterWorker = async (ctx, workerId) => {
      const found = await read(ctx, workerId);
      if (workerId === "temp" && !fired) {
        fired = true;
        await host.fire("alice", "temp");
      }
      return found;
    };
    await post(host, id, "for temp [route:temp]");
    expect(host.heard).toEqual([]);
    const [record] = (await host.items(id)).records;
    expect(record.delegates).toEqual([expect.objectContaining({ worker: "temp", outcome: "failed" })]);
    expect(record.delegates[0].reason).toMatch(/No worker "temp"/);
  });
});

describe("judgment (V7)", () => {
  it("hands the post off with its tool, one delivery per hand-off, recorded once (BR-12, BR-21, BR-28)", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "h1", toolName: "handOff", args: { worker: "eng.em" } },
            { toolCallId: "h2", toolName: "handOff", args: { worker: "eng.em" } },
            { toolCallId: "h3", toolName: "handOff", args: { worker: "eng.coder" } }
          ]
        },
        { text: "Sent it to the EM." }
      ]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "plan the release, codeword lantern");
    expect(heardBy(host)).toEqual(["eng.em"]);
    expect(host.heard[0]!.message).toContain("lantern");
    const [record] = (await host.items(id)).records;
    expect(record).toEqual({
      postId: expect.any(String),
      round: 0,
      policy: "judgment",
      by: "judgment",
      delegates: [
        { worker: "eng.em", outcome: "delivered" },
        { worker: "eng.em", outcome: "skipped", reason: "it was already handed this post in this round" },
        { worker: "eng.coder", outcome: "skipped", reason: '"eng.coder" isn\'t a delegate in this conversation. Add it first.' }
      ]
    });
  });

  it("answers itself, recorded with no delegate, and wakes nothing when an answer lands at rounds 0 (BR-12, BR-23)", async () => {
    const judgment = mockGenerator({
      script: [
        { text: "I can answer that myself." },
        { toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.em" } }] },
        { text: "Handed off." }
      ]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "what day is it?");
    const [first] = (await host.items(id)).records;
    expect(first).toMatchObject({ by: "judgment", delegates: [], none: "the coordinator handed it to no delegate" });

    await post(host, id, "plan the release");
    expect(judgment.calls).toHaveLength(2);
    // The EM's answer landed, and woke no further judgment turn.
    const { messages } = await host.items(id);
    expect(messages.some((m) => m.agentName === "eng.em")).toBe(true);
    expect(judgment.calls).toHaveLength(2);
  });

  it("reads its delegates with its tool, and the read equals the conversation's list (BR-10)", async () => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "l1", toolName: "listDelegates", args: {} }] }, { text: "Your delegates are listed." }]
    });
    const host = bootHost({ judgment });
    const id = await host.conversation("alice", "chief");
    expect((await host.act("alice", id, "addDelegate", { worker: "eng.coder", note: "the build" })).error).toBeUndefined();
    expect((await host.act("alice", id, "removeDelegate", { worker: "eng.em" })).error).toBeUndefined();
    await post(host, id, "who are your delegates?");
    const { all } = await host.items(id);
    const read = all.find((item: any) => item.type === "tool_output" && item.blockName === "listDelegates");
    // The records as the session holds them, each with what it does and takes, which are read, never stored.
    expect(read.output.delegates.map(({ takes: _takes, description: _description, ...record }: any) => record)).toEqual(
      (await host.sessionState(id)).delegates
    );
    // Never in its prompt: the turn's system text names no delegate.
    const prompt = JSON.stringify(judgment.calls[0]!.input);
    expect(prompt).not.toContain("eng.coder");
  });

  it("refuses a hand-off to a delegate whose flow can't take a post", async () => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "nobody" } }] }, { text: "ok" }]
    });
    const host = bootHost({ judgment, standard: standardWorkers() });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "anything");
    expect(host.heard).toEqual([]);
  });

  it("tells the model why a hand-off was skipped, and who takes posts instead, each sentence ending once", async () => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "notes" } }] }, { text: "ok" }]
    });
    // `notes` runs on `quiet`, which takes no post: a default the hand-off can't reach.
    const host = bootHost({ judgment, standard: standardWorkers({ chief: { delegates: ["eng.em", "notes"] } }) });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "take notes on the release");
    expect(host.heard).toEqual([]);
    const told = (await host.items(id)).all.find((item: any) => item.type === "tool_output" && item.blockName === "handOff");
    expect(told.output.note).toBe(
      'Not handed to notes: Worker "notes" runs on flow "quiet", which can\'t take a delegated post. Delegates here that take posts: eng.em.'
    );
  });

  it("names the delegates here that take posts when it refuses a hand-off, in the tool's answer and the record", async () => {
    // The turn tries the delegate that takes only tasks first. Its refusal
    // names the ones a hand-off reaches, so the turn's next pick needn't be a hire.
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.builder" } }] },
        { toolCalls: [{ toolCallId: "h2", toolName: "handOff", args: { worker: "eng.em" } }] },
        { text: "Handed to the EM." }
      ]
    });
    const host = bootHost({
      judgment,
      standard: standardWorkers({ chief: { delegates: ["eng.builder", "eng.em", "eng.lead"] } })
    });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "get this feature filed");
    const refusal =
      'Worker "eng.builder" runs on flow "tasker", which can\'t take a delegated post. ' +
      "Delegates here that take posts: eng.em, eng.lead.";
    const told = (await host.items(id)).all.filter((item: any) => item.type === "tool_output" && item.blockName === "handOff");
    expect(told[0].output.note).toBe(`Not handed to eng.builder: ${refusal}`);
    expect(heardBy(host)).toEqual(["eng.em"]);
    const [record] = (await host.items(id)).records;
    expect(record.delegates).toEqual([
      { worker: "eng.builder", outcome: "skipped", reason: refusal },
      { worker: "eng.em", outcome: "delivered" }
    ]);
  });

  it("says so in a refused hand-off when no delegate here takes posts", async () => {
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "h1", toolName: "handOff", args: { worker: "eng.builder" } }] }, { text: "ok" }]
    });
    const host = bootHost({ judgment, standard: standardWorkers({ chief: { delegates: ["eng.builder", "notes"] } }) });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "get this feature filed");
    const told = (await host.items(id)).all.find((item: any) => item.type === "tool_output" && item.blockName === "handOff");
    expect(told.output.note).toBe(
      'Not handed to eng.builder: Worker "eng.builder" runs on flow "tasker", which can\'t take a delegated post. No delegate here takes posts.'
    );
  });
});

describe("judgment is the agent's own turn (S8)", () => {
  /** A catalog tool an `agent` worker names in `tools:`, and a coordinator worker can too. */
  const ping = handler({
    name: "ping",
    description: "Answers pong.",
    inputSchema: z.object({}),
    outputSchema: z.object({ pong: z.boolean() }),
    execute: () => ({ pong: true })
  });

  const toolOutputs = async (host: ReturnType<typeof bootHost>, id: string) =>
    (await host.items(id)).all.filter((item: any) => item.type === "tool_output").map((item: any) => item.blockName);

  it("reads the worker's model and its tools: line from the agent catalog, beside the delegate tools", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "p1", toolName: "ping", args: {} },
            { toolCallId: "l1", toolName: "listDelegates", args: {} }
          ]
        },
        { text: "Done." }
      ]
    });
    const host = bootHost({
      judgment,
      agent: { catalog: { ping } },
      standard: standardWorkers({ chief: { model: "test/judge", tools: ["ping"] } })
    });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "ping, then list");
    expect(judgment.calls[0]!.model).toBe("test/judge");
    expect(await toolOutputs(host, id)).toEqual(["ping", "listDelegates"]);
    // The worker's own instructions are the turn's prompt, as an agent worker's are.
    expect(JSON.stringify(judgment.calls[0]!.input)).toContain("Route the work.");
  });

  it("keeps the delegate tools when the worker's tools: line grants nothing, and fences everything else", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "p1", toolName: "ping", args: {} },
            { toolCallId: "h1", toolName: "handOff", args: { worker: "eng.em" } }
          ]
        },
        { text: "Handed off." }
      ]
    });
    const host = bootHost({ judgment, agent: { catalog: { ping } }, standard: standardWorkers({ chief: { tools: [] } }) });
    const id = await host.conversation("alice", "chief");
    await post(host, id, "hand it on");
    expect(await toolOutputs(host, id)).toEqual(["handOff"]);
    expect(heardBy(host)).toEqual(["eng.em"]);
  });

  it("refuses a coordinator worker whose tools: line names a tool the agent catalog doesn't carry", async () => {
    const host = bootHost({ agent: { catalog: { ping } }, standard: standardWorkers({ chief: { tools: ["pong"] } }) });
    expect(host.installation.standardWorkerProblems().join("\n")).toMatch(/worker "chief" — .*pong/);
  });
});
