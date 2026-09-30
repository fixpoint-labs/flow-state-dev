---
flow: pr-triage
description: Receives the review-started hop. No subscribe of its own.
---

This seat does not subscribe to GitHub. It runs when the reviewer hops
here with `dispatcher({ flowKind, action, session })`.
