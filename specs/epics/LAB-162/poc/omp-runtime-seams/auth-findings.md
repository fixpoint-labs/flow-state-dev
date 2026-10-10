# Probe — can pi's auth and usage be shared with FSD?

Run: `pi --mode json -e ./auth-probe.ts -p "hi"` then read `auth-probe.json`.
The probe reports **shape and presence only**, never key material.

## Result

```json
{
  "hasModelRegistry": true,
  "hasComplete": true,
  "isUsingOAuth": { "anthropic": false },
  "anthropic":    { "source": "OAuth", "authKeys": ["apiKey","headers"], "apiKey": "string(108)" },
  "openai-codex": { "source": "OAuth", "authKeys": ["apiKey"],           "apiKey": "string(1702)" },
  "xai":          { "error": "OAuth refresh failed for xai: fetch failed" }
}
```

## What this establishes

1. **`ctx.modelRegistry.getProviderAuth(id)` resolves live credentials** — `{ auth: { apiKey, headers }, source }`.
   `source: "OAuth"` for both logged-in providers.
2. **The credentials are actively managed, not read from a stale file.** `xai` failed
   *because pi attempted an OAuth refresh* and the sandbox had no network. That error is
   the evidence: pi owns token lifecycle, so anything borrowing a token inherits refresh
   and expiry as a real concern.
3. **`modelRegistry.complete()` exists** — an extension can run inference through pi's
   own resolved auth without ever handling a raw key.
4. **Usage has a defined route into pi's accounting**: a tool returning `usage` has it
   persisted on the result and counted in the footer, `/session`, and RPC session totals
   (`docs/extensions.md:2013`).

`isUsingOAuth("anthropic")` returning `false` while `source` is `"OAuth"` is an
inconsistency worth understanding before relying on either as a branch condition.

## What it does NOT establish

- That handing a borrowed token to a **separate FSD host process** is acceptable. It is a
  credential leaving the process that owns it, and pi's refresh cycle can invalidate it
  mid-flow. This probe says it is *possible*, not that it is *right*.
- That `complete()` accepts the shape FSD generators need (tool loops, structured repair,
  streaming). Unverified.
- Anything about a **spawned** harness run: a subprocess `pi` re-resolves its own auth from
  `auth.json`, so the double-login problem does not arise there. This finding is about the
  **extension** direction only.
