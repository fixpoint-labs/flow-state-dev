---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) now counts a review
round only for a dispatch that actually ran (LAB-111).

A review round is now counted **after** the revision dispatch settles, and only
when it settled `completed`. It was counted before the run, so anything that
broke the *runner* still spent a round: an uninstalled harness, a workspace that
could not be cut, or a credential that never reached the agent process. The last
is the live one — the Agent SDK resolves and the run starts, but no credential is
inherited by the child, and the terminal result comes back `subtype: "success"`
with `is_error: true` and `Invalid API key · Please run /login`, which settles
correctly as a failed dispatch. No agent read the reviewer's comment and no code
was written, yet the ledger recorded a handled pass.

The cost was not bookkeeping. The round budget is the loop detector that parks a
stuck review, so a round spent by a non-event is a round the recovery does not
get once the credential is fixed: twelve failures to authenticate escalated as
though twelve passes had been made over the same comments. A dispatch that
completed and pushed nothing still counts — that is an attempt that changed
nothing, not an attempt that never happened.

The escalation a failed dispatch produces is corrected separately, in LAB-112.
