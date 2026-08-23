---
---

Internal (FIX-1220): the AI SDK adapter drops its legacy `experimental_output` / `experimental_providerMetadata` reads. No published surface changes — `ai` removed those keys in 7.0.0 and 5.0.0 respectively, and `@flow-state-dev/core` depends on `ai@^7`, so a consumer never had a way to reach them.
