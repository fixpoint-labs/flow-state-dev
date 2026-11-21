/**
 * The tools only a workstream's lead can use: each writes the workstream its
 * session leads, so a turn on a session that leads none is not offered them.
 * The write still refuses such a session (`not-a-workstream-session`); this
 * keeps the model from calling a tool it can't use.
 *
 * A leaf module, so the worker flows that resolve a turn's tools can import it
 * without importing the workstream writes.
 */

import { WORKSTREAM_STATE_KEY } from "../workers/keys";

const leadOnly = new WeakSet<object>();

/**
 * Mark `tool` as one only a workstream's lead can use.
 *
 * @param tool The tool, as the worker flows' catalogs hold it.
 * @returns The same tool.
 */
export function markLeadOnlyTool<T extends object>(tool: T): T {
  leadOnly.add(tool);
  return tool;
}

/**
 * Whether a turn on this session is offered `tool`: false for a lead-only tool
 * on a session that leads no workstream, true otherwise.
 *
 * @param tool A tool the turn would be given.
 * @param ctx The turn's context; only its session state is read.
 * @returns Whether to give the turn the tool.
 */
export function offeredOnSession(tool: object, ctx: { readonly session?: { readonly state?: unknown } }): boolean {
  if (!leadOnly.has(tool)) return true;
  const state = ctx.session?.state as Record<string, unknown> | undefined;
  return typeof state?.[WORKSTREAM_STATE_KEY] === "string";
}
