import { describe, expect, it } from "vitest";
import { interruptedBySession, type InterruptedRequest } from "../src";

/** An entry as `requests.interrupted()` lists it; the handle's methods aren't read here. */
function cut(id: string, actionName: string, interruptedAt: number, sessionId?: string): InterruptedRequest {
  return { id, flow: "app", flowKind: "app", actionName, interruptedAt, ...(sessionId === undefined ? {} : { sessionId }) } as InterruptedRequest;
}

describe("interruptedBySession", () => {
  // An app badges a conversation and draws Continue / Discard at the lost turn
  // from this map. A worker's own background pass is not a turn the user sent,
  // so it must badge nothing; a request with no session has nowhere to show.
  it("keeps only the app's turn actions, by session, oldest first", () => {
    const map = interruptedBySession(
      [
        cut("r3", "respond", 30, "s1"),
        cut("r1", "respond", 10, "s1"),
        cut("r2", "respond", 20, "s2"),
        cut("pass", "wake", 5, "s1"),
        cut("loose", "respond", 1)
      ],
      { actions: ["respond"] }
    );

    expect([...map.keys()].sort()).toEqual(["s1", "s2"]);
    expect(map.get("s1")!.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(map.get("s2")!.map((r) => r.id)).toEqual(["r2"]);
  });

  it("is empty when nothing of the app's was cut off", () => {
    expect(interruptedBySession([cut("pass", "wake", 5, "s1")], { actions: ["respond"] }).size).toBe(0);
  });
});
