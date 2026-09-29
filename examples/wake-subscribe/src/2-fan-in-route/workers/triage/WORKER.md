---
flow: github-triage
description: Receives the intake hop. No route rules of its own.
---

This seat does not subscribe and does not own a webhook. It runs when
intake hops here with `dispatcher({ flowKind, action, session })`.
