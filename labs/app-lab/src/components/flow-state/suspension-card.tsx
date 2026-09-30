"use client";

import { createElement } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { suspensionShape, useFlowContext } from "@flow-state-dev/react";
import { Approval } from "./approval";
import { Question } from "./question";
import { Selection } from "./selection";
import { Form } from "./form";
import { useSuspensionResolution } from "./suspension-resolution";

/**
 * Polished dispatcher for `type === "suspension"` items (FIX-849). Registered as
 * the single `suspension` renderer; it picks the right card by `reason` and
 * `resumeSchema` shape — the binary approval card, a clarifying-question card, a
 * selection card, or a flat-form card. Mirrors the built-in `ItemRenderer`
 * dispatch so the polished and minimal surfaces stay aligned.
 *
 * Because registering this as the `suspension` slot bypasses the built-in
 * `ItemRenderer`'s `render.component` check, the escape hatch is honored here
 * too: a suspension that names a registered `render.component` renders that
 * author-supplied component (for schemas richer than the bounded defaults)
 * before any shape dispatch.
 *
 * `human_approval` keeps the existing `Approval` card (which derives its own
 * resolved state). For `human_input`, this derives resolved state once from the
 * session stream and passes it to the chosen non-binary card.
 */
export function SuspensionCard({ item }: { item: SuspensionItem }) {
  // Called unconditionally (rules of hooks); the Approval branch ignores it and
  // derives its own resolved state.
  const { isResolved, resolution } = useSuspensionResolution(item.suspensionId);
  const { renderers } = useFlowContext();

  // Escape hatch: an author-supplied component named via `render.component`
  // wins over the bounded default cards (matches ItemRenderer's precedence).
  const componentKey = item.render?.component;
  if (componentKey !== undefined) {
    const custom = renderers?.component?.[componentKey];
    if (custom !== undefined && custom !== false) {
      return createElement(custom, { item });
    }
  }

  switch (suspensionShape(item)) {
    case "form":
      return <Form item={item} isResolved={isResolved} resolution={resolution} />;
    case "selection":
      return <Selection item={item} isResolved={isResolved} resolution={resolution} />;
    case "question":
      return <Question item={item} isResolved={isResolved} resolution={resolution} />;
    case "approval":
    default:
      return <Approval item={item} />;
  }
}
