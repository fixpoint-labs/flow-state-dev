/**
 * Model-resolution error for an `intent/*` model string the resolver cannot
 * resolve: the app declares no `models.intents.<name>` and no
 * `models.default` to fall back on. Carries a stable `code` so callers (the
 * `fsdev` CLI's missing-config hint) can recognise it without matching the
 * message text.
 */
import { FlowError } from "./flow-error";

/** The `code` every {@link UnresolvedIntentError} carries. */
export const UNRESOLVED_INTENT_CODE = "unresolved_intent";

/** Structured details carried by {@link UnresolvedIntentError}. */
export type UnresolvedIntentDetails = {
  /** The intent name, without the `intent/` prefix. */
  intent: string;
};

/** Thrown when an `intent/*` model has neither an intent mapping nor a default model. */
export class UnresolvedIntentError extends FlowError {
  declare readonly details: UnresolvedIntentDetails;

  constructor(intent: string) {
    super(
      `No model is configured for "intent/${intent}": the app sets no \`models.intents.${intent}\` ` +
        `and no \`models.default\` to fall back on. Set one where the app creates its FlowState ` +
        `(\`createFlowState({ models: { default: "<provider>/<model>" } })\`, or \`defaultModel\` on ` +
        `\`createModelResolver\`), or set the FSDEV_DEFAULT_MODEL environment variable.`,
      { code: UNRESOLVED_INTENT_CODE, retryable: false, details: { intent } }
    );
    this.name = "UnresolvedIntentError";
  }
}
