/**
 * Tiny renderer-side component that surfaces a `ModelIdentity` as a pill
 * badge. Renders `actual` as the visible label; the tooltip (`title`) lists
 * the requested string and gateway when present.
 *
 * Renders nothing when `model` is undefined — handler-emitted items and old
 * persisted items without the field omit it. This means consumers can pass
 * `item.model` directly: `<ModelBadge model={item.model} />`.
 */
import { createElement } from "react";
import type { CSSProperties } from "react";
import type { ModelIdentity } from "@flow-state-dev/core/items";

export interface ModelBadgeProps {
  /** Identity field from any generator-emitted item or block_trace item. */
  model: ModelIdentity | undefined;
  /** Optional override for the inline styles. Merged over defaults. */
  style?: CSSProperties;
  /** Optional className for consumers using utility CSS. */
  className?: string;
}

const DEFAULT_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  borderRadius: "9999px",
  border: "1px solid rgba(127,127,127,0.3)",
  backgroundColor: "rgba(127,127,127,0.08)",
  padding: "2px 8px",
  fontSize: "10px",
  fontWeight: 500,
  lineHeight: 1,
  color: "var(--fsd-muted-foreground, #6b7280)",
};

/**
 * Build the hover tooltip text. Includes the requested string (when different)
 * and gateway (when present) so a consumer hovering the badge sees the full
 * resolution context without polluting the visible pill.
 */
function buildTooltip(model: ModelIdentity): string {
  const parts: string[] = [`actual: ${model.actual}`];
  if (model.requested !== undefined) parts.push(`requested: ${model.requested}`);
  if (model.gateway !== undefined) parts.push(`gateway: ${model.gateway}`);
  return parts.join("\n");
}

export function ModelBadge(props: ModelBadgeProps) {
  const { model, style, className } = props;
  if (model === undefined) return null;

  return createElement(
    "span",
    {
      className,
      style: style === undefined ? DEFAULT_STYLE : { ...DEFAULT_STYLE, ...style },
      title: buildTooltip(model),
    },
    model.actual,
  );
}
