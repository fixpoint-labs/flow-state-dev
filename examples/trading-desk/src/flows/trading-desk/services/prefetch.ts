/**
 * `callAsTool` — wraps a tool block so it emits the same `tool_output`
 * item lifecycle the AI-SDK tool-loop path produces, even when invoked
 * from a sequencer step rather than an LLM-driven generator.
 *
 * Used by Phase 1 analysts to keep transcript visibility for the data
 * fetches they now run deterministically (via `.map → .parallel`) instead
 * of through an LLM tool loop.
 *
 * This is an app-local shim for FIX-593, which proposes the same surface
 * (`callAsTool(block, opts?)`) as a first-class framework helper. When that
 * ships, this file gets deleted and the import flips to
 * `import { callAsTool } from "@flow-state-dev/core"` — call sites stay
 * identical by design.
 */
import { handler } from "@flow-state-dev/core";
import { asRuntime, type BlockDefinition } from "@flow-state-dev/core/types";

export type CallAsToolOpts = {
  /** Attribution stamped on the emitted item. Mirrors how the AI-SDK tool
   *  wrapper stamps `agentType`/`agentName` from the parent generator. */
  agentType?: "primary" | "sub";
  agentName?: string;
};

/**
 * `tool_output` envelope shape — narrowed to what `ctx.response.emit`
 * accepts. We don't import the framework's `ToolOutputItem` directly
 * because the runtime envelope has a couple of internal fields (`ts`,
 * `itemIndex`, `provenance`) that aren't on the public type surface.
 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function emitterItemCount(response: unknown): number {
  if (
    typeof response === "object" &&
    response !== null &&
    "getItems" in response &&
    typeof (response as { getItems?: unknown }).getItems === "function"
  ) {
    const items = (response as { getItems: () => unknown[] }).getItems();
    return Array.isArray(items) ? items.length : 0;
  }
  return 0;
}

export function callAsTool<TIn, TOut>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: BlockDefinition<any, any, TIn, TOut>,
  opts: CallAsToolOpts = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): BlockDefinition<any, any, TIn, TOut> {
  return handler({
    name: `${block.config.name}__as_tool`,
    description: block.config.description,
    inputSchema: block.config.inputSchema,
    outputSchema: block.config.outputSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (input: TIn, ctx: any): Promise<TOut> => {
      const blockName = String(block.config.name);
      const callId = `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const itemId = `item_tool_output_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const parentIdentity = ctx._blockIdentity;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item: any = {
        id: itemId,
        type: "tool_output",
        status: "in_progress",
        requestId: ctx.request.identity.id,
        itemIndex: emitterItemCount(ctx.response),
        provenance: {
          blockName: parentIdentity?.blockName ?? blockName,
          blockInstanceId: parentIdentity?.blockInstanceId ?? blockName,
          parentBlockInstanceId: parentIdentity?.parentBlockInstanceId,
          phase: parentIdentity?.phase ?? "main",
        },
        ts: Date.now(),
        ownedBy: parentIdentity?.ownedBy,
        ...(opts.agentType !== undefined ? { agentType: opts.agentType } : {}),
        ...(opts.agentName !== undefined ? { agentName: opts.agentName } : {}),
        blockName,
        output: undefined,
        toolCall: {
          callId,
          name: blockName,
          alias: sanitizeToolName(blockName),
          arguments: JSON.stringify(input),
          generatorBlock: parentIdentity?.blockName ?? "prefetch",
        },
      };

      await ctx.response.emit({ type: "item.added", item });

      try {
        // Invoke the wrapped block's runtime directly — bypasses
        // `executeBlock`'s scope/trace emission so the only transcript
        // artefact is the `tool_output` item this wrapper emits.
        const output = (await asRuntime(block).run(input, ctx)) as TOut;
        item.status = "completed";
        item.output = output;
        await ctx.response.emit({
          type: "item.updated",
          id: itemId,
          patch: { status: "completed", output },
        });
        await ctx.response.emit({ type: "item.done", item });
        return output;
      } catch (error) {
        const err = error as Error & { code?: string; details?: Record<string, unknown> };
        item.status = "failed";
        item.error = {
          message: err.message,
          ...(err.code ? { code: err.code } : {}),
          ...(err.details ? { details: err.details } : {}),
        };
        await ctx.response.emit({
          type: "item.updated",
          id: itemId,
          patch: { status: "failed", output: undefined, error: item.error },
        });
        await ctx.response.emit({ type: "item.done", item });
        throw err;
      }
    },
  });
}
