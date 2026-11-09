---
"@flow-state-dev/workforce": minor
---

A subscription can now say what it wants in code or in a sentence: the app's own custom screens, and an `interest` screen a model judges once per event (FIX-2537).

- **workforce:** `SubscriptionProvider` gains `screens`: `custom`, the app's own sync functions `(event, entry) => string | undefined` declared once by name and run in declared order (a string refuses with it, `undefined` passes, a throw refuses as `custom:<name>: failed`), and `interestModel`, the one evaluation model the `interest` screen asks.
- **workforce:** a subscription lists `{ screen: "custom", name }` and `{ screen: "interest" }`. `subscribe` refuses an undeclared name (`no_screen`) and `interest` on a provider with no model (`no_interest_model`); the tool's description lists the provider's custom screens.
- **workforce:** `interest` asks one evaluator call per routing run, a yes or no per distinct sentence, only of the subscriptions every code screen passed; each sentence is quoted to the model as data, fenced and capped at 200 characters. A failed call (or more than 32 distinct sentences) refuses its askers `interest: unjudged`, with no retry and no generator fallback. No subscription that lists `interest`, no model call.
- **workforce:** `unheard(routed)` says whether every subscription refused an event on its content; `refusedOnContent(verdict)` reads one verdict. An `interest: unjudged` or `<screen>: failed` refusal is not on content.
- **workforce:** a pass's verdict reason is now `passed its screens` (was `passed the config screens`), or `interest: matches` when the model decided it.

Docs: packages/workforce/README.md (Subscriptions: custom screens on the provider, `interest` and its one call per event, `unjudged`, `unheard`), apps/docs/docs/workforce/messaging-workers.md (Messages from a service: the sentence is read by the `interest` screen when listed; "screens don't read it" no longer holds)
