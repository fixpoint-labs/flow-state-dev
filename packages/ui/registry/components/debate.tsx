"use client";

import type {
  ComponentItem,
  ContainerItem,
  MessageItem,
  OutputItem,
  ToolOutputItem,
} from "@flow-state-dev/core/items";
import { useContainerItems } from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  CompassIcon,
  GavelIcon,
  Loader2Icon,
  MessagesSquareIcon,
  ScaleIcon,
  SearchIcon,
  TrophyIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useSessionItems } from "./session-items-context";
import { Shimmer } from "./shimmer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DebateTurn = {
  round: number;
  agentName: string;
  stance: string;
  text: string;
};

type DebateDecision = {
  round: number;
  nextSpeakers: string[];
  briefing: string | null;
  newAngle: string | null;
  done: boolean;
};

type DebateVerdict = {
  verdict: string;
  winner: string | null;
  reasoning: string;
};

/**
 * Transient signal that a debater is mid-composition. Emitted by the
 * pattern just before the debater's generator runs. Carries no text —
 * the renderer just needs to know "{agentName} is composing in round
 * N" so it can surface a live row before the committed `debate-turn`
 * lands.
 */
type DebateTurnPending = {
  round: number;
  agentName: string;
  stance: string;
};

type ToolCall = {
  name: string;
  query?: string;
  /** Summarized output — first few result titles/URLs for search, truncated text for others. */
  resultSummary?: string[];
};

type StepStatus = "complete" | "active" | "pending";

/** Converts camelCase / kebab-case tool names to Title Case for display. */
function formatToolName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract a compact ToolCall record from a ToolOutputItem. */
function toolCallFromOutput(tool: ToolOutputItem): ToolCall {
  let query: string | undefined;
  let resultSummary: string[] | undefined;
  try {
    const args = JSON.parse(tool.toolCall.arguments);
    query = typeof args.query === "string" ? args.query : undefined;
  } catch {
    /* ignore */
  }
  try {
    const out = tool.output;
    if (typeof out === "string") {
      const first = out.split("\n")[0]!.trim();
      if (first) resultSummary = [first.slice(0, 120)];
    } else if (Array.isArray(out)) {
      resultSummary = out
        .slice(0, 5)
        .map((r: any) => {
          if (typeof r === "string") return r.slice(0, 120);
          const title = r.title ?? r.name ?? r.url ?? "";
          const url = r.url ? ` — ${new URL(r.url).hostname}` : "";
          return `${title}${url}`.slice(0, 120);
        })
        .filter(Boolean);
    } else if (out && typeof out === "object") {
      const results =
        (out as any).results ?? (out as any).items ?? (out as any).data;
      if (Array.isArray(results)) {
        resultSummary = results
          .slice(0, 5)
          .map((r: any) => {
            if (typeof r === "string") return r.slice(0, 120);
            const title = r.title ?? r.name ?? r.url ?? "";
            const url = r.url ? ` — ${new URL(r.url).hostname}` : "";
            return `${title}${url}`.slice(0, 120);
          })
          .filter(Boolean);
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return { name: tool.toolCall.name, query, resultSummary };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Debate({ item }: { item: ContainerItem }) {
  const [isOpen, setIsOpen] = useState(true);
  // Track whether we've already done the auto-collapse on completion,
  // so a user who manually re-expands the card after it finishes
  // doesn't get it slammed shut again on the next render.
  const didAutoCollapseRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const allItems = useSessionItems();
  const { items: ownedItems } = useContainerItems(item, allItems);

  const requestId = (item as OutputItem & { requestId?: string }).requestId;

  // Owned items are the canonical source; the request-id fallback exists
  // for the same reason it does on `evented-actors` — ownership doesn't
  // always propagate through nested forEach dispatches.
  const scopedItems = useMemo(() => {
    const hasOwned = ownedItems.some(
      (i) =>
        i.type === "component" &&
        ((i as ComponentItem).component === "debate-turn" ||
          (i as ComponentItem).component === "debate-decision" ||
          (i as ComponentItem).component === "debate-verdict"),
    );
    if (hasOwned) return ownedItems;
    return allItems.filter(
      (i) =>
        requestId &&
        (i as OutputItem & { requestId?: string }).requestId === requestId,
    );
  }, [ownedItems, allItems, requestId]);

  const {
    turns,
    decisions,
    verdict,
    toolsByRound,
    pendingTools,
    pendingTurnsByRound,
    liveDrafts,
  } = useMemo(() => {
    const turns: DebateTurn[] = [];
    const decisions: DebateDecision[] = [];
    const pendingTurnsByRound = new Map<number, DebateTurnPending[]>();
    let verdict: DebateVerdict | null = null;
    // Live draft text per debater. The state machine:
    //   - debate-turn-pending → reset the draft for that agentName
    //   - message item with matching agentName → append text content
    //   - debate-turn (committed) → clear the draft
    // With maxConcurrency:1 only one debater speaks at a time, so the
    // map holds at most one "active" entry. Past rounds' drafts are
    // cleared as their committed turns land.
    const liveDrafts = new Map<string, string>();
    // The moderator's tool calls all stream BEFORE the moderator emits
    // its `debate-decision` item (the decision is the generator's final
    // output). Buffer moderator-owned tool_outputs in encounter order
    // and flush them onto the next decision we see. Anything still
    // pending at the end is held in `pendingTools` so we can decide,
    // outside this walk, whether to surface a live "moderator
    // researching..." row.
    //
    // Critically, debaters / judge / synthesizer in the same pattern
    // can also have tools (kitchen-sink wires `uses` on every default
    // sub-block). Filtering by `agentName` keeps the research panel
    // tied to the moderator instead of attributing every nearby tool
    // call to it.
    const toolsByRound = new Map<number, ToolCall[]>();
    let pending: ToolCall[] = [];
    for (const i of scopedItems) {
      if (i.type === "tool_output") {
        const tool = i as ToolOutputItem;
        if (tool.agentName && tool.agentName.endsWith("-moderator")) {
          pending.push(toolCallFromOutput(tool));
        }
        continue;
      }
      if (i.type === "message") {
        const m = i as MessageItem;
        if (m.agentName && liveDrafts.has(m.agentName)) {
          const text = m.content
            .filter(
              (c): c is { type: "output_text"; text: string } & {
                ephemeral?: boolean;
              } => c.type === "output_text",
            )
            .map((c) => c.text)
            .join("");
          if (text.length > 0) {
            liveDrafts.set(m.agentName, text);
          }
        }
        continue;
      }
      if (i.type !== "component") continue;
      const comp = i as ComponentItem;
      const data = comp.data as Record<string, unknown>;
      if (comp.component === "debate-turn") {
        if (
          typeof data.round === "number" &&
          typeof data.agentName === "string" &&
          typeof data.stance === "string" &&
          typeof data.text === "string"
        ) {
          turns.push({
            round: data.round,
            agentName: data.agentName,
            stance: data.stance,
            text: data.text,
          });
          // The committed turn supersedes the live draft. Clear so a
          // future round's pending-event for the same debater starts
          // from an empty draft.
          liveDrafts.delete(data.agentName);
        }
      } else if (comp.component === "debate-decision") {
        if (
          typeof data.round === "number" &&
          Array.isArray(data.nextSpeakers) &&
          typeof data.done === "boolean"
        ) {
          decisions.push({
            round: data.round,
            nextSpeakers: data.nextSpeakers.filter(
              (s): s is string => typeof s === "string",
            ),
            briefing:
              typeof data.briefing === "string" ? data.briefing : null,
            newAngle:
              typeof data.newAngle === "string" ? data.newAngle : null,
            done: data.done,
          });
          if (pending.length > 0) {
            toolsByRound.set(data.round, pending);
            pending = [];
          }
        }
      } else if (comp.component === "debate-turn-pending") {
        if (
          typeof data.round === "number" &&
          typeof data.agentName === "string" &&
          typeof data.stance === "string"
        ) {
          const arr = pendingTurnsByRound.get(data.round) ?? [];
          arr.push({
            round: data.round,
            agentName: data.agentName,
            stance: data.stance,
          });
          pendingTurnsByRound.set(data.round, arr);
          // Open a fresh draft slot for this debater. Subsequent
          // message items with matching `agentName` will accumulate
          // into it until the committed turn clears it.
          liveDrafts.set(data.agentName, "");
        }
      } else if (comp.component === "debate-verdict") {
        if (
          typeof data.verdict === "string" &&
          typeof data.reasoning === "string"
        ) {
          verdict = {
            verdict: data.verdict,
            winner: typeof data.winner === "string" ? data.winner : null,
            reasoning: data.reasoning,
          };
        }
      }
    }
    return {
      turns,
      decisions,
      verdict,
      toolsByRound,
      pendingTools: pending,
      pendingTurnsByRound,
      liveDrafts,
    };
  }, [scopedItems]);

  // Group turns, decisions, and the moderator's tool calls by round in
  // encounter order. The moderator runs at the top of each round, so the
  // decision opens the round and the turns follow. A round may appear
  // with only a decision (moderator just ran, turns haven't streamed in
  // yet) or only turns (no moderator configured) — or with pending
  // tool calls still flowing in before the decision lands.
  const rounds = useMemo(() => {
    const seen = new Set<number>();
    for (const t of turns) seen.add(t.round);
    for (const d of decisions) seen.add(d.round);
    for (const r of pendingTurnsByRound.keys()) seen.add(r);
    return [...seen]
      .sort((a, b) => a - b)
      .map((round) => {
        const committed = turns.filter((t) => t.round === round);
        const pendings = pendingTurnsByRound.get(round) ?? [];
        // With maxConcurrency:1 only one speaker runs at a time, so if
        // pendings exceed commits, the latest pending is the speaker
        // currently composing. Once their `debate-turn` lands the
        // counts match and the live row disappears.
        const inFlight =
          pendings.length > committed.length
            ? pendings[pendings.length - 1]!
            : null;
        return {
          round,
          decision: decisions.find((d) => d.round === round) ?? null,
          turns: committed,
          tools: toolsByRound.get(round) ?? [],
          inFlight,
        };
      });
  }, [turns, decisions, toolsByRound, pendingTurnsByRound]);

  // True when the moderator is mid-research with no decision yet. We
  // surface a live "researching..." row in that case. Suppressed once
  // the judge's verdict has landed, since no more moderators can run
  // — any stray tool calls past that point belong to the synthesizer
  // and aren't this pattern's to render.
  const moderatorInFlight = pendingTools.length > 0 && verdict === null;

  const isFinished = verdict !== null;

  // Once the verdict lands, collapse the card so the synthesizer's
  // user-facing response becomes the dominant element in the view, and
  // scroll the conversation so the content right after the card lands
  // at the top of the viewport. Best-effort — runs once per mount, and
  // does nothing if the next sibling hasn't rendered yet.
  useEffect(() => {
    if (!isFinished || didAutoCollapseRef.current) return;
    didAutoCollapseRef.current = true;
    setIsOpen(false);
    // Give the layout one frame to settle after the collapse, then
    // scroll past the (now-small) card so the synthesizer's reply is
    // at the top.
    const handle = requestAnimationFrame(() => {
      const next = cardRef.current?.nextElementSibling;
      if (next instanceof HTMLElement) {
        next.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [isFinished]);

  // Build the step list: each round (with optional in-flight round
  // showing the moderator's live research), then a verdict step.
  const steps = useMemo(() => {
    type DebateStep = {
      key: string;
      kind: "round" | "verdict";
      round: number;
      status: StepStatus;
      turns: DebateTurn[];
      decision: DebateDecision | null;
      tools: ToolCall[];
      inFlight: DebateTurnPending | null;
      verdict: DebateVerdict | null;
    };
    const out: DebateStep[] = [];
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i]!;
      const isLastRound = i === rounds.length - 1 && !moderatorInFlight;
      const expectedSpeakers = r.decision?.nextSpeakers.length ?? r.turns.length;
      const haveAllTurns = r.turns.length >= expectedSpeakers;
      const status: StepStatus =
        isFinished || !isLastRound
          ? "complete"
          : haveAllTurns && r.decision !== null && r.inFlight === null
            ? "complete"
            : "active";
      out.push({
        key: `round-${r.round}`,
        kind: "round",
        round: r.round,
        status,
        turns: r.turns,
        decision: r.decision,
        tools: r.tools,
        inFlight: r.inFlight,
        verdict: null,
      });
    }
    // Live "moderator researching..." step. We don't know which round
    // number it's for — the moderator hasn't committed a decision yet
    // — so we render it without a round number. Suppressed once the
    // verdict lands (no more moderators can run after that).
    if (moderatorInFlight) {
      out.push({
        key: "moderator-pending",
        kind: "round",
        round: 0,
        status: "active",
        turns: [],
        decision: null,
        tools: pendingTools,
        inFlight: null,
        verdict: null,
      });
    }
    out.push({
      key: "verdict",
      kind: "verdict",
      round: 0,
      status: isFinished
        ? "complete"
        : rounds.length > 0 &&
            !moderatorInFlight &&
            out[out.length - 1]?.status === "complete"
          ? "active"
          : "pending",
      turns: [],
      decision: null,
      tools: [],
      inFlight: null,
      verdict,
    });
    return out;
  }, [rounds, isFinished, verdict, moderatorInFlight, pendingTools]);

  const headerLabel = isFinished
    ? verdict?.winner
      ? `Verdict: ${verdict.winner}`
      : "Verdict reached"
    : rounds.length > 0
      ? `Round ${rounds[rounds.length - 1]!.round} in progress`
      : "Debate";

  return (
    <div
      ref={cardRef}
      className="not-prose my-2 rounded-md border bg-card text-card-foreground"
    >
      {/* Header — collapsible trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            !isOpen && "-rotate-90",
          )}
          aria-hidden="true"
        />
        <ScaleIcon
          className="h-4 w-4 shrink-0 text-rose-500"
          aria-hidden="true"
        />
        <span className="text-sm font-medium">Moderated Debate</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{headerLabel}</span>
          {isFinished ? (
            <CheckCircle2Icon className="h-3 w-3 text-emerald-500" />
          ) : (
            <Loader2Icon className="h-3 w-3 animate-spin" />
          )}
        </span>
      </button>

      {/* Content — timeline */}
      {isOpen && (
        <div className="border-t px-3 pb-2 pt-0">
          {rounds.length === 0 && !isFinished && (
            <div className="pt-3">
              <Step
                icon={MessagesSquareIcon}
                label=""
                status="active"
                isLast
              >
                <Shimmer className="text-xs" duration={2}>
                  Opening arguments...
                </Shimmer>
              </Step>
            </div>
          )}

          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            if (step.kind === "round") {
              const hasDecision = step.decision !== null;
              const hasTools = step.tools.length > 0;
              const hasInFlight = step.inFlight !== null;
              const childCount =
                (hasTools ? 1 : 0) +
                (hasDecision ? 1 : 0) +
                step.turns.length +
                (hasInFlight ? 1 : 0);
              let childIdx = 0;
              const renderChild = (node: React.ReactNode) => {
                const last = childIdx === childCount - 1;
                childIdx += 1;
                return (
                  <StepItem key={`child-${childIdx}`} isLast={last}>
                    {node}
                  </StepItem>
                );
              };
              return (
                <Step
                  key={step.key}
                  icon={MessagesSquareIcon}
                  label={
                    step.round === 0
                      ? "Moderator researching..."
                      : step.status === "active"
                        ? `Round ${step.round} in progress...`
                        : `Round ${step.round} — ${step.turns.length} ${step.turns.length === 1 ? "turn" : "turns"}`
                  }
                  status={step.status}
                  isLast={isLast}
                >
                  {hasTools && renderChild(<ResearchTimeline calls={step.tools} />)}
                  {hasDecision && renderChild(<DecisionItem decision={step.decision!} />)}
                  {step.turns.map((turn) =>
                    renderChild(<TurnItem turn={turn} />),
                  )}
                  {hasInFlight && renderChild(
                    <PendingTurnItem
                      pending={step.inFlight!}
                      draft={liveDrafts.get(step.inFlight!.agentName) ?? ""}
                    />,
                  )}
                </Step>
              );
            }
            // verdict step
            if (step.status === "pending") return null;
            return (
              <Step
                key={step.key}
                icon={GavelIcon}
                label={
                  step.verdict
                    ? step.verdict.winner
                      ? `Judge — ${step.verdict.winner}`
                      : "Judge — synthesis verdict"
                    : "Judge deliberating..."
                }
                status={step.status}
                isLast
              >
                {step.verdict && (
                  <StepItem isLast>
                    <VerdictItem verdict={step.verdict} />
                  </StepItem>
                )}
              </Step>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

function Step({
  icon: Icon,
  label,
  status,
  children,
}: {
  icon: typeof MessagesSquareIcon;
  label: string;
  status: StepStatus;
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="pt-3">
      <div className="flex items-center gap-1.5">
        <div className="shrink-0">
          {status === "complete" ? (
            <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
          ) : status === "active" ? (
            <Loader2Icon className="h-4 w-4 animate-spin text-blue-500" />
          ) : (
            <CircleIcon className="h-4 w-4 text-muted-foreground/30" />
          )}
        </div>
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            status === "complete"
              ? "text-foreground/70"
              : status === "active"
                ? "text-blue-500"
                : "text-muted-foreground/40",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "text-xs font-medium",
            status === "complete"
              ? "text-foreground/80"
              : status === "active"
                ? "text-blue-500"
                : "text-muted-foreground/40",
          )}
        >
          {label}
        </span>
      </div>
      {children && <div className="ml-[27px] pt-1">{children}</div>}
    </div>
  );
}

function StepItem({
  isLast,
  children,
}: {
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        <div className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        {!isLast && <div className="w-px flex-1 bg-muted-foreground/25" />}
      </div>
      <div className="min-w-0 flex-1 pb-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn / Decision / Verdict items
// ---------------------------------------------------------------------------

function TurnItem({ turn }: { turn: DebateTurn }) {
  return (
    <details className="group/turn">
      <summary className="flex cursor-pointer list-none items-start gap-1.5 text-xs leading-4">
        <UserIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground/80">
          {turn.agentName}
        </span>
        <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-[10px] leading-3 text-muted-foreground">
          {turn.stance}
        </span>
        <span className="flex-1 truncate text-muted-foreground group-open/turn:hidden">
          — {turn.text.slice(0, 80)}
          {turn.text.length > 80 ? "…" : ""}
        </span>
        <ChevronDownIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/turn:-rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1">
        <EntryMarkdown text={turn.text} />
      </div>
    </details>
  );
}

function PendingTurnItem({
  pending,
  draft,
}: {
  pending: DebateTurnPending;
  draft: string;
}) {
  // Header row mirrors the committed TurnItem so the layout doesn't
  // jump when the live draft is replaced by the final turn.
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs leading-4">
        <Loader2Icon
          className="h-3 w-3 shrink-0 animate-spin text-blue-500"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/80">
          {pending.agentName}
        </span>
        <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-[10px] leading-3 text-muted-foreground">
          {pending.stance}
        </span>
        {draft.length === 0 && (
          <Shimmer className="text-xs" duration={2}>
            is composing a response...
          </Shimmer>
        )}
      </div>
      {draft.length > 0 && <EntryMarkdown text={draft} />}
    </div>
  );
}

function DecisionItem({ decision }: { decision: DebateDecision }) {
  const speakers =
    decision.nextSpeakers.length > 0
      ? `Speakers: ${decision.nextSpeakers.join(" → ")}`
      : "No speakers this round";
  const closer = decision.done ? " (final round)" : "";
  return (
    <div className="space-y-1.5 rounded-md border border-muted-foreground/15 bg-muted/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-xs leading-4">
        <CompassIcon
          className="h-3 w-3 shrink-0 text-muted-foreground/70"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/80">
          Moderator opens round {decision.round}
          {closer}
        </span>
      </div>
      <div className="text-[11px] leading-snug text-muted-foreground">
        {speakers}
      </div>
      {decision.newAngle && (
        <div className="space-y-0.5">
          <div className="text-[11px] font-medium leading-4 text-foreground/70">
            Focus
          </div>
          <EntryMarkdown text={decision.newAngle} />
        </div>
      )}
      {decision.briefing && (
        <CollapsibleMarkdown label="Briefing" text={decision.briefing} />
      )}
    </div>
  );
}

/**
 * Markdown body that renders short by default and expands on click.
 * The collapsed form fades out a 1-line preview; clicking it reveals
 * the full markdown.
 */
function CollapsibleMarkdown({ label, text }: { label: string; text: string }) {
  // Strip markdown syntax to a leading plain-text fragment for the
  // preview line. We only need enough to hint at the contents — the
  // reader expands to see the rest.
  const preview = text
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return (
    <details className="group/briefing">
      <summary className="flex cursor-pointer list-none items-start gap-1 text-[11px] leading-snug">
        <span className="shrink-0 font-medium text-foreground/70">
          {label}:
        </span>
        <span className="flex-1 truncate text-muted-foreground group-open/briefing:hidden">
          {preview}
          {text.length > preview.length ? "…" : ""}
        </span>
        <ChevronDownIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/briefing:-rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1">
        <EntryMarkdown text={text} />
      </div>
    </details>
  );
}

/**
 * Compact research timeline showing tool calls the moderator made when
 * opening a round. Grouped by tool name; each group is collapsible.
 */
function ResearchTimeline({ calls }: { calls: ToolCall[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, ToolCall[]>();
    for (const c of calls) {
      const arr = map.get(c.name) ?? [];
      arr.push(c);
      map.set(c.name, arr);
    }
    return [...map.entries()].map(([name, group]) => ({
      name,
      displayName: formatToolName(name),
      calls: group,
    }));
  }, [calls]);
  return (
    <div className="space-y-1 rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-xs leading-4">
        <WrenchIcon
          className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/80">
          Moderator research — {calls.length} {calls.length === 1 ? "call" : "calls"}
        </span>
      </div>
      <div className="space-y-1">
        {groups.map((g) => {
          const Icon = g.name === "search" ? SearchIcon : WrenchIcon;
          return (
            <details key={g.name} className="group/tool">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] leading-4">
                <Icon
                  className="h-3 w-3 shrink-0 text-muted-foreground/70"
                  aria-hidden="true"
                />
                <span className="font-medium text-foreground/80">
                  {g.displayName}
                </span>
                <span className="text-muted-foreground">
                  — {g.calls.length} {g.calls.length === 1 ? "call" : "calls"}
                </span>
                <ChevronDownIcon
                  className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/tool:-rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-1 space-y-1 pl-4">
                {g.calls.map((c, i) => (
                  <ResearchCallItem key={i} call={c} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function ResearchCallItem({ call }: { call: ToolCall }) {
  const label = call.query ?? call.name;
  const hasResults = call.resultSummary && call.resultSummary.length > 0;
  if (!hasResults) {
    return (
      <div className="text-[11px] leading-snug text-muted-foreground">
        {label}
      </div>
    );
  }
  return (
    <details className="group/call">
      <summary className="flex cursor-pointer list-none items-start gap-1 text-[11px] leading-snug">
        <span className="shrink-0 font-medium text-foreground/70">{label}</span>
        <span className="flex-1 truncate text-muted-foreground">
          — {call.resultSummary!.length}{" "}
          {call.resultSummary!.length === 1 ? "result" : "results"}
        </span>
        <ChevronDownIcon
          className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/call:-rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-0.5 pl-1">
        {call.resultSummary!.map((r, j) => (
          <div
            key={j}
            className="truncate text-[10px] text-muted-foreground/70"
          >
            {r}
          </div>
        ))}
      </div>
    </details>
  );
}

function VerdictItem({ verdict }: { verdict: DebateVerdict }) {
  return (
    <div className="space-y-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-2">
      <div className="flex items-center gap-1.5 text-xs leading-4">
        <TrophyIcon
          className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/90">
          {verdict.winner ?? "Synthesis"}
        </span>
      </div>
      <div className="text-xs leading-snug text-foreground/90">
        {verdict.verdict}
      </div>
      <details className="group/why">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] leading-4 text-muted-foreground">
          <span>Reasoning</span>
          <ChevronDownIcon
            className="h-3 w-3 shrink-0 transition-transform group-open/why:-rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-1">
          <EntryMarkdown text={verdict.reasoning} />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const headingComponent = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold">{children}</p>
);

function EntryMarkdown({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "prose-none text-xs leading-snug text-muted-foreground",
        "[&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[10px]",
        "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:italic",
      )}
    >
      <Markdown
        components={{
          h1: headingComponent,
          h2: headingComponent,
          h3: headingComponent,
          h4: headingComponent,
          h5: headingComponent,
          h6: headingComponent,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
