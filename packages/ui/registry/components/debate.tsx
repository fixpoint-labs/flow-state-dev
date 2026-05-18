"use client";

import type {
  ComponentItem,
  ContainerItem,
  OutputItem,
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
  TrophyIcon,
  UserIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
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

type StepStatus = "complete" | "active" | "pending";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Debate({ item }: { item: ContainerItem }) {
  const [isOpen, setIsOpen] = useState(true);
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

  const { turns, decisions, verdict } = useMemo(() => {
    const turns: DebateTurn[] = [];
    const decisions: DebateDecision[] = [];
    let verdict: DebateVerdict | null = null;
    for (const i of scopedItems) {
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
        }
      } else if (comp.component === "debate-verdict") {
        if (
          typeof data.verdict === "string" &&
          typeof data.reasoning === "string"
        ) {
          verdict = {
            verdict: data.verdict,
            winner:
              typeof data.winner === "string" ? data.winner : null,
            reasoning: data.reasoning,
          };
        }
      }
    }
    return { turns, decisions, verdict };
  }, [scopedItems]);

  // Group turns and decisions by round in encounter order. The moderator
  // runs at the top of each round, so the decision opens the round and
  // the turns follow. A round may appear with only a decision (moderator
  // just ran, turns haven't streamed in yet) or only turns (no moderator
  // configured).
  const rounds = useMemo(() => {
    const seen = new Set<number>();
    for (const t of turns) seen.add(t.round);
    for (const d of decisions) seen.add(d.round);
    return [...seen]
      .sort((a, b) => a - b)
      .map((round) => ({
        round,
        decision: decisions.find((d) => d.round === round) ?? null,
        turns: turns.filter((t) => t.round === round),
      }));
  }, [turns, decisions]);

  const isFinished = verdict !== null;

  // Build the step list: each round, then a verdict step. A round is
  // "complete" once it has a decision AND every named speaker has emitted
  // a turn. The last round is "active" while its turns are streaming in.
  const steps = useMemo(() => {
    type DebateStep = {
      key: string;
      kind: "round" | "verdict";
      round: number;
      status: StepStatus;
      turns: DebateTurn[];
      decision: DebateDecision | null;
      verdict: DebateVerdict | null;
    };
    const out: DebateStep[] = [];
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i]!;
      const isLastRound = i === rounds.length - 1;
      const expectedSpeakers = r.decision?.nextSpeakers.length ?? r.turns.length;
      const haveAllTurns = r.turns.length >= expectedSpeakers;
      const status: StepStatus =
        isFinished || !isLastRound
          ? "complete"
          : haveAllTurns && r.decision !== null
            ? "complete"
            : "active";
      out.push({
        key: `round-${r.round}`,
        kind: "round",
        round: r.round,
        status,
        turns: r.turns,
        decision: r.decision,
        verdict: null,
      });
    }
    out.push({
      key: "verdict",
      kind: "verdict",
      round: 0,
      // Verdict step is shown as active once the last round's debaters
      // have all spoken (judge is presumably running). It's pending
      // before that and complete once the verdict emits.
      status: isFinished
        ? "complete"
        : rounds.length > 0 &&
            out[out.length - 1]?.status === "complete"
          ? "active"
          : "pending",
      turns: [],
      decision: null,
      verdict,
    });
    return out;
  }, [rounds, isFinished, verdict]);

  const headerLabel = isFinished
    ? verdict?.winner
      ? `Verdict: ${verdict.winner}`
      : "Verdict reached"
    : rounds.length > 0
      ? `Round ${rounds[rounds.length - 1]!.round} in progress`
      : "Debate";

  return (
    <div className="not-prose my-2 rounded-md border bg-card text-card-foreground">
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
              return (
                <Step
                  key={step.key}
                  icon={MessagesSquareIcon}
                  label={
                    step.status === "active"
                      ? `Round ${step.round} in progress...`
                      : `Round ${step.round} — ${step.turns.length} ${step.turns.length === 1 ? "turn" : "turns"}`
                  }
                  status={step.status}
                  isLast={isLast}
                >
                  {hasDecision && (
                    <StepItem isLast={step.turns.length === 0}>
                      <DecisionItem decision={step.decision!} />
                    </StepItem>
                  )}
                  {step.turns.map((turn, j) => (
                    <StepItem
                      key={`turn-${j}`}
                      isLast={j === step.turns.length - 1}
                    >
                      <TurnItem turn={turn} />
                    </StepItem>
                  ))}
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
      {decision.briefing && (
        <div className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground/70">Briefing:</span>{" "}
          {decision.briefing}
        </div>
      )}
      {decision.newAngle && (
        <div className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground/70">Focus:</span>{" "}
          {decision.newAngle}
        </div>
      )}
    </div>
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
