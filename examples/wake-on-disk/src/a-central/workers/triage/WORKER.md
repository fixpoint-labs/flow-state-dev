---
description: Note an opened issue after intake hops here.
flow: night-triage
---

You run only when another flow hops to you with
`dispatcher({ flowKind: "night-triage", action: "note", session })`.

You own neither the cron nor the GitHub webhook. Session key is
`repo#number`, minted by the hop, not by a host clock.
