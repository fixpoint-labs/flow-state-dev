/**
 * transcript-rows — the pure session-item → transcript-row projection.
 *
 * This is the SINGLE source of truth for which items become transcript rows
 * and which agent each row belongs to. Two consumers read it and must agree:
 *
 *   - `TranscriptPane` renders the rows.
 *   - `ThesesPane` asks whether a memo's agent has a row at all, because the
 *     memo header's "jump to transcript" control is rendered only when there
 *     is an event to jump to (FIX-1062). Deriving both from one walk is what
 *     keeps that control from ever being a clickable no-op — a re-opened
 *     historical report whose items were never persisted simply has no rows,
 *     so the affordance is absent rather than dead.
 *
 * The FIRST row an agent produces is its anchor: the originating event a jump
 * lands on. Later rows from the same agent are not anchors, so a jump always
 * lands at the top of that agent's stretch of transcript, not its tail.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { AGENTS, type AgentName } from "@/flows/analysis/registry";
import type { TxToolProps } from "./tx-tool";
import type { TxSpeakProps } from "./tx-speak";
import type { TxStructProps } from "./tx-struct";

/** Agents whose structured `thesis-card` component renders in the transcript. */
const PRIMARY_STRUCT_AGENTS = new Set<string>([
  "researchManager",
  "trader",
  "portfolioManager",
  "thesisValidator",
]);

/** Phase 1 analyst structured outputs are suppressed from the transcript by
 *  design — they surface only in the right pane. */
const PHASE_1_ANALYST_AGENTS = new Set<string>([
  "fundamentalsAnalyst",
  "sentimentAnalyst",
  "newsAnalyst",
  "technicalAnalyst",
  "companyProfileAnalyst",
  "marketAnalyst",
  "macroAnalyst",
  "quantAnalyst",
]);

type RowBase = {
  /** React key for the row. */
  key: string;
  /** The registered agent this row belongs to, or null for agent-less rows
   *  (phase dividers) and rows emitted by an unregistered agent name. */
  agent: AgentName | null;
  /** True on the first row this agent produced — the jump-to-transcript target. */
  isAgentAnchor: boolean;
};

export type TranscriptRow =
  | (RowBase & { kind: "phase"; label: string })
  | (RowBase & { kind: "tool"; props: TxToolProps })
  | (RowBase & { kind: "speak"; props: TxSpeakProps })
  | (RowBase & { kind: "struct"; props: TxStructProps });

/** The `data-*` attribute the transcript pane stamps on each agent's anchor
 *  row, and the jump effect queries for. */
export const TX_AGENT_ANCHOR_ATTR = "data-tx-agent";

/** Project session items into transcript rows, in order. Pure. */
export function buildTranscriptRows(
  items: readonly OutputItem[],
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const anchored = new Set<AgentName>();

  /** Claim the anchor for `agent` if it has not produced a row yet. */
  const claimAnchor = (agent: AgentName | null): boolean => {
    if (agent === null || anchored.has(agent)) return false;
    anchored.add(agent);
    return true;
  };

  for (const item of items) {
    if (item.transient === true) continue;

    if (item.type === "container") {
      const container = item as Extract<OutputItem, { type: "container" }>;
      // Phase-divider containers: P1 ships `analyst-phase`; P2+ ship
      // `phase-2-debate`, `phase-3-trader`, etc. Match either shape.
      const isPhaseDivider =
        typeof container.component === "string" &&
        (container.component === "analyst-phase" ||
          container.component.startsWith("phase-"));
      if (isPhaseDivider && container.label !== undefined) {
        rows.push({
          kind: "phase",
          key: `phase-${container.id}`,
          agent: null,
          isAgentAnchor: false,
          label: container.label,
        });
      }
      continue;
    }

    if (item.type === "tool_output") {
      const tool = item as Extract<OutputItem, { type: "tool_output" }>;
      const argsPreview = oneLine(tool.toolCall?.arguments ?? "") || "(no args)";
      const output = tool.output as Record<string, unknown> | undefined;
      const source =
        output !== undefined && typeof output.source === "string"
          ? output.source
          : undefined;
      const bytes =
        output !== undefined ? JSON.stringify(output).length : undefined;
      const agent = registeredAgent(tool.agentName);
      rows.push({
        kind: "tool",
        key: tool.id,
        agent,
        isAgentAnchor: claimAnchor(agent),
        props: {
          // Faithful to the pre-FIX-1062 render: the badge receives the raw
          // emitted name. Only the anchor axis is registry-validated.
          agent: tool.agentName as AgentName | undefined,
          toolName: tool.toolCall?.name ?? tool.blockName,
          argsPreview,
          status: tool.status,
          source,
          output,
          bytes,
          errorMessage: tool.error?.message,
        },
      });
      continue;
    }

    if (item.type === "message") {
      const message = item as Extract<OutputItem, { type: "message" }>;
      if (message.role !== "assistant") continue;
      const agent = registeredAgent(message.agentName);
      if (agent === null) continue;
      const text = message.content
        .filter((c) => c.type === "output_text")
        .map((c) => (c as { text: string }).text)
        .join("");
      if (text.length === 0 && message.status !== "in_progress") continue;
      rows.push({
        kind: "speak",
        key: message.id,
        agent,
        isAgentAnchor: claimAnchor(agent),
        props: {
          agent,
          text,
          isStreaming: message.status === "in_progress",
        },
      });
      continue;
    }

    if (item.type === "component") {
      const cmp = item as Extract<OutputItem, { type: "component" }>;
      if (cmp.component !== "thesis-card") continue;
      const agentName = cmp.agentName;
      if (agentName === undefined || PHASE_1_ANALYST_AGENTS.has(agentName)) {
        continue;
      }
      if (!PRIMARY_STRUCT_AGENTS.has(agentName)) continue;
      const agent = registeredAgent(agentName);
      rows.push({
        kind: "struct",
        key: cmp.id,
        agent,
        isAgentAnchor: claimAnchor(agent),
        props: {
          label: (agent !== null ? AGENTS[agent]?.role : undefined) ?? agentName,
          data: cmp.data,
        },
      });
      continue;
    }
  }

  return rows;
}

/** The agents that have at least one transcript row — i.e. the memos whose
 *  "jump to transcript" control has a target. */
export function agentsWithTranscriptRows(
  items: readonly OutputItem[],
): ReadonlySet<AgentName> {
  const agents = new Set<AgentName>();
  for (const row of buildTranscriptRows(items)) {
    if (row.isAgentAnchor && row.agent !== null) agents.add(row.agent);
  }
  return agents;
}

/** Narrow a free-form emitted agent name to a registered `AgentName`. */
function registeredAgent(name: string | undefined): AgentName | null {
  if (name === undefined) return null;
  return AGENTS[name as AgentName] !== undefined ? (name as AgentName) : null;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}
