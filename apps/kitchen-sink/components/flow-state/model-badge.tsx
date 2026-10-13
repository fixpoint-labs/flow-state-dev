"use client";

import type { ModelIdentity } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";

/**
 * Small pill that surfaces a `ModelIdentity` — the model that actually answered.
 *
 * Shows `actual` as the label; the hover tooltip adds the requested string and
 * gateway when present. Renders nothing when `model` is undefined (handler-emitted
 * items and old persisted items omit the field), so `<ModelBadge model={item.model} />`
 * is always safe to call.
 */
export function ModelBadge({
  model,
  className,
}: {
  model: ModelIdentity | undefined;
  className?: string;
}) {
  if (model === undefined) return null;

  const title = [
    `actual: ${model.actual}`,
    model.requested !== undefined ? `requested: ${model.requested}` : null,
    model.gateway !== undefined ? `gateway: ${model.gateway}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-[10px] font-medium leading-none text-muted-foreground",
        className,
      )}
    >
      {model.actual}
    </span>
  );
}
