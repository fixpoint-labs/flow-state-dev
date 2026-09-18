import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { scanFigureDrift, scanLines } from "../../../scripts/check-isolation-coordinate.mjs";

type LineHit = { line: number; text: string };
type DriftHit = { line: number; label: string };

const lines = (text: string): LineHit[] => (scanLines as (t: string) => LineHit[])(text);
const drift = (src: string): DriftHit[] => (scanFigureDrift as (s: string) => DriftHit[])(src);

/**
 * The guard exists because FIX-1420's first scan was a phrase list generalised
 * from the stale lines it had already found: it reported green while two sites
 * survived. So the control that matters is not "does it fire on the sentence we
 * know about" — it is "does it fire on a wording nobody has written yet, and
 * stay silent on the sentences that are correct."
 */
describe("per-kind isolation — concepts co-occurring, not a phrase list", () => {
  it("fires on the original stale wording", () => {
    expect(lines("A resource with `flowIsolation: true` namespaces its rows by flow kind.")).toHaveLength(1);
  });

  it("fires on a wording the guard was never shown — the point of a concept match", () => {
    expect(lines("Each user-scoped resource is stored at a key keyed by the flow kind.")).toHaveLength(1);
  });

  it("reports the line, so a failure names where to look", () => {
    expect(lines("intro\nmore\nthe scopeId is keyed by flow kind for this resource")[0]?.line).toBe(3);
  });

  it("stays silent on the current rule, the sentence the corpus is full of", () => {
    expect(lines("Isolation keys on the resolved flow instance id, not the flow kind.")).toEqual([]);
  });

  it("stays silent on a route lookup, which is not about a stored row", () => {
    expect(lines("const entry = registry.get(flowKind);")).toEqual([]);
  });

  it("stays silent on isolation as a topic with no keying claim", () => {
    expect(lines("Subagent output isolation keeps a tool's result out of the parent turn.")).toEqual([]);
  });
});

const figure = (label: string, visible: string) =>
  `<figure><svg role="img" aria-label="${label}"><text>${visible}</text></svg><figcaption>c</figcaption></figure>`;

/**
 * The second control covers the class the token scan provably cannot see: the
 * stale `aria-label` on #1869 named neither coordinate, so no co-occurrence
 * rule matched it, and the guard printed OK with the drift in place.
 */
describe("figure drift — the label must name the coordinate its diagram commits to", () => {
  it("fires when the visible text says per seat and the label does not", () => {
    expect(drift(figure("Resource rows keyed by member identity", "RESOURCE STORED PER SEAT"))).toHaveLength(1);
  });

  it("stays silent when the label names the same coordinate", () => {
    expect(drift(figure("A resource row stored per seat", "RESOURCE STORED PER SEAT"))).toEqual([]);
  });

  it("stays silent on a figure committing to no storage coordinate at all", () => {
    expect(drift(figure("One child session per seat", "ONE CHILD PER SEAT"))).toEqual([]);
  });
});
