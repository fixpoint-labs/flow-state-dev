---
"@flow-state-dev/claude-code": minor
---

New capability: `createWorkspaceAgentCapability` — a coding run whose files are resources (FIX-150).

`cwd` hands a run a directory. It does not put anything in it, and it does not bring anything back. This closes both ends: before the run, every mounted resource collection is laid into the directory; after it, what changed is reconciled back through `@flow-state-dev/workspace`, so a file something else changed while the run held it is reported rather than overwritten.

Paths a flush could not settle — conflicts, and files written outside every mounted collection — land in a `workspace-outcomes` collection keyed by run, readable over the resource route that already ships, alongside a status item saying how many there were.

The run is confined to its workspace by default (`contain`, on unless you turn it off). Three settings answering different halves: `settingSources: []` stops the run reading its configuration out of a directory whose contents your users write, the SDK's sandbox settings stop it writing outside the directory, and the worktree tools are taken out of its reach so it cannot relocate out from under the projection. Setting `settingSources` or `sandbox` explicitly wins over the default; disallowed tools merge.
