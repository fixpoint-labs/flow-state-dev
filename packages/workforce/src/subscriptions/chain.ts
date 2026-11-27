// FIX-2534 D1; FIX-2537, epic D7.
/**
 * The screen chain: a sequencer of `.stepIf` steps, each taken while a
 * subscription is still undecided, so the first refusal stops that
 * subscription.
 *
 * The config screens (`sender`, `own`, `labels`, `words`, `allow`), then the
 * app's custom screens in declared order, then one `interest` judgment over
 * the subscriptions every code screen passed. Only that last step reads a
 * model, and only when an undecided subscription lists `interest`; nothing
 * else here resolves one. Whoever is left passes.
 */
import { sequencer } from "@flow-state-dev/core";
import { asksInterest, interestJudgment } from "./interest";
import {
  customScreenStep,
  listsUndeclaredCustom,
  passRest,
  screenStep,
  screeningSchema,
  undecided,
  undeclaredCustomStep,
  type ScreenOptions,
  type SubscriptionScreens
} from "./screens";

/** What the chain is built with: the bots the service lets through, and the provider's own screens. */
export interface ScreenChainOptions extends ScreenOptions {
  readonly screens?: SubscriptionScreens;
}

/** Build the screen chain. */
export function screenChain(options: ScreenChainOptions) {
  const custom = Object.entries(options.screens?.custom ?? {});
  let chain = sequencer({ name: "subscription-screens", inputSchema: screeningSchema })
    .stepIf(undecided, screenStep("sender", options))
    .stepIf(undecided, screenStep("own", options))
    .stepIf(undecided, screenStep("labels", options))
    .stepIf(undecided, screenStep("words", options))
    .stepIf(undecided, screenStep("allow", options));
  for (const [name, screen] of custom) chain = chain.stepIf(undecided, customScreenStep(name, screen));
  const declared = custom.map(([name]) => name);
  return chain
    .stepIf(listsUndeclaredCustom(declared), undeclaredCustomStep(declared))
    .stepIf(asksInterest, interestJudgment(options.screens?.interestModel))
    .stepIf(undecided, passRest);
}
