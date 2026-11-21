/** The run's items, as the script holds them: every one is the task's. See `../shared.ts`. */
export * from "../../../lib/task-items";
import type { OutputItem } from "@flow-state-dev/core/items";

export function taskItems(items: OutputItem[]) {
  return { items, shared: false };
}
