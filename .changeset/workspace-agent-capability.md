---
"@flow-state-dev/claude-code": minor
---

New capability: `createWorkspaceAgentCapability` — a coding run whose files are resources (FIX-150).

`cwd` hands a run a directory. It does not put anything in it, and it does not bring anything back. This closes both ends: before the run, every mounted resource collection is laid into the directory; after it, what changed is reconciled back through `@flow-state-dev/workspace`, so a file something else changed while the run held it is reported rather than overwritten.

Paths a flush could not settle — conflicts, and files written outside every mounted collection — land in a `workspace-outcomes` collection keyed by run, readable over the resource route that already ships, alongside a status item saying how many there were.

The run is confined to its workspace by default (`contain`, on unless you turn it off). Three settings answering different halves: `settingSources: []` stops the run reading its configuration out of a directory whose contents your users write, the SDK's sandbox settings stop it writing outside the directory, and the worktree tools are taken out of its reach so it cannot relocate out from under the projection. Setting `settingSources` or `sandbox` explicitly wins over the default; disallowed tools merge.

**What auto-discovery mounts, and what it now leaves alone.**

- **External collections are skipped.** They answer the same duck-type an ordinary collection does — a `pattern` and a `list` — and are projectable through neither. Their `list` is paged, so hydrate iterating it threw before the run started, and they carry no mutators for a writable mount to flush through. Skipped by their brand, with a warning naming the collection.
- **Parameterized patterns are skipped.** A pattern's prefix stops at its first parameter, so `data/[topic]/observations` mounted at `data` and its entries came back addressed as `react/observations`. Those patterns need an object key, so the flush threw on the string and the run finished having saved nothing. Skipped with a warning, until a mount can carry the parameters it would need.

**A collection that cannot be written fails the run.** A flush rejects for two opposite reasons, and both were being reported as "the workspace could not be read". One is: the projection refused to decide anything because the directory was unreadable, so the run's files are still where the run left them. The other is a collection read, write or delete that failed — the run's work never leaving a directory that is about to be thrown away. Only the first is swallowed now.

An auto-discovered collection needs state the projection can supply on its own. It sets `path`, `hash` and `updatedAt` because it maintains them; a schema with another required field and no default makes `getOrCreate` reject, and that rejection now reaches the caller instead of being reported as a read failure.

**A failed hydrate leaves no workspace resident.** The projection was registered before hydrate ran, and reconcile is only reached through the agent's `onErrored` or the tap after it — both downstream of hydrate. A hydrate that threw left a projection and its baseline held forever, once per attempt. Registration moved after.

**`allowWrite` is not a fence.** The `contain` documentation described `filesystem.allowWrite` as what stops a run writing outside its workspace. The Agent SDK's own types call it "additional paths to allow writing within the sandbox", merged with what its permission rules already allow: it is additive. `enabled` and `allowUnsandboxedCommands: false` are the constraint; naming the root adds it to what the run may write, because the root is not the process's own directory.
