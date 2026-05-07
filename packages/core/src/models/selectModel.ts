/**
 * selectModel utility — declarative model selection.
 *
 * Produces a function that yields a {@link ModelSelection} from an ordered
 * list of rules. Two rule kinds are supported:
 *
 * - `preferProvider` — collects a provider-name preference (first non-null
 *   value wins) and threads it alongside the chosen model. Does not
 *   short-circuit; collection continues so `when` rules can still fire.
 * - `when` — first truthy condition wins and replaces the model. Short-circuits
 *   the model axis but does not affect the collected `preferProvider`.
 *
 * The legacy `prefer` rule is no longer supported and throws a migration
 * error at function-builder time. Use `preferProvider` for provider-name
 * semantics, or restructure as a `when` rule for full model replacement.
 */
import type { BlockContext } from "../types/block";
import type { MaybePromise } from "../schema/common";
import type { ProviderPreference } from "./types";

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

/**
 * Loose BlockContext where state access returns `any` instead of `unknown`.
 * Used as the default TCtx for rule callbacks since selectModel is called
 * outside the generator where specific state types aren't available.
 */
type LooseBlockContext = BlockContext<any, any, any, any>;

/**
 * Returns a provider-preference value (provider name or ordered list of
 * provider names). The first non-null result is collected into the
 * {@link ModelSelection}'s `preferProvider` field. Evaluation does not
 * short-circuit — `when` rules below still execute.
 */
export type PreferProviderRule<TInput = unknown, TCtx = LooseBlockContext> = {
  preferProvider: (
    input: TInput,
    ctx: TCtx
  ) => MaybePromise<string | string[] | undefined | null>;
};

/**
 * Returns a boolean condition. When true, replaces the model with `use`.
 */
export type WhenRule<TInput = unknown, TCtx = LooseBlockContext> = {
  when: (input: TInput, ctx: TCtx) => MaybePromise<boolean>;
  use: string | string[];
};

/** Union of all rule kinds. */
export type ModelRule<TInput = unknown, TCtx = LooseBlockContext> =
  | PreferProviderRule<TInput, TCtx>
  | WhenRule<TInput, TCtx>;

/**
 * Final return shape of the {@link selectModel} callable. May be a bare
 * model id (or array of ids) when no preference was collected, or an object
 * carrying both the model and a `preferProvider` value when one was.
 */
export type ModelSelection =
  | string
  | string[]
  | { model: string | string[]; preferProvider?: ProviderPreference };

const LEGACY_PREFER_MIGRATION_MESSAGE =
  "selectModel: the `prefer` rule has been replaced. Use `preferProvider` for\n" +
  "provider-name semantics, or restructure as a `when` rule for model\n" +
  "replacement. See FIX-512 for context.";

/**
 * Type-guard for the structured {@link ModelSelection} object form.
 * Returns true when `v` is `{ model, preferProvider? }`.
 */
export function isModelSelection(
  v: unknown
): v is { model: string | string[]; preferProvider?: ProviderPreference } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "model" in v
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ResolvableModel function from declarative rules.
 *
 * Evaluation order:
 * 1. All rules walked in order; first non-null `preferProvider` is collected.
 * 2. First truthy `when` rule replaces the model with its `use` value.
 * 3. Default — used when no `when` rule matches.
 *
 * If a `preferProvider` was collected, the return is
 * `{ model, preferProvider }`. Otherwise the bare model (string or array)
 * is returned for backward compatibility with the generator block.
 *
 * @example
 * ```ts
 * model: selectModel("intent/chat", [
 *   { preferProvider: (_input, ctx) => ctx.user?.state.preferredProvider },
 *   { when: (_input, ctx) => ctx.session.state.thinkingStyle === "chain-of-thought",
 *     use: "intent/reason" },
 * ])
 * ```
 */
export function selectModel<TInput = unknown, TCtx extends BlockContext = LooseBlockContext>(
  defaultModel: string | string[],
  rules: ModelRule<TInput, TCtx> | ModelRule<TInput, TCtx>[]
): (input: any, ctx: any) => Promise<ModelSelection> {
  const ruleList = Array.isArray(rules) ? rules : [rules];

  // Validate rule shapes at builder time so misuse fails immediately.
  for (const rule of ruleList) {
    if ("prefer" in rule) {
      throw new Error(LEGACY_PREFER_MIGRATION_MESSAGE);
    }
  }

  return async (input: TInput, ctx: TCtx): Promise<ModelSelection> => {
    let collectedPreferProvider: ProviderPreference | undefined;
    let model: string | string[] = defaultModel;
    let modelOverridden = false;

    for (const rule of ruleList) {
      if ("preferProvider" in rule) {
        if (collectedPreferProvider !== undefined) continue;
        const candidate = await rule.preferProvider(input, ctx);
        if (candidate != null && candidate !== "") {
          collectedPreferProvider = candidate;
        }
        continue;
      }

      if ("when" in rule) {
        if (modelOverridden) continue;
        const matched = await rule.when(input, ctx);
        if (matched) {
          model = rule.use;
          modelOverridden = true;
        }
      }
    }

    if (collectedPreferProvider !== undefined) {
      return { model, preferProvider: collectedPreferProvider };
    }
    return model;
  };
}
