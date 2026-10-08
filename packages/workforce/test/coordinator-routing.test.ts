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
 */
import { describe, expect, it } from "vitest";
import { mockGenerator } from "@flow-state-dev/testing";
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
      licenses: "Audits licenses."
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
    expect(read.output.delegates).toEqual((await host.sessionState(id)).delegates);
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
});
