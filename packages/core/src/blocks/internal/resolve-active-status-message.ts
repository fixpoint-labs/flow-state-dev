/**
 * Declarative `activeStatusMessage` → `emit.status` bridge.
 *
 * Invoked at block start by the server's `executeByKind`, the core sequencer's
 * nested `executeBlock`, and the core router's `runSelected`. Reads the
 * block's config, resolves a static string or `(input, ctx) => string`
 * function, and calls `ctx.emit.status` with the result. The slot's dedupe
 * logic handles repeat emissions safely.
 */
import type { BlockContext, BlockDefinition } from "../../types/block";

type ActiveStatusMessageConfig =
  | string
  | ((input: any, ctx: BlockContext) => string)
  | undefined;

export function resolveActiveStatusMessage(
  block: BlockDefinition<any, any>,
  input: unknown,
  ctx: BlockContext
): void {
  const value: ActiveStatusMessageConfig = (
    block.config as { activeStatusMessage?: ActiveStatusMessageConfig }
  ).activeStatusMessage;
  if (value === undefined) {
    return;
  }
  const message = typeof value === "function" ? value(input, ctx) : value;
  ctx.emit.status(message);
}
