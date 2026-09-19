import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { missingRoots, scanClaims, scanFigureDrift } from "../../../scripts/check-isolation-coordinate.mjs";

type LineHit = { line: number; text: string };
type DriftHit = { line: number; label: string };

const lines = (text: string): LineHit[] => (scanClaims as (t: string) => LineHit[])(text);
const drift = (src: string): DriftHit[] => (scanFigureDrift as (s: string) => DriftHit[])(src);
const roots = (root?: string): string[] => (missingRoots as (r?: string) => string[])(root);

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

/**
 * The window is a sentence, not a physical line. Scanning lines meant ordinary
 * prose wrapping walked through the guard untouched, and every control above
 * uses a one-line fixture, so the suite stayed green over the hole. The corpus
 * wraps — 2,986 mid-sentence breaks across 40 of 53 scanned files — so this is
 * a live gap, not a theoretical one.
 *
 * Both halves are pinned here, because widening a window is how a guard starts
 * crying wolf: it must catch the claim the wrap split, AND stay quiet when the
 * concepts merely neighbour each other in the same wrapped paragraph.
 */
describe("wrapped prose — a claim is a sentence, not a line", () => {
  // Split where wrapping actually splits it: neither physical line carries all
  // three concepts, so the pre-change line scan matched nothing here.
  const wrapped = "Each user-scoped resource is namespaced\nby the flow kind, so two seats share a row.";

  it("fires on a stale claim that ordinary wrapping split across two lines", () => {
    expect(lines(wrapped)).toHaveLength(1);
  });

  it("names the line the offending words landed on, not the top of the paragraph", () => {
    expect(lines(wrapped)[0]?.line).toBe(2);
  });

  it("stays silent when two correct sentences merely neighbour each other", () => {
    // Every concept is present in the paragraph and none of them form one
    // claim. A paragraph-wide window reports this; a sentence window must not.
    expect(
      lines("Rows are stored at the resolved instance\nid. The registry looks up a handler per\nflow kind.")
    ).toEqual([]);
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

  it("recognises a keying word the figure gate only knows through the shared constant", () => {
    // `namespac` lives in KEYING and was absent from the gate's old
    // hand-written list — the exact duplication that let the two scanners
    // diverge. Deriving the gate from KEYING is what makes this fire.
    expect(drift(figure("Rows land under a member handle", "ROWS NAMESPACED PER SEAT"))).toHaveLength(1);
  });
});

/**
 * A guard that scans nothing reports the same green as a guard that scanned
 * everything. The walk used to swallow a missing root, so a renamed docs
 * directory would have passed CI silently.
 */
describe("scan surface — a missing root must be loud, not empty", () => {
  it("names a configured root that is not there", () => {
    const base = mkdtempSync(join(tmpdir(), "isolation-roots-"));
    mkdirSync(join(base, "docs/architecture"), { recursive: true });
    mkdirSync(join(base, "docs/contributing"), { recursive: true });
    expect(roots(base)).toEqual(["docs/atlas"]);
  });

  it("finds every configured root present in this repo", () => {
    expect(roots()).toEqual([]);
  });
});
