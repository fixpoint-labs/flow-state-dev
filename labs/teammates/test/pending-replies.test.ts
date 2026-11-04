/** `pendingFor` drops talk rows sent before the conversation window. */
import { describe, expect, it } from "vitest";
import type { ConversationEntry, TalkRow } from "../src/adapter";
import { pendingFor } from "../src/lib/talk";

const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";

const reply = (id: string, at: number): TalkRow => ({ id, from: RESEARCHER, to: LEAD, text: "Nov 12", at, inReplyTo: "msg_ask" });
const read: ConversationEntry = { kind: "received", id: "c_in_window", messageId: "msg_r4", from: RESEARCHER, text: "Nov 12" };

describe("pending replies in a thread's window", () => {
  const windowStart = 1000;
  const talk = [reply("msg_r1", 100), reply("msg_r2", 200), reply("msg_r3", 300), reply("msg_r4", 1050)];

  it("does not hold replies older than the thread's window as pending", () => {
    expect(pendingFor(LEAD, talk, [read], windowStart)).toEqual([]);
  });

  it("still holds a reply that is newer than the window and not yet read, as pending", () => {
    const waiting = reply("msg_r5", 1400);
    expect(pendingFor(LEAD, [...talk, waiting], [read], windowStart)).toEqual([waiting]);
  });

  it("holds a reply as pending when the thread has no window bound, as before", () => {
    expect(pendingFor(LEAD, [reply("msg_r9", 1400)], [read]).map((m) => m.id)).toEqual(["msg_r9"]);
  });
});
