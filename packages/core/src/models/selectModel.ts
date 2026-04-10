/**
 * selectModel utility — declarative model selection.
 *
 * Produces a ResolvableModel function from an ordered list of rules, avoiding
 * the need for inline model functions with type casts in block configs.
 * Prefer rules are evaluated first (first non-null, non-default value wins),
 * then when rules (first truthy condition wins), then the default.
 */
import type { BlockContext } from "../types/block";
import type { MaybePromise } from "../schema/common";

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

/**
 * Returns a candidate model string.
 * If it resolves to null, undefined, empty string, or the same value as the
 * default, this rule is skipped and evaluation continues to the next rule.
 */
export type PreferRule<TInput = unknown, TCtx = BlockContext> = {
  prefer: (input: TInput, ctx: TCtx) => MaybePromise<string | undefined | null>;
};

/**
 * Returns a boolean condition. When true, uses the `use` model.
 */
export type WhenRule<TInput = unknown, TCtx = BlockContext> = {
  when: (input: TInput, ctx: TCtx) => MaybePromise<boolean>;
  use: string | string[];
};

/** Union of all rule kinds. */
export type ModelRule<TInput = unknown, TCtx = BlockContext> =
  | PreferRule<TInput, TCtx>
  | WhenRule<TInput, TCtx>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ResolvableModel function from declarative rules.
 *
 * Evaluation order:
 * 1. All `prefer` rules — first that returns a non-null, non-empty, non-default string wins.
 * 2. All `when` rules — first that returns `true` wins, uses its `use` value.
 * 3. Default — returned as-is when no rule matches.
 *
 * @example
 * ```ts
 * model: selectModel("preset/fast", [
 *   { prefer: (_input, ctx) => ctx.user?.state.preferredModel },
 *   { when: (_input, ctx) => ctx.session.state.thinkingStyle === "chain-of-thought",
 *     use: "preset/thinking-small" },
 * ])
 * ```
 */
export function selectModel<TInput = unknown, TCtx extends BlockContext = BlockContext>(
  defaultModel: string | string[],
  rules: ModelRule<TInput, TCtx> | ModelRule<TInput, TCtx>[]
): (input: TInput, ctx: TCtx) => Promise<string | string[]> {
  const ruleList = Array.isArray(rules) ? rules : [rules];
  const defaultString = Array.isArray(defaultModel) ? null : defaultModel;

  return async (input: TInput, ctx: TCtx): Promise<string | string[]> => {
    // Phase 1: prefer rules — first non-null, non-default value wins
    for (const rule of ruleList) {
      if ("prefer" in rule) {
        const candidate = await rule.prefer(input, ctx);
        if (
          candidate != null &&
          candidate !== "" &&
          (defaultString === null || candidate !== defaultString)
        ) {
          return candidate;
        }
      }
    }

    // Phase 2: when rules — first truthy condition wins
    for (const rule of ruleList) {
      if ("when" in rule) {
        const matched = await rule.when(input, ctx);
        if (matched) {
          return rule.use;
        }
      }
    }

    // Phase 3: default
    return defaultModel;
  };
}
