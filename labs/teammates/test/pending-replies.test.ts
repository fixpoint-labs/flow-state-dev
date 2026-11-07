/**
 * A message another worker sent shows as pending until its turn lands, and pending
 * lines draw at the end of the thread. The thread holds only the newest window
 * of items, so a reply older than that window is read, but its received line is
 * not in the thread. It must not count as pending, or it sticks to the bottom
 * under every newer message.
 */
import { describe, expect, it } from "vitest";
import { toEntries, type TalkRow } from "../src/adapter";
import { pendingFor } from "../src/lib/talk";

const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";
const WORKERS = new Set([LEAD, RESEARCHER]);

const user = (id: string, ts: number, text: string) =>
  ({ id, type: "message", role: "user", status: "completed", requestId: `req_${id}`, itemIndex: 0, ts, content: [{ type: "output_text", text }] });
const answer = (id: string, ts: number, text: string) =>
  ({ id, type: "message", role: "assistant", status: "completed", requestId: `req_${id}`, itemIndex: 1, ts, content: [{ type: "output_text", text }] });
/** A reply landing in the thread: the received line the worker reads it through. */
const received = (id: string, ts: number, messageId: string) =>
  ({ id, type: "component", component: "workforce:received", status: "completed", requestId: `req_${id}`, itemIndex: 0, ts, agentName: RESEARCHER, data: { id: messageId, from: RESEARCHER, text: "Nov 12" } });
const reply = (id: string, at: number): TalkRow => ({ id, from: RESEARCHER, to: LEAD, text: "Nov 12", at, inReplyTo: "msg_question" });

describe("pending replies in a thread's window", () => {
  // Three replies from researcher, all older than the newest window of items, which starts at 1000.
  const older = [reply("msg_r1", 100), reply("msg_r2", 200), reply("msg_r3", 300)];
  const windowStart = 1000;
  const items = [
    received("c_in_window", 1100, "msg_r4"),
    answer("a_1", 1150, "Got the date."),
    user("u_1", 1200, "Thanks. What's next?"),
    answer("a_2", 1250, "The post."),
    user("u_2", 1300, "Newer message."),
    answer("a_3", 1350, "Still newer."),
  ];
  const talk = [...older, reply("msg_r4", 1050)];

  it("does not hold replies older than the thread's window as pending, after newer user and assistant messages", () => {
    const entries = toEntries(items as never, WORKERS);
    expect(entries.map((e) => e.kind)).toEqual(["received", "assistant", "user", "assistant", "user", "assistant"]);
    expect(pendingFor(LEAD, talk, entries, windowStart)).toEqual([]);
  });

  it("still holds a reply that is newer than the window and not yet read, as pending", () => {
    const entries = toEntries(items as never, WORKERS);
    const waiting = reply("msg_r5", 1400);
    expect(pendingFor(LEAD, [...talk, waiting], entries, windowStart)).toEqual([waiting]);
  });

  it("holds a reply as pending when the thread has no window bound, as before", () => {
    const entries = toEntries(items as never, WORKERS);
    expect(pendingFor(LEAD, [reply("msg_r9", 1400)], entries).map((m) => m.id)).toEqual(["msg_r9"]);
  });
});
