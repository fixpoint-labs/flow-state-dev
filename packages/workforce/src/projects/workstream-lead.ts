/**
 * How a worker flow lets its workers lead a workstream: the internal entry a
 * workstream's open dispatches to, which creates the lead's workstream session.
 *
 * Opening a workstream starts its lead's workstream session, a lasting session
 * of the lead, owned by the workstream's owner. A session is brought into
 * being by a dispatch into it, so the open dispatches {@link WORKSTREAM_OPENED_ENTRY}
 * into a session created naming the lead as its worker and the workstream as
 * its `workstreamId`. The worker flow's create check links both at create. The
 * entry itself runs nothing: the session existing, linked, is the whole of it.
 *
 * A flow declares the entry with {@link workstreamOpenedEntry}. The built-in
 * `agent` flow declares it; an app's own worker flow does to let its workers
 * lead workstreams.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

/** The internal entry a workstream's open dispatches to on the lead's flow. **Pinned**: an app's flow declares it. */
export const WORKSTREAM_OPENED_ENTRY = "onWorkstreamOpened";

const openedInputSchema = z.object({}).strict();

const opened = handler({
  name: "workstream-opened",
  inputSchema: openedInputSchema,
  outputSchema: z.object({}),
  execute: () => ({})
});

/**
 * The internal entry that lets a flow's workers lead workstreams: spread it as
 * `internal.actions[WORKSTREAM_OPENED_ENTRY]`.
 */
export function workstreamOpenedEntry() {
  return { inputSchema: openedInputSchema, block: opened };
}

/** Whether a worker flow declares {@link WORKSTREAM_OPENED_ENTRY}, so its workers can lead a workstream. */
export function leadsWorkstreams(flow: unknown): boolean {
  const internal = (flow as { internal?: { actions?: Record<string, unknown> } } | undefined)?.internal;
  return internal?.actions !== undefined && Object.hasOwn(internal.actions, WORKSTREAM_OPENED_ENTRY);
}
