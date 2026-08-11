/**
 * Unit tests for the transcript row projection (FIX-1062).
 *
 * `buildTranscriptRows` is pure, and it is the contract behind a real-money UI
 * promise: the memo header's "jump to transcript" control exists ONLY when the
 * jump will land. These tests encode that intent, not just the mapping:
 *
 *   - an agent's anchor is its FIRST rendered row, so a jump lands on the
 *     originating event rather than wherever the agent last spoke.
 *   - an agent with no RENDERED row is absent from `agentsWithTranscriptRows`
 *     even when it emitted items — a suppressed Phase 1 thesis-card, an empty
 *     completed message. That absence is what removes the dead control.
 *   - a re-opened historical report with no persisted items offers no jump at
 *     all, instead of a button that silently does nothing (the pre-FIX-1062
 *     bug: a live-looking control on ~15 memos per report).
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import {
  agentsWithTranscriptRows,
  buildTranscriptRows,
} from "../components/transcript/transcript-rows";

let seq = 0;

/** Build an item with the structural base fields the renderer ignores. */
function item<T extends Record<string, unknown>>(fields: T): OutputItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    status: "completed",
    requestId: "req-1",
    itemIndex: seq,
    provenance: { phase: "main" },
    ts: seq,
    ...fields,
  } as unknown as OutputItem;
}

function toolRow(agentName: string, toolName: string): OutputItem {
  return item({
    type: "tool_output",
    agentName,
    blockName: toolName,
    toolCall: { name: toolName, arguments: '{"ticker":"NVDA"}' },
    output: { source: "fixture" },
  });
}

function speakRow(agentName: string, text: string): OutputItem {
  return item({
    type: "message",
    role: "assistant",
    agentName,
    content: [{ type: "output_text", text }],
  });
}

describe("buildTranscriptRows", () => {
  it("anchors an agent on its FIRST row, not a later one", () => {
    const rows = buildTranscriptRows([
      toolRow("fundamentalsAnalyst", "get_fundamentals"),
      toolRow("fundamentalsAnalyst", "get_income_statement"),
      speakRow("fundamentalsAnalyst", "Margins are expanding."),
    ]);

    const anchors = rows.filter((r) => r.isAgentAnchor);
    expect(anchors).toHaveLength(1);
    // The jump must land at the top of the agent's stretch of transcript.
    expect(anchors[0]?.key).toBe(rows[0]?.key);
    expect(anchors[0]?.agent).toBe("fundamentalsAnalyst");
  });

  it("anchors each agent independently", () => {
    const rows = buildTranscriptRows([
      toolRow("macroAnalyst", "get_macro_indicators"),
      toolRow("quantAnalyst", "get_options_chain"),
      speakRow("macroAnalyst", "Conditions are loosening."),
    ]);

    expect(rows.filter((r) => r.isAgentAnchor).map((r) => r.agent)).toEqual([
      "macroAnalyst",
      "quantAnalyst",
    ]);
  });

  it("gives phase dividers no agent and no anchor", () => {
    const rows = buildTranscriptRows([
      item({
        type: "container",
        component: "analyst-phase",
        label: "Phase 1 · analyst fan-out",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("phase");
    expect(rows[0]?.agent).toBeNull();
    expect(rows[0]?.isAgentAnchor).toBe(false);
  });

  it("keeps the transcript's own suppression rules", () => {
    const rows = buildTranscriptRows([
      // Phase 1 structured output is suppressed — it surfaces in the right pane.
      item({
        type: "component",
        component: "thesis-card",
        agentName: "fundamentalsAnalyst",
        data: {},
      }),
      // Phase 2+ structured output renders.
      item({
        type: "component",
        component: "thesis-card",
        agentName: "researchManager",
        data: {},
      }),
      // Transient items are live-only and never rendered.
      item({ ...speakRow("trader", "thinking"), transient: true }),
      // A non-assistant message is not a speak row.
      item({
        type: "message",
        role: "user",
        agentName: "trader",
        content: [{ type: "output_text", text: "hi" }],
      }),
    ]);

    expect(rows.map((r) => r.agent)).toEqual(["researchManager"]);
  });

  it("drops a completed message with no text", () => {
    const rows = buildTranscriptRows([speakRow("trader", "")]);
    expect(rows).toHaveLength(0);
  });

  it("keeps an in-progress message with no text yet (the streaming caret)", () => {
    const rows = buildTranscriptRows([
      item({
        type: "message",
        role: "assistant",
        status: "in_progress",
        agentName: "trader",
        content: [],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isAgentAnchor).toBe(true);
  });

  it("does not anchor an unregistered agent name", () => {
    const rows = buildTranscriptRows([toolRow("someRetiredAgent", "get_x")]);
    // The row still renders (the badge gets the raw name, as before), but it is
    // not a jump target — no memo can address it.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBeNull();
    expect(rows[0]?.isAgentAnchor).toBe(false);
  });
});

describe("agentsWithTranscriptRows", () => {
  it("reports exactly the agents a memo header can jump to", () => {
    const agents = agentsWithTranscriptRows([
      toolRow("macroAnalyst", "get_macro_indicators"),
      speakRow("trader", "Sizing at 2% of NAV."),
      // Emitted but never rendered → not jumpable.
      item({
        type: "component",
        component: "thesis-card",
        agentName: "quantAnalyst",
        data: {},
      }),
      speakRow("newsAnalyst", ""),
    ]);

    expect([...agents].sort()).toEqual(["macroAnalyst", "trader"]);
  });

  it("offers no jump target for a report with no persisted transcript items", () => {
    // A re-opened historical report: memos rehydrate from the resource, but the
    // transcript items were emitted with `history: false` and are gone. Every
    // memo header must therefore render WITHOUT the control.
    expect(agentsWithTranscriptRows([]).size).toBe(0);
  });
});
