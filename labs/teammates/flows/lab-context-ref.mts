// FIX-2771.
/**
 * The page's handle on the lab's context view (`lab-context.mts`): the flow's
 * address and the view's name, typed by the view through a type import. A leaf
 * with no block, so the page bundles it without the flow's builders, which
 * carry Node-only model resolution.
 */
import { viewRef } from "@flow-state-dev/client";
import type { LabContextView } from "./lab-context.mts";

/** The flow whose `context` view answers what the lab works on and with. */
export const LAB_CONTEXT_FLOW = "lab-context";

/** What the lab works on and with: `useView(labContextView, {})`. */
export const labContextView = viewRef<LabContextView>(LAB_CONTEXT_FLOW, "context");
