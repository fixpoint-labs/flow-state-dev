"use client";

import type { SuspensionItem } from "@flow-state-dev/core/items";
import { suspensionShape } from "@flow-state-dev/react";
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
 * `human_approval` keeps the existing `Approval` card (which derives its own
 * resolved state). For `human_input`, this derives resolved state once from the
 * session stream and passes it to the chosen non-binary card.
 */
export function SuspensionCard({ item }: { item: SuspensionItem }) {
  // Called unconditionally (rules of hooks); the Approval branch ignores it and
  // derives its own resolved state.
  const { isResolved, resolution } = useSuspensionResolution(item.suspensionId);

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
