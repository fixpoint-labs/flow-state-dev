"use client";

import type { ComponentItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  InfoIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Annotation = {
  type: string;
  label: string;
  severity: "info" | "warning" | "critical";
  description: string;
  evidence?: string;
};

type AnalyzerResult = {
  analyzerId: string;
  category: string;
  score: number;
  shouldSurface: boolean;
  annotations: Annotation[];
  supplementary?: Record<string, unknown>;
};

type AuditAnnotationData = {
  results: AnalyzerResult[];
  surfacedResults: AnalyzerResult[];
  overallScore: number;
};

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_ICON = {
  info: InfoIcon,
  warning: AlertTriangleIcon,
  critical: XCircleIcon,
} as const;

const SEVERITY_COLOR = {
  info: "text-blue-500",
  warning: "text-amber-500",
  critical: "text-red-500",
} as const;

const SEVERITY_BG = {
  info: "bg-blue-500/10 border-blue-500/20",
  warning: "bg-amber-500/10 border-amber-500/20",
  critical: "bg-red-500/10 border-red-500/20",
} as const;

const SEVERITY_BORDER = {
  info: "border-blue-500/40",
  warning: "border-amber-500/40",
  critical: "border-red-500/40",
} as const;

function highestSeverity(results: AnalyzerResult[]): "info" | "warning" | "critical" {
  let highest: "info" | "warning" | "critical" = "info";
  for (const r of results) {
    for (const a of r.annotations) {
      if (a.severity === "critical") return "critical";
      if (a.severity === "warning") highest = "warning";
    }
  }
  return highest;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders response auditor results as a compact annotation card.
 *
 * Shows surfaced analyzer findings with severity indicators, individual
 * annotation details, and optional supplementary data (counter-arguments,
 * sycophancy scores, etc.).
 */
export function AuditAnnotation({ item }: { item: ComponentItem }) {
  const data = item.data as AuditAnnotationData;

  if (!data?.surfacedResults || data.surfacedResults.length === 0) {
    return null;
  }

  const severity = highestSeverity(data.surfacedResults);
  const Icon = SEVERITY_ICON[severity];
  const totalAnnotations = data.surfacedResults.reduce(
    (sum, r) => sum + r.annotations.length,
    0,
  );

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ShieldAlertIcon
            className={cn("h-3.5 w-3.5", SEVERITY_COLOR[severity])}
            aria-hidden="true"
          />
          <p className="text-sm font-medium leading-snug">Response Audit</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            SEVERITY_BG[severity],
          )}
        >
          {totalAnnotations} finding{totalAnnotations !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Analyzer results */}
      <ul className="space-y-2">
        {data.surfacedResults.map((result) => (
          <AnalyzerSection key={result.analyzerId} result={result} />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AnalyzerSection({ result }: { result: AnalyzerResult }) {
  const scorePercent = Math.round(result.score * 100);
  const supplementary = result.supplementary as
    | {
        summary?: string;
        counterArguments?: Array<{
          claim: string;
          counterpoint: string;
          strength: number;
        }>;
      }
    | undefined;

  return (
    <li className="space-y-1.5">
      {/* Analyzer header with score */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {result.analyzerId}
        </span>
        <ScoreGauge score={result.score} label={`${scorePercent}%`} />
      </div>

      {/* Summary from supplementary data */}
      {supplementary?.summary && (
        <p className="text-xs text-muted-foreground">
          {supplementary.summary}
        </p>
      )}

      {/* Annotations */}
      {result.annotations.length > 0 && (
        <ul className="space-y-1">
          {result.annotations.map((annotation, i) => (
            <AnnotationItem
              key={`${annotation.type}-${i}`}
              annotation={annotation}
            />
          ))}
        </ul>
      )}

      {/* Counter-arguments */}
      {supplementary?.counterArguments &&
        supplementary.counterArguments.length > 0 && (
          <details className="group mt-1">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <ChevronRightIcon
                className="h-2.5 w-2.5 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              {supplementary.counterArguments.length} counter-argument
              {supplementary.counterArguments.length !== 1 ? "s" : ""}
            </summary>
            <ul className="mt-1 space-y-1 pl-3">
              {supplementary.counterArguments.map((ca, i) => (
                <li
                  key={i}
                  className="border-l-2 border-muted-foreground/20 pl-2 text-xs"
                >
                  <p className="font-medium text-muted-foreground">
                    {ca.claim}
                  </p>
                  <p className="text-muted-foreground/80">{ca.counterpoint}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
    </li>
  );
}

function AnnotationItem({ annotation }: { annotation: Annotation }) {
  const Icon = SEVERITY_ICON[annotation.severity];

  return (
    <li
      className={cn(
        "rounded border-l-2 px-2 py-1.5",
        SEVERITY_BORDER[annotation.severity],
      )}
    >
      <div className="flex items-start gap-1.5">
        <Icon
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0",
            SEVERITY_COLOR[annotation.severity],
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium">{annotation.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {annotation.description}
          </p>
          {annotation.evidence && (
            <p className="mt-0.5 text-[10px] italic text-muted-foreground/70">
              &ldquo;{annotation.evidence}&rdquo;
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const severity: "info" | "warning" | "critical" =
    score < 0.3 ? "info" : score < 0.7 ? "warning" : "critical";
  const widthPercent = Math.max(4, Math.round(score * 100));

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            severity === "info" && "bg-blue-500",
            severity === "warning" && "bg-amber-500",
            severity === "critical" && "bg-red-500",
          )}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
