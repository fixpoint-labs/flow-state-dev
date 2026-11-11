// FIX-2623.
/**
 * `defineView`: declare a view, the block a screen watches, with its scope
 * and, for a list, its row key. Install it in a flow's `views` map. See
 * `types/view.ts` for what a view is.
 */
import { isBlockDefinition } from "../blocks/internal/utils";
import { getZodTypeName } from "../helpers/zod-introspect";
import type { BlockDefinition } from "../types/block";
import type { ViewConfig, ViewDefinition, ViewScope } from "../types/view";

const VIEW_SCOPES: readonly ViewScope[] = ["session", "user", "org"];

/** True when `value` is a view {@link defineView} returned. */
export function isViewDefinition(value: unknown): value is ViewDefinition {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "view";
}

/**
 * Declare a view. Refuses, at definition time, a scope that isn't
 * `"session"`, `"user"` or `"org"`, a missing block, a block with no output
 * schema (its answer would be untyped on the client), and a `key` that isn't
 * a function.
 *
 * @example
 * export const roster = defineView({
 *   scope: "user",
 *   key: (row) => row.id,
 *   block: rosterBlock,
 * });
 * defineFlow({ kind: "workforce-roster", views: { roster } });
 */
export function defineView<TBlock extends BlockDefinition, TScope extends ViewScope>(
  config: ViewConfig<TBlock, TScope>
): ViewDefinition<TBlock, TScope> {
  if (typeof config !== "object" || config === null) {
    throw new Error("defineView takes `{ scope, block }`.");
  }
  if (!VIEW_SCOPES.includes(config.scope)) {
    throw new Error(`defineView: scope ${JSON.stringify(config.scope)} is not "session", "user" or "org".`);
  }
  if (!isBlockDefinition(config.block)) {
    throw new Error("defineView: `block` is not a block. A view computes its answer with one block.");
  }
  const outputKind = getZodTypeName(config.block.outputSchema);
  if (config.block.outputSchema === undefined || outputKind === "ZodAny" || outputKind === "ZodUnknown") {
    throw new Error(
      `defineView: block "${config.block.name}" declares no output schema. A view's answer is typed by its ` +
        "block's `outputSchema`; declare one."
    );
  }
  if (config.key !== undefined && typeof config.key !== "function") {
    throw new Error(`defineView: block "${config.block.name}"'s \`key\` is not a function of a row.`);
  }
  const description = config.description ?? config.block.description;
  return Object.freeze({
    kind: "view" as const,
    scope: config.scope,
    block: config.block,
    ...(config.inputSchema !== undefined ? { inputSchema: config.inputSchema } : {}),
    ...(config.key !== undefined ? { key: config.key } : {}),
    ...(description !== undefined ? { description } : {})
  }) as ViewDefinition<TBlock, TScope>;
}
