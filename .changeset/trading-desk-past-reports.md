---
---

Trading Desk: add a **Past Reports** surface to the private
`@flow-state-dev/example-trading-desk` example. A TopBar nav toggle switches
between the Desk and a Past Reports list of prior runs (newest-first, with PM
decision + status chips); opening a row re-renders the stored thesis from
persisted state with zero model spend. Internal-only — no publishable package
surface changes. Persistence remains the `developmentOnly: true` filesystem
store, so history does not survive an ephemeral/serverless redeploy.
