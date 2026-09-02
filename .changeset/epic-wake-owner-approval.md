---
---

Internal (workflows): `epic-wake`'s approval scans count the configured owner's own approving comment or review even though the owner is the PR's author.

Both scouts — the epic-gate scan and the per-issue spec-PR scan — were told an approval counts only from "a human who is not the PR author". Every PR in this repo is opened under the owner's GitHub login, so that rule excluded the owner by construction: an "Approved. Lets proceed." from the owner on their own spec PR read as a self-approval and released nothing. The author exclusion exists so a worker cannot approve its own PR; the owner is not a worker.

Both prompts now name the configured owner as the one login whose approval counts as author. Every other login keeps the exclusion, bots never count, and with no owner configured the rule stands as it was. The gate's hold log also names an `epic approved` label whose applier could not be read when no earlier approval was recorded to carry. Pinned by two cases in `verify.mjs`.
