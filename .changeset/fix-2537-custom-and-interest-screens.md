---
"@flow-state-dev/workforce": minor
---

A subscription can now say what it wants in code or in a sentence: the app's own custom screens, and an `interest` screen a model judges once per event (FIX-2537).

- **workforce:** `SubscriptionProvider` gains `screens`: `custom`, the app's own sync functions `(event, entry) => string | undefined` declared once by name and run in declared order (a string refuses with it, `undefined` passes, a throw refuses as `custom:<name>: failed`), and `interestModel`, the one evaluation model the `interest` screen asks.
- **workforce:** an event routine's trigger (`saveRoutine`, `{ event: { … } }`) lists `{ screen: "custom", name }` and `{ screen: "interest" }`. It refuses an undeclared name (`no_screen`, naming the provider's screens) and `interest` on a provider with no model (`no_interest_model`). The roster's `saveRoutine` description lists the provider's custom screens. Delivery runs the custom screens again on the saved subscription; `interest` is judged once, in routing.
- **workforce:** `interest` asks one evaluator call per routing run, a yes or no per distinct sentence, only of the subscriptions every code screen passed; each sentence is quoted to the model as data, fenced and capped at 200 characters. A failed call (or more than 32 distinct sentences) refuses its askers `interest: unjudged`, with no retry and no generator fallback. No subscription that lists `interest`, no model call.
- **workforce:** a verdict gains an optional `failed: true`, set only when a screen couldn't run (a custom screen that threw or answered with no string, or one the provider doesn't declare). `unheard(routed)` says whether every subscription refused an event on its content, and `refusedOnContent(verdict)` reads one verdict: an `interest: unjudged` refusal, a `failed` one, or `no verdict` is not on content. An app's own reason, or a listed word, that ends in ": failed" still is.
- **workforce:** a pass's verdict reason is now `passed its screens` (was `passed the config screens`), or `interest: matches` when the model decided it.

Docs: packages/workforce/README.md (Subscriptions: custom screens on the provider, `interest` and its one call per event, `unjudged`, `unheard`), apps/docs/docs/workforce/messaging-workers.md (Messages from a service: the sentence is read by the `interest` screen when listed; "screens don't read it" no longer holds)
