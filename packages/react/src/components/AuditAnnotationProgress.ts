/**
 * Kitchen-sink visualization component for the Response Auditor pattern.
 *
 * Shows live analyzer execution status, score gauges, annotation list with
 * severity color-coding, and an interactive threshold slider.
 */
import { createElement, useState, type ReactNode } from "react";
import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import { resolveBlockValue } from "@flow-state-dev/core/items";

function resolveValue(value: BlockOutputItem["output"] | undefined, items: readonly OutputItem[]): unknown {
  return resolveBlockValue(value as never, (id) => items.find((i) => i.id === id));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditAnnotationProgressProps {
  /** Stream items from the request (e.g., from useSession or useRequestStream). */
  items: OutputItem[];
  /** Initial threshold value for the interactive slider. */
  initialThreshold?: number;
}

interface AnalyzerStatus {
  analyzerId: string;
  category: string;
  score: number;
  shouldSurface: boolean;
  annotations: Array<{
    type: string;
    label: string;
    severity: "info" | "warning" | "critical";
    description: string;
    evidence?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_COLOR: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  critical: "#ef4444",
};

function scoreColor(score: number): string {
  if (score >= 0.7) return "#ef4444";
  if (score >= 0.4) return "#f59e0b";
  return "#22c55e";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function extractAnalyzerResults(items: OutputItem[]): AnalyzerStatus[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as OutputItem | BlockOutputItem;
    if (
      (item as { type: string }).type === "block_output" &&
      (item as BlockOutputItem).blockName === "aggregate-results" &&
      "output" in item
    ) {
      // Resolve BlockValue union to its typed payload (FIX-413).
      const output = resolveValue(
        (item as BlockOutputItem).output,
        items,
      ) as { results?: AnalyzerStatus[] } | undefined;
      return output?.results ?? [];
    }
  }
  return [];
}

function extractOverallScore(items: OutputItem[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as OutputItem | BlockOutputItem;
    if (
      (item as { type: string }).type === "block_output" &&
      (item as BlockOutputItem).blockName === "aggregate-results" &&
      "output" in item
    ) {
      const output = resolveValue(
        (item as BlockOutputItem).output,
        items,
      ) as { overallScore?: number } | undefined;
      return output?.overallScore ?? null;
    }
  }
  return null;
}

/**
 * Renders a detailed progress view of the Response Auditor pattern.
 * Shows analyzer execution status, score gauges, annotations, and a
 * threshold slider for interactive filtering.
 */
export function AuditAnnotationProgress({
  items,
  initialThreshold = 0.3,
}: AuditAnnotationProgressProps): ReactNode {
  const [threshold, setThreshold] = useState(initialThreshold);

  const results = extractAnalyzerResults(items);
  const overallScore = extractOverallScore(items);
  const isRunning = results.length === 0 && items.length > 0;

  // Check for in-progress status items from the auditor
  const auditorStatuses = items.filter(
    (item) =>
      item.type === "status" &&
      "blockName" in item &&
      typeof (item as Record<string, unknown>).blockName === "string" &&
      ((item as Record<string, unknown>).blockName as string).includes(
        "auditor",
      ),
  );

  const filteredResults = results.filter(
    (r) => r.shouldSurface || r.score >= threshold,
  );

  return createElement(
    "div",
    {
      style: {
        padding: "16px",
        borderRadius: "8px",
        border: "1px solid #e5e7eb",
        backgroundColor: "#fafafa",
        fontFamily: "system-ui, sans-serif",
      },
    },
    // Header
    createElement(
      "div",
      {
        style: {
          fontWeight: 600,
          fontSize: "14px",
          marginBottom: "12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        },
      },
      "Response Audit",
      overallScore != null
        ? createElement(
            "span",
            {
              style: {
                fontSize: "12px",
                padding: "2px 8px",
                borderRadius: "10px",
                backgroundColor: `${scoreColor(overallScore)}15`,
                color: scoreColor(overallScore),
              },
            },
            `Score: ${(overallScore * 100).toFixed(0)}%`,
          )
        : null,
      isRunning
        ? createElement(
            "span",
            {
              style: {
                fontSize: "12px",
                color: "#9ca3af",
                fontWeight: 400,
              },
            },
            "Analyzing...",
          )
        : null,
    ),
    // Analyzer status list
    results.length > 0
      ? createElement(
          "div",
          { style: { marginBottom: "12px" } },
          ...results.map((result) =>
            createElement(
              "div",
              {
                key: result.analyzerId,
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 0",
                  borderBottom: "1px solid #f3f4f6",
                },
              },
              // Status indicator
              createElement("span", {
                style: {
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#22c55e",
                  flexShrink: 0,
                },
              }),
              // Analyzer name + category
              createElement(
                "span",
                { style: { fontSize: "13px", flex: 1 } },
                `${result.analyzerId} `,
                createElement(
                  "span",
                  { style: { color: "#9ca3af", fontSize: "11px" } },
                  `(${result.category})`,
                ),
              ),
              // Score gauge
              createElement(
                "div",
                {
                  style: {
                    width: "60px",
                    height: "6px",
                    borderRadius: "3px",
                    backgroundColor: "#e5e7eb",
                    overflow: "hidden",
                  },
                },
                createElement("div", {
                  style: {
                    width: `${result.score * 100}%`,
                    height: "100%",
                    borderRadius: "3px",
                    backgroundColor: scoreColor(result.score),
                    transition: "width 0.3s ease",
                  },
                }),
              ),
              createElement(
                "span",
                {
                  style: {
                    fontSize: "12px",
                    fontWeight: 500,
                    color: scoreColor(result.score),
                    minWidth: "32px",
                    textAlign: "right",
                  },
                },
                `${(result.score * 100).toFixed(0)}%`,
              ),
            ),
          ),
        )
      : auditorStatuses.length > 0
        ? createElement(
            "div",
            { style: { fontSize: "12px", color: "#9ca3af", padding: "8px 0" } },
            "Running analyzers...",
          )
        : null,
    // Threshold slider
    createElement(
      "div",
      {
        style: {
          marginBottom: "12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "12px",
          color: "#6b7280",
        },
      },
      "Threshold:",
      createElement("input", {
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        value: threshold,
        onChange: (e: { target: { value: string } }) =>
          setThreshold(Number(e.target.value)),
        style: { flex: 1, accentColor: "#6366f1" },
      }),
      createElement(
        "span",
        { style: { minWidth: "32px", textAlign: "right" } },
        `${(threshold * 100).toFixed(0)}%`,
      ),
    ),
    // Annotation list
    filteredResults.length > 0
      ? createElement(
          "div",
          null,
          createElement(
            "div",
            {
              style: {
                fontSize: "12px",
                fontWeight: 500,
                color: "#6b7280",
                marginBottom: "6px",
              },
            },
            `${filteredResults.reduce((s, r) => s + r.annotations.length, 0)} annotations above threshold`,
          ),
          ...filteredResults.flatMap((result) =>
            result.annotations.map((annotation, i) =>
              createElement(
                "div",
                {
                  key: `${result.analyzerId}-${i}`,
                  style: {
                    padding: "6px 10px",
                    marginBottom: "4px",
                    borderLeft: `3px solid ${SEVERITY_COLOR[annotation.severity]}`,
                    backgroundColor: "#fff",
                    borderRadius: "4px",
                    fontSize: "12px",
                  },
                },
                createElement(
                  "div",
                  {
                    style: {
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    },
                  },
                  createElement(
                    "span",
                    { style: { fontWeight: 500 } },
                    annotation.label,
                  ),
                  createElement(
                    "span",
                    {
                      style: {
                        fontSize: "10px",
                        padding: "1px 6px",
                        borderRadius: "8px",
                        backgroundColor: `${SEVERITY_COLOR[annotation.severity]}15`,
                        color: SEVERITY_COLOR[annotation.severity],
                        textTransform: "uppercase",
                      },
                    },
                    annotation.severity,
                  ),
                ),
                createElement(
                  "div",
                  { style: { color: "#6b7280", marginTop: "2px" } },
                  annotation.description,
                ),
                annotation.evidence
                  ? createElement(
                      "div",
                      {
                        style: {
                          color: "#9ca3af",
                          marginTop: "2px",
                          fontStyle: "italic",
                          fontSize: "11px",
                        },
                      },
                      `"${annotation.evidence}"`,
                    )
                  : null,
              ),
            ),
          ),
        )
      : results.length > 0
        ? createElement(
            "div",
            { style: { fontSize: "12px", color: "#9ca3af" } },
            "No annotations above the current threshold.",
          )
        : null,
  );
}
