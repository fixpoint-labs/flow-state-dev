---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

**Breaking:** model strings now name a route with a colon, as in the AI SDK (`vercel:anthropic/claude-sonnet-5`, `openai:gpt-5.4`, or a `providers` key such as `triage:native`), multi-hop `gateway/provider/model` slash strings are rejected with an error naming their colon spelling, and `ParsedModelString` is now a discriminated union with no `"gateway"` kind (FIX-1495).
