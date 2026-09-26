/**
 * The scripted model's scenario dispatcher, which every keyless check in this
 * app runs on.
 *
 * Two promises, and why each matters:
 *
 *   - A scenario is picked by a marker in the LATEST user turn only. A seat's
 *     conversation carries its earlier notes, so matching the whole history
 *     would answer a new note with an old note's scenario.
 *   - Each request walks its own copy of a scenario's steps. A multi-step
 *     scenario (a tool call, then the reply) run twice in one process must
 *     start at its first step both times; one shared cursor made the second
 *     run start mid-script and skip the tool call.
 *
 * Red state, before the green was trusted: today's dispatcher (whole-history
 * match, one cursor per scenario) failed both cases.
 */
import { describe, expect, it } from "vitest";
import { deskClerkMock } from "@/lib/e2e-mock-script";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("the scripted model's scenario dispatcher", () => {
  it("starts a multi-step scenario at its first step on every request", () => {
    deskClerkMock.reset();
    const note = "[scenario:clerk-file] clerk-token-aaa the charger caught fire";

    const first = [user(note)];
    expect(deskClerkMock.next(first)?.toolCalls?.[0]?.toolName).toBe("desk-clerk-file");
    expect(deskClerkMock.next(first)?.text).toContain("[clerk:filed]");

    // A second request with the very same note: a fresh messages array, so a
    // fresh walk of the script.
    const second = [user(note)];
    expect(deskClerkMock.next(second)?.toolCalls?.[0]?.toolName).toBe("desk-clerk-file");
    expect(deskClerkMock.next(second)?.text).toContain("[clerk:filed]");
  });

  it("matches the latest user turn only, not an earlier note in the conversation", () => {
    deskClerkMock.reset();
    const history = [
      user("[scenario:clerk-file] clerk-token-bbb please escalate"),
      assistant("[front desk] [clerk:filed] Filed onto escalations."),
      user("[scenario:clerk-answer] clerk-token-ccc where is my refund?"),
    ];
    const step = deskClerkMock.next(history);
    expect(step?.toolCalls).toBeUndefined();
    expect(step?.text).toContain("[clerk:answered]");

    // And a latest turn with no marker is unmatched, however marked the history.
    const unmarked = [...history, assistant("..."), user("just saying hello")];
    expect(deskClerkMock.next(unmarked)?.text).not.toMatch(/\[clerk:/);
  });
});
