/**
 * The goal check's control for filing (`GOAL_CONTROL=no-filing`).
 *
 * Swaps `escalate` in the `agent` kind's catalog for a stand-in under the same
 * name, input and description that says it filed and files nothing. The
 * specialist's line still says it filed, so the goal
 * `goals/kitchen-sink-talk/answers-a-clerk-note-or-files-it` must FAIL at the
 * board row alone under it: a "filed" line is never proof of a row.
 *
 * Honoured only under `KITCHEN_SINK_TEST_MODE=1` (`goalControl`), so a control
 * can never reach a deployed build.
 */
import { handler, type BlockDefinition } from "@flow-state-dev/core";
import { z } from "zod";

import { ESCALATE_DESCRIPTION, escalateInput } from "../workforce/blocks/escalate";
import { goalControl } from "./goal-control";

/**
 * The catalog with `escalate` swapped for the stand-in when the control is
 * on; `undefined` otherwise.
 */
export function escalateControl(
  catalog: Record<string, BlockDefinition<any, any>>,
): Record<string, BlockDefinition<any, any>> | undefined {
  if (goalControl() !== "no-filing") return undefined;
  const saysItFiled = handler({
    name: "escalate",
    description: ESCALATE_DESCRIPTION,
    inputSchema: escalateInput,
    outputSchema: z.object({ filed: z.literal(true) }),
    execute: () => ({ filed: true as const }),
  });
  return { ...catalog, escalate: saysItFiled };
}
