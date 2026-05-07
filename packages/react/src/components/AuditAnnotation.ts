/**
 * Generic annotation renderer for the Response Auditor pattern.
 *
 * Renders aggregated audit results in one of two modes:
 *
 * - **Inline** (default): A collapsible bar below the AI message. Collapsed
 *   by default, shows a summary icon + short label. Expands to show the full
 *   annotation list with severity indicators.
 *
 * - **Message**: Renders as a separate block with distinct visual treatment.
 *   Useful when annotations are substantial enough to warrant their own section.
 *
 * Renders nothing when no results exceed the configured threshold — no empty
 * state, no "all clear" message.
 */
import { createElement, useState, type ReactNode } from "react";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import { resolveBlockValueLocal } from "../internal/block-value-resolver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditAnnotationData {
  results: Array<{
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
    supplementary?: Record<string, unknown>;
  }>;
  surfacedResults: Array<{
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
    supplementary?: Record<string, unknown>;
  }>;
  overallScore: number;
}

export interface AuditAnnotationProps {
  /** Stream items from the request. */
  items: OutputItem[];
  /** Display mode: 'inline' (collapsible bar) or 'message' (separate block). */
  displayMode?: "inline" | "message";
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_ICON: Record<string, string> = {
  info: "\u2139\uFE0F",
  warning: "\u26A0\uFE0F",
  critical: "\u274C",
};

const SEVERITY_COLOR: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  critical: "#ef4444",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function extractAuditData(items: OutputItem[]): AuditAnnotationData | null {
  // Find the most recent block_output from apply-threshold. `block_output`
  // arrives via the trace channel, so it isn't part of the public OutputItem
  // union — narrow via runtime check + cast.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as OutputItem | BlockTraceItem;
    if (
      (item as { type: string }).type === "block_trace" &&
      (item as BlockTraceItem).blockName === "apply-threshold" &&
      "output" in item
    ) {
      return (resolveBlockValueLocal(
        (item as BlockTraceItem).output,
        items,
      ) ?? null) as AuditAnnotationData | null;
    }
  }
  return null;
}

/**
 * Renders audit annotations from the Response Auditor pattern.
 * Renders nothing when there are no surfaced results.
 */
export function AuditAnnotation({
  items,
  displayMode = "inline",
}: AuditAnnotationProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  const data = extractAuditData(items);

  // Silent when nothing to report
  if (!data || data.surfacedResults.length === 0) {
    return null;
  }

  const totalAnnotations = data.surfacedResults.reduce(
    (sum, r) => sum + r.annotations.length,
    0,
  );

  const highestSeverity = data.surfacedResults.reduce<string>(
    (highest, r) => {
      for (const a of r.annotations) {
        if (a.severity === "critical") return "critical";
        if (a.severity === "warning" && highest !== "critical") return "warning";
      }
      return highest;
    },
    "info",
  );

  const summaryLabel = `${totalAnnotations} annotation${totalAnnotations !== 1 ? "s" : ""} detected`;

  if (displayMode === "message") {
    return createElement(
      "div",
      {
        style: {
          padding: "12px 16px",
          borderRadius: "8px",
          backgroundColor: "#f8f9fa",
          border: `1px solid ${SEVERITY_COLOR[highestSeverity]}20`,
          marginTop: "8px",
        },
      },
      createElement(
        "div",
        {
          style: {
            fontWeight: 600,
            fontSize: "14px",
            marginBottom: "8px",
            color: SEVERITY_COLOR[highestSeverity],
          },
        },
        `${SEVERITY_ICON[highestSeverity]} ${summaryLabel}`,
      ),
      ...data.surfacedResults.flatMap((result) =>
        result.annotations.map((annotation, i) =>
          createElement(
            "div",
            {
              key: `${result.analyzerId}-${i}`,
              style: {
                padding: "8px 12px",
                marginBottom: "4px",
                borderLeft: `3px solid ${SEVERITY_COLOR[annotation.severity]}`,
                backgroundColor: "#fff",
                borderRadius: "4px",
              },
            },
            createElement(
              "div",
              { style: { fontWeight: 500, fontSize: "13px" } },
              `${SEVERITY_ICON[annotation.severity]} ${annotation.label}`,
            ),
            createElement(
              "div",
              {
                style: {
                  fontSize: "12px",
                  color: "#6b7280",
                  marginTop: "4px",
                },
              },
              annotation.description,
            ),
            annotation.evidence
              ? createElement(
                  "div",
                  {
                    style: {
                      fontSize: "11px",
                      color: "#9ca3af",
                      marginTop: "4px",
                      fontStyle: "italic",
                    },
                  },
                  `Evidence: "${annotation.evidence}"`,
                )
              : null,
          ),
        ),
      ),
    );
  }

  // Inline mode — collapsible bar
  return createElement(
    "div",
    {
      style: {
        marginTop: "8px",
        borderRadius: "6px",
        border: `1px solid ${SEVERITY_COLOR[highestSeverity]}30`,
        overflow: "hidden",
      },
    },
    createElement(
      "button",
      {
        onClick: () => setExpanded(!expanded),
        style: {
          width: "100%",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "none",
          background: `${SEVERITY_COLOR[highestSeverity]}08`,
          cursor: "pointer",
          fontSize: "13px",
        },
      },
      createElement(
        "span",
        null,
        `${SEVERITY_ICON[highestSeverity]} ${summaryLabel}`,
      ),
      createElement("span", null, expanded ? "\u25B2" : "\u25BC"),
    ),
    expanded
      ? createElement(
          "div",
          { style: { padding: "8px 12px" } },
          ...data.surfacedResults.flatMap((result) =>
            result.annotations.map((annotation, i) =>
              createElement(
                "div",
                {
                  key: `${result.analyzerId}-${i}`,
                  style: {
                    padding: "6px 10px",
                    marginBottom: "4px",
                    borderLeft: `3px solid ${SEVERITY_COLOR[annotation.severity]}`,
                    fontSize: "12px",
                  },
                },
                createElement(
                  "div",
                  { style: { fontWeight: 500 } },
                  `${SEVERITY_ICON[annotation.severity]} ${annotation.label}`,
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
                      `Evidence: "${annotation.evidence}"`,
                    )
                  : null,
              ),
            ),
          ),
        )
      : null,
  );
}
