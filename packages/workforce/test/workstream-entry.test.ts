/**
 * `parseWorkstreamEntry`: the one parser a project's entries are read with,
 * by `readProject` on the server and by a browser through
 * `@flow-state-dev/workforce/browser`. Two parsers for one shape drifted
 * before; these pin what the shared one accepts and refuses.
 */
import { describe, expect, it } from "vitest";
import { parseWorkstreamEntry as fromBrowser } from "../src/browser";
import { parseWorkstreamEntry } from "../src/projects/workstream-entry";

const stored = {
  title: "Checkout",
  lead: "eng-lead",
  sessionId: "s-1",
  status: "on-track",
  due: "2026-11-01",
  objectives: [{ text: "ship it", met: true, metAt: "2026-10-09T00:00:00.000Z", metBy: { userId: "alice" } }],
  openedAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
  writtenBy: { userId: "alice", workerId: "eng-lead" }
};

describe("parseWorkstreamEntry", () => {
  it("reads the place off the key and the fields off the state, owner decoded", () => {
    const entry = parseWorkstreamEntry("workstreams/apollo/~a%2Fl/checkout", stored);
    expect(entry).toMatchObject({ project: "apollo", owner: "a/l", id: "checkout", title: "Checkout", lead: "eng-lead" });
    expect(entry?.objectives[0]).toMatchObject({ text: "ship it", met: true });
  });

  it("is the same function the browser entry exports", () => {
    expect(fromBrowser).toBe(parseWorkstreamEntry);
  });

  it("answers undefined for a key that is not a project's direct entry", () => {
    expect(parseWorkstreamEntry("workstreams/apollo/alice/checkout", stored)).toBeUndefined(); // no owner mark
    expect(parseWorkstreamEntry("workstreams/apollo/~alice", stored)).toBeUndefined();
    expect(parseWorkstreamEntry("workstreams/apollo/~alice/checkout/deeper", stored)).toBeUndefined();
    expect(parseWorkstreamEntry("projects/apollo", stored)).toBeUndefined();
  });

  it("throws on state that is not an entry, rather than guessing its fields", () => {
    const { lead: _lead, ...noLead } = stored;
    expect(() => parseWorkstreamEntry("workstreams/apollo/~alice/checkout", noLead)).toThrow();
    expect(() => parseWorkstreamEntry("workstreams/apollo/~alice/checkout", { ...stored, writtenBy: undefined })).toThrow();
  });

  it("fills an entry's defaults as the store does", () => {
    const { sessionId: _s, status: _st, due: _d, objectives: _o, ...bare } = stored;
    expect(parseWorkstreamEntry("workstreams/apollo/~alice/checkout", bare)).toMatchObject({
      sessionId: null,
      status: "on-track",
      due: null,
      objectives: []
    });
  });
});
