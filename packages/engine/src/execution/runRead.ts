// FIX-2286.
/**
 * Run a flow's read: a block an app runs on a session to watch a
 * view the flow computes, answered to the caller and stored nowhere.
 *
 * A read is a session view by another name, and runs through the one view
 * runner (`runView.ts`): the same read-only stores, the same
 * recorder, the same refusals. It answers its output alone; the recorded
 * topics are a view's. Reads are removed once their callers have moved to
 * views.
 */
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { RuntimeConfig } from "../runtime-config";
import type { StoreRegistry } from "../stores/types";
import { parseReadInput, runReadOnly } from "./runView";

/** What {@link runRead} needs: the flow, the read, the caller and the session. */
export type RunReadOptions = {
  flow: FlowInstance;
  readName: string;
  input: unknown;
  userId: string;
  orgId: string;
  sessionId: string;
  tenantId?: string;
  stores: StoreRegistry;
  runtimeConfig?: Pick<RuntimeConfig, "settings" | "logger" | "tracingLevel">;
  signal?: AbortSignal;
};

/** A read the flow doesn't declare. */
export class UnknownReadError extends Error {
  constructor(readonly flowId: string, readonly readName: string) {
    super(`Flow "${flowId}" has no read "${readName}"`);
    this.name = "UnknownReadError";
  }
}

/**
 * Run read `readName` of `flow` on `sessionId` for its caller and return the
 * block's output. Throws what the block threw, `read_only` for any write it
 * tried, and the action path's binding errors for a session the caller may
 * not run in. Nothing it does reaches `stores`.
 */
export async function runRead(options: RunReadOptions): Promise<unknown> {
  const read = Object.hasOwn(options.flow.reads ?? {}, options.readName)
    ? options.flow.reads![options.readName]!
    : undefined;
  if (read === undefined) throw new UnknownReadError(options.flow.id, options.readName);
  const input = parseReadInput(read.inputSchema ?? read.block.inputSchema, options.input);
  const { output } = await runReadOnly({
    flow: options.flow,
    name: options.readName,
    block: read.block,
    input,
    scope: "session",
    userId: options.userId,
    orgId: options.orgId,
    sessionId: options.sessionId,
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    stores: options.stores,
    ...(options.runtimeConfig !== undefined ? { runtimeConfig: options.runtimeConfig } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    source: "read"
  });
  return output;
}
