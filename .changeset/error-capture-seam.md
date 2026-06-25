---
"@flow-state-dev/engine": minor
---

Add `errorCapture`, an opt-in, provider-neutral seam for routing runtime block failures (tool errors, generator failures, handler exceptions) to an external observability service like Sentry, Datadog, or Bugsnag. Set it on `createFlowState({ errorCapture })`: the callback receives an `ErrorCaptureEvent` with the normalized `FlowError`, the failing block's identity, and the flow / request / session / user IDs, and fires once per failing block. It is distinct from the HTTP-level `onError`, ships no provider SDK, and is fire-and-forget so a slow or throwing sink can never affect the request. See the Error capture docs for the full event shape and filtering guidance.
