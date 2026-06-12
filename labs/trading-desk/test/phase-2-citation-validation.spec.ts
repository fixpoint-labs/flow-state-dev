/**
 * Tests for `validateCitations` (FIX-679) — the deterministic post-debate
 * citation auditor. Verifies substring matching of `[memo:X "quote"]` tags
 * against the named analyst memo body, and the shape of the
 * `citationIntegrity` report it writes to session state.
 *
 * These tests encode WHY the handler exists: a quote attributed to an
 * analyst memo must actually appear in that memo, verbatim. A paraphrase
 * that the analyst never wrote is the failure mode the audit closes — so
 * the load-bearing assertions are that an invented quote lands in
 * `invalidTags` and a verbatim one does not.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { validateCitations } from "../src/flows/analysis/agents/research/validate-citations";
import { PHASE_1_MEMO_KEYS } from "../src/flows/analysis/registry";
import { memosCollection, phase2Contributions } from "../src/flows/analysis/resources";
import { sessionStateSchema } from "../src/flows/analysis/state";

const flow = defineFlow({
  kind: "p2-validate-citations-test",
  actions: { run: { block: validateCitations } },
  session: { stateSchema: sessionStateSchema },
  resources: { memos: memosCollection, p2Contributions: phase2Contributions },
})({ id: "test" });

const baseSessionState = {
  ticker: "NVDA",
  date: "2026-05-06",
  costPreset: "full" as const,
  dataSource: "fixture" as const,
  activePhase: "phase-2" as const,
  maxDebateRounds: 2,
};

/** Seed an analyst memo whose body contains `paragraph`. */
function analystMemo(shortName: keyof typeof PHASE_1_MEMO_KEYS, paragraph: string) {
  const { agentName } = PHASE_1_MEMO_KEYS[shortName];
  return {
    status: "published" as const,
    agentName,
    agentTeam: "analyst" as const,
    phaseId: "p1",
    ticker: "NVDA",
    date: "2026-05-06",
    headline: "memo",
    body: [{ h: "Findings", p: paragraph, items: null }],
  };
}

const FUNDAMENTALS_QUOTE = "Operating margin compressed 220bps QoQ to 28.4%";

function seededMemos() {
  return {
    [PHASE_1_MEMO_KEYS.fundamentals.memoKey]: analystMemo(
      "fundamentals",
      `${FUNDAMENTALS_QUOTE}. Demand remains durable into next quarter.`,
    ),
    [PHASE_1_MEMO_KEYS.sentiment.memoKey]: analystMemo(
      "sentiment",
      "Retail sentiment is euphoric, a contrarian warning sign.",
    ),
  };
}

function contributions(entries: Array<{ round: number; agentName: string; text: string }>) {
  return { entries };
}

/** Pull `citationIntegrity` off the last session-state patch. */
function lastIntegrity(result: {
  stateChanges: Array<{ scope: string; resultingState: Record<string, unknown> }>;
}) {
  const sessionPatches = result.stateChanges.filter((c) => c.scope === "session");
  expect(sessionPatches.length).toBeGreaterThan(0);
  return (sessionPatches[sessionPatches.length - 1].resultingState as Record<string, unknown>)
    .citationIntegrity as {
    tagsChecked: number;
    tagsValid: number;
    invalidTags: Array<{ contribution: string; tag: string; attemptedQuote: string }>;
  };
}

async function run(entries: Array<{ round: number; agentName: string; text: string }>) {
  const result = await testBlock(validateCitations, {
    input: {},
    flow,
    session: {
      state: baseSessionState,
      resources: { ...seededMemos(), p2Contributions: contributions(entries) },
    },
  });
  expect(result.error).toBeNull();
  return lastIntegrity(result);
}

describe("validateCitations", () => {
  it("counts a verbatim quote from the named memo as valid", async () => {
    const integrity = await run([
      {
        round: 1,
        agentName: "bullResearcher",
        text: `Margins are stabilizing. [memo:fundamentals "${FUNDAMENTALS_QUOTE}"] supports patience.`,
      },
    ]);
    expect(integrity.tagsChecked).toBe(1);
    expect(integrity.tagsValid).toBe(1);
    expect(integrity.invalidTags).toEqual([]);
  });

  it("flags a quote that does not appear in the named memo as invalid", async () => {
    const integrity = await run([
      {
        round: 1,
        agentName: "bearResearcher",
        text: `Growth is stalling. [memo:fundamentals "Revenue fell 40% year over year"] proves it.`,
      },
    ]);
    expect(integrity.tagsChecked).toBe(1);
    expect(integrity.tagsValid).toBe(0);
    expect(integrity.invalidTags).toEqual([
      {
        contribution: "bearResearcher:1",
        tag: "fundamentals",
        attemptedQuote: "Revenue fell 40% year over year",
      },
    ]);
  });

  it("ignores tags pointing at a non-existent analyst (regex does not match)", async () => {
    const integrity = await run([
      {
        round: 1,
        agentName: "bullResearcher",
        text: `[memo:astrology "rates will fall"] and [memo:fundamentals "${FUNDAMENTALS_QUOTE}"]`,
      },
    ]);
    // Only the fundamentals tag is a valid analyst; `astrology` never matches.
    expect(integrity.tagsChecked).toBe(1);
    expect(integrity.tagsValid).toBe(1);
  });

  it("reports zero checks when there are no contributions", async () => {
    const integrity = await run([]);
    expect(integrity.tagsChecked).toBe(0);
    expect(integrity.tagsValid).toBe(0);
    expect(integrity.invalidTags).toEqual([]);
  });

  it("counts multiple tags in one contribution independently", async () => {
    const integrity = await run([
      {
        round: 2,
        agentName: "bullResearcher",
        text:
          `[memo:fundamentals "${FUNDAMENTALS_QUOTE}"] and ` +
          `[memo:sentiment "Retail sentiment is euphoric"] but ` +
          `[memo:sentiment "insiders are buying heavily"] is invented.`,
      },
    ]);
    expect(integrity.tagsChecked).toBe(3);
    expect(integrity.tagsValid).toBe(2);
    expect(integrity.invalidTags).toEqual([
      {
        contribution: "bullResearcher:2",
        tag: "sentiment",
        attemptedQuote: "insiders are buying heavily",
      },
    ]);
  });
});
