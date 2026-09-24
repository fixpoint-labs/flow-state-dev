# POC · which evaluation adapters report confidence

Retained evidence for [DECISIONS.md → Settled](../../DECISIONS.md#settled). It is throwaway,
not production code, and nothing imports it. It is not a pnpm workspace member (`specs/` is
outside `pnpm-workspace.yaml`), has no test file for vitest to discover, and makes no network
call: every model reply is a stub.

```bash
cd specs/issues/FIX-1558/poc/adapter-confidence
npm install --no-package-lock
node check.mjs                          # all legs pass
POC_CONTROL=planted node check.mjs      # must fail one leg: the planted control
```

## The question

The epic's D2 says the popular providers' evaluation adapters return neither confidence nor a
distribution, so a `cascadingRouter` on them always lands on `ambiguous`, and asked this spec to
re-check that against the shipped adapters. Is it true of the published packages?

## Legs

1. `openai.evaluationModel(...)` and `anthropic.evaluationModel(...)` are both the AI SDK's
   generic `Experimental_EvaluationLanguageModel`, which asks the chat model for one JSON value
   per question.
2. That wrapper, given a reply that carries the provider's own metadata (logprobs included),
   returns a bare `{ type: "choice", choice }`: no `probabilities`, no `confidence`, and no
   `providerMetadata.typesafe.confidence`, which is where FIX-1554's seam reads confidence.
3. Jev's own library, on a stub fetch, reports confidence and a distribution, and leaves
   confidence out for an answer its API returned as `null`.

**Control.** `POC_CONTROL=planted` puts a `typesafe` confidence into the OpenAI stub's metadata.
Leg 2's last check must then fail, which shows the check can see a confidence when one is there.

## What it showed (2026-09-24, `@ai-sdk/openai@4.0.75`, `@ai-sdk/anthropic@4.0.63`, `@ai-sdk/provider-utils@5.0.47`, `@ai-sdk/typesafe-ai@3.0.6`)

All legs pass; the control fails one leg as it should. D2 holds: on OpenAI or Anthropic every
cascade edge lands on `ambiguous`. One addition the epic did not name: **Jev can omit
confidence on a single answer**, so a Jev-backed tree can also land on `ambiguous` for that
reason (BR-6).

Not covered: the gateway's server. The gateway client passes the server's `providerMetadata`
through unchanged, so Jev-via-gateway confidence arrives only if the server sends it. FIX-1554's
goal (VG) and this issue's (VG) run that path on a real key.
