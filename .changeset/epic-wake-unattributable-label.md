---
---

Internal (workflows): an `epic approved` label the wake can see but cannot attribute no longer revokes the epic's objective gate.

**The defect.** `epic-wake` verifies the approval label's *provenance* — it reads the PR's `labeled` timeline, takes the most recent event naming the label, and requires the actor to be the configured owner. That check is correct, and its fail-closed default is correct: an approval you cannot attribute is not an approval. But the schema reported one boolean, `approvedByLabel`, for two different facts — "the label is not there" and "the label is there and I could not read who applied it" — and the gate then derived `epicApproved` from the live scan alone, consulting the coordinator's carried `epic.approved` only when no scan ran at all.

In an environment that exposes a PR's labels but not its timeline (no events method on the MCP GitHub surface, REST events denied), the provenance read fails on *every* wake. So `approvedByLabel` came back false forever, and an epic whose owner had signed the objective off days earlier re-locked itself on each wake — holding every sub-issue, dispatching nothing, with the label sitting on the PR the whole time. Fail-closed is the right posture for an epic nobody approved; it is the wrong way to *revoke* one that was already recorded.

**The fix.** The gate scan now reports `labelPresent` alongside `approvedByLabel` — is the label on the PR right now, whoever put it there, read off the current label list rather than the timeline. A carried `epic.approved: true` survives exactly one gap: the label is still present and the only unknown is who applied it. Every other property is unchanged. Removing the label still revokes the gate, because `labelPresent` goes false. An epic that was never approved has no carried `true` to survive, so an unattributable label can never manufacture a sign-off. A human `CHANGES_REQUESTED` still outranks everything.

Covered by four cases in `verify.mjs` — carried approval survives an unattributable label; label removal revokes it anyway; an unattributable label alone approves nothing; a change request outranks the carried approval — each verified red against the unfixed derivation.
