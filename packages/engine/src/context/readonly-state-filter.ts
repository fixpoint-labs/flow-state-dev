// FIX-2725.
/**
 * The one guard on a session list's state filter: only the readonly state
 * fields the session's flow declares, which are fixed for a session's life,
 * filter a list. The HTTP session list (`?state.<field>=`) and a view's
 * `sessions.list` both call it, so neither can filter on state the other
 * refuses.
 */
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import type { FlowInstance } from "@flow-state-dev/core/types";

/**
 * `fields` as a store state filter, when every one names a readonly state
 * field `flow` declares; otherwise the refusal, in words.
 *
 * @param flow The flow the listed sessions run, or `undefined` when the list
 *   named none this process registers.
 */
export function readonlyStateFilter(
  flow: FlowInstance | undefined,
  fields: Readonly<Record<string, string>>
): { state: Record<string, string> } | { error: string } {
  if (flow === undefined) {
    return {
      error:
        "A state filter needs the flow whose readonly state fields it names: pass flowId, or " +
        "the flowKind of a registered flow."
    };
  }
  // The flow's own schema, not the merged one: the store filters the state it
  // holds, and a field only a block declares is filled at read time, never
  // stored at birth, so filtering on it would answer an empty list.
  const readonly = new Set(getReadonlyStateKeys(flow.session?.stateSchema));
  const state: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (!readonly.has(field)) {
      return {
        error:
          `Sessions of flow "${flow.kind}" can't be filtered by state field "${field}": only ` +
          `readonly state fields are filterable` +
          (readonly.size === 0 ? ", and this flow declares none." : ` (${[...readonly].join(", ")}).`)
      };
    }
    state[field] = value;
  }
  return { state };
}
