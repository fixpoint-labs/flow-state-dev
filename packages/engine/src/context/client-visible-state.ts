// FIX-2754.
/**
 * Which of a session's state fields its client is shown: the ones the owning
 * flow names in `session.client.expose`, and the ones it declares readonly.
 *
 * The HTTP session routes (`../routes/client-session.ts`) and a view's
 * `sessions.list` (`./request-sessions.ts`) both read the rule here, so a
 * view's list never shows a caller more or less of a session's state than the
 * HTTP list shows them.
 */
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { scopeStateSchema } from "./scope-state-defaults";

/** The session state fields `flow` shows a client: exposed, then readonly. */
export function clientVisibleStateKeys(flow: FlowInstance): string[] {
  return [...(flow.session?.client?.expose ?? []), ...getReadonlyStateKeys(scopeStateSchema(flow, "session"))];
}
