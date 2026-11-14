/**
 * A coordinator's history summary reads the conversation the way its turn
 * does. The turn's history says a delegate's answer as a line from that
 * delegate, and follows a post the routing handed on with the coordinator's
 * account of it (`coordinatorHistory`). Once turns are folded, the turn reads
 * only the summary for them, so a summary written from the raw turns would
 * lose both: a delegate's answer would read as the coordinator's own, and a
 * routed post as one still waiting on it. That cannot be put back later.
 *
 * Asserted on what the summary model was handed, and on the turn's history
 * after the fold. The summary's own words are never checked.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootHost, messageOf, quiet } from "./coordinator-harness";

type Sent = { role: string; content: unknown };
const text = (messages: unknown) => JSON.stringify(messages);

describe("a coordinator's history summary", () => {
  it("folds a routed post and its delegate's answer with the writer and the routing kept", async () => {
    const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "That one is mine." } }] });
    const summary = mockGenerator({
      name: "earlier-turns",
      script: [{ when: () => true, then: { structuredOutput: { summary: "Earlier: the cart badge was filed." } } }]
    });
    const host = bootHost({ judgment, summary, historyWindow: 4 });
    const id = await host.conversation("alice", "desk");
    const post = async (message: string) => {
      const result = await host.act("alice", id, "respond", { message });
      expect(result.error, messageOf(result.error)).toBeUndefined();
      await quiet(host);
    };

    // Routed straight to the EM: no turn of the desk's runs, and the EM's answer lands in the conversation.
    await post("file the cart badge [route:eng.em]");
    const answer = (await host.items(id)).messages.find((m) => m.agentName === "eng.em")?.text ?? "";
    expect(answer).toMatch(/^eng\.em heard: /);
    // Enough of the desk's own turns that the routed post is folded.
    for (let n = 1; n <= 6; n++) await post(`who works here, ${n}? [route:desk] [conf:1]`);

    // Every fold, together, was handed the routed post with its account and the answer under its writer.
    // The two can land in different turns, so in different folds.
    const handed = summary.calls.map((call) => text(call.input)).join("\n");
    expect(handed).toContain("file the cart badge [route:eng.em]");
    expect(handed).toContain("Handed this message to eng.em by its routing, with no turn of mine.");
    // The delegate's answer is folded, and never as an unattributed reply.
    const asWritten = handed.split("eng.em heard:").length - 1;
    expect(asWritten).toBeGreaterThan(0);
    expect(handed.split("eng.em, a delegate in this conversation, answered:").length - 1).toBe(asWritten);

    // And the turn after the fold no longer reads the originals: the summary stands for them.
    const last = judgment.calls.at(-1)!.input as Sent[];
    expect(last.some((m) => m.role === "user" && m.content === "file the cart badge [route:eng.em]")).toBe(false);
    expect(text(last)).toContain("Earlier: the cart badge was filed.");
  });
});
