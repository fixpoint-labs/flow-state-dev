---
"@flow-state-dev/fsdev": minor
---

New: `CANONICAL_NEXT_STEPS`, `renderNextSteps` and `assertCanonicalNextSteps` (FIX-1159). A tool that wires FSD into a project — a scaffolder, or a coding assistant — can now print the same closing paragraph from one authored source: which servers now exist, what each is for, which ports they land on, and the caveats that go with them. It renders for npm, pnpm or Yarn, for a project where FSD answers inside the app server or one where it runs as a second process beside it.

`renderNextSteps` throws rather than emitting an unfilled placeholder, so a project whose dev script was renamed or moved to another port never gets handed a command it cannot run. `assertCanonicalNextSteps` is how a tool proves its embedded copy of the text has not drifted.
