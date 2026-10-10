/**
 * The coordinator turn's history (`coordinatorHistory`): each delegate's answer said as a line
 * from that delegate, and each post the routing handed on followed by what happened to it, matched to the
 * conversation's items in order, so the coordinator's own reply stays its own
 * even when its text repeats a delegate's.
 */
import { describe, expect, it } from "vitest";
import type { SessionItem } from "@flow-state-dev/core/types";
import { coordinatorHistory } from "../src/coordinator/coordinator-lines";

const message = (role: "user" | "assistant", payload: string, agentName?: string) =>
  ({ type: "message", role, payload, ...(agentName === undefined ? {} : { agentName }) }) as unknown as SessionItem;

const NAMES = ["coordinator-judgment"];

describe("the coordinator turn's history", () => {
  it("says a delegate's answer as a line from it, and leaves everything else as it is", () => {
    const items = [message("user", "file it"), message("assistant", "Filed x.", "eng.em"), message("assistant", "Done.", "coordinator-judgment")];
    const history = [
      { role: "user" as const, content: "file it" },
      { role: "assistant" as const, content: "Filed x." },
      { role: "assistant" as const, content: "Done." },
      { role: "tool" as const, content: [{ type: "tool-result" }] }
    ];
    expect(coordinatorHistory(history, items, NAMES)).toEqual([
      history[0],
      { role: "assistant", content: "eng.em, a delegate in this conversation, answered:\nFiled x." },
      history[2],
      history[3]
    ]);
  });

  it("matches in order, so a reply of the coordinator's own that repeats a delegate's words stays its own", () => {
    const items = [message("assistant", "OK.", "coordinator-judgment"), message("assistant", "OK.", "eng.em")];
    const history = [
      { role: "assistant" as const, content: "OK." },
      { role: "assistant" as const, content: "OK." }
    ];
    expect(coordinatorHistory(history, items, NAMES)).toEqual([
      { role: "assistant", content: "OK." },
      { role: "assistant", content: "eng.em, a delegate in this conversation, answered:\nOK." }
    ]);
  });

  it("follows a post the routing delivered with the coordinator's account of it, and leaves a post its own turn took alone", () => {
    const post = (payload: string, requestId: string) => ({ ...message("user", payload), requestId }) as SessionItem;
    const record = (postId: string, by: string, workers: string[]) =>
      ({
        type: "component",
        requestId: postId,
        payload: {
          component: "coordinator-route",
          data: { postId, round: 0, by, delegates: workers.map((worker) => ({ worker, outcome: "delivered" })) }
        }
      }) as unknown as SessionItem;
    const items = [post("file it", "r1"), record("r1", "evaluated", ["eng.em"]), post("everyone?", "r2"), record("r2", "everyone", ["a", "b"]), post("hire", "r3"), record("r3", "judgment", [])];
    const history = [
      { role: "user" as const, content: "file it" },
      { role: "user" as const, content: "everyone?" },
      { role: "user" as const, content: "hire" }
    ];
    expect(coordinatorHistory(history, items, NAMES)).toEqual([
      history[0],
      { role: "assistant", content: "Handed this post to eng.em by its routing, with no turn of mine. Its answer lands in this conversation under its name." },
      history[1],
      { role: "assistant", content: "Handed this post to a, b by its routing, with no turn of mine. Their answers land in this conversation under their names." },
      history[2]
    ]);
  });

  it("keeps a message the coordinator wrote with no name (\"Nobody took this post\") as its own", () => {
    const items = [message("assistant", "Nobody took this post: x.")];
    const history = [{ role: "assistant" as const, content: "Nobody took this post: x." }];
    expect(coordinatorHistory(history, items, NAMES)).toEqual(history);
  });
});
