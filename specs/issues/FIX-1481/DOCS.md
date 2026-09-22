# FIX-1481 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Four operations, no new page. Both changes are observable behaviour in a tool people read, so they
are documented; the org-level inventory row is not built here and gets no prose
([D2](DECISIONS.md#d2)). Voice traps for this topic: the word "powerful" around a debugging
surface, em-dashes as a default connector, and "read-only" used before it has been said what
read-only means here. The DevTool pages already say `resource`, `collection` and `scope` without
re-introducing them, so this prose may too.

## UPDATE · `apps/docs/docs/devtool/overview.md` · new subsection after "Child sessions"

### Task boards

The Tasks tab lists each board the session emitted, and one row per task: its id, its goal, its
status, who it is assigned to, the child session running it if there is one, and the last thing
that happened to it.

A task can also carry a short note about itself. Parking a task for review writes the reason it
was parked; a failed attempt that is going to be retried writes why it failed; resuming a parked
task replaces the note or clears it. Whichever of those wrote last, the row shows it, so a board
with a parked row says why without you opening anything.

A note is not the same as an error. A row that errored and stopped carries its error; a row
carrying a note is one somebody or something wrote an explanation on while the work was still
live. Both are on the row.

Two things to know when you read one. A note stays with the task until something replaces it, so a
task that failed, retried, and was then parked with no reason given still shows the failure text.
And the full task record is still one click away in the row's detail, which is the complete view
and is unchanged.

## UPDATE · `apps/docs/docs/devtool/debug-vs-client-state.md` · extend the list under "What the debug endpoint returns"

For each storage key the session touches, the debug response includes:

- The full state body (every field on the state schema)
- Content metadata
- Whether the resource may be written, and whether a model is offered a write tool for it
- The underlying resource definition, with its alias list
- A second copy showing the projection your `client.data` would produce

## UPDATE · `apps/docs/docs/devtool/debug-vs-client-state.md` · new section after "Aliases — when one resource has two names"

### Which documents an agent can write

Two settings decide whether a resource can be changed. `writable` decides whether code may write
it at all; the store refuses a write to a resource that sets it to `false`. `llmWritable` decides
whether a model is offered a write tool for it. Both default to allowing the write, so a resource
that declares neither is writable.

The Resources panel marks a resource read-only when both are shut. That is the same condition the
resource manifest uses to tell an agent whether it may write, so what you read in the panel and
what the agent was told about the same resource cannot drift apart.

A resource can be closed to the model and still open to code, which is a real configuration and
not a marked one. The panel shows both settings on the resource's row detail, so you can tell that
case from a resource nobody can write.

Nothing about where a resource came from produces the mark. A document loaded from a `references/`
folder is sealed by the convention that loads it, and a document one worker holds under a
read-only grant is sealed by that grant; both arrive as the same two settings and both get the
same mark.

If the panel shows no mark on anything, check the server version. A server that predates this
sends neither setting, and the panel shows no mark rather than guessing.

## UPDATE · `apps/docs/docs/workforce/documents-on-disk.md` · one paragraph at the end of "Moving a document into `references/`"

A document in `references/` is sealed on both doors, so the DevTool's Resources panel marks it
read-only. The same mark appears on any document a worker holds under a read-only grant, because
the two produce the same settings. See
[Debug vs client state](/docs/devtool/debug-vs-client-state#which-documents-an-agent-can-write).

## UPDATE · `packages/engine/README.md` · the debug surface paragraph

The server exposes a read-only debug surface at `/api/flows/sessions/:id/debug/resources` and
`/api/flows/sessions/:id/debug/resources/:ref`. Each response carries the full server-side state
for the matching storage keys alongside the projected client view, so a debugger can show you
exactly what `client.data` is dropping, and each entry reports the resource's `writable` and
`llmWritable` settings when they are declared. There are no write paths here; the endpoint cannot
mutate state.

## Publication ownership

FIX-1481 publishes these after checking them against the built panels, not as written. The task
board prose ships with PR-A, the three writability operations with PR-B. Nothing here duplicates
the DevTool overview's unchanged material or the documents-on-disk page's account of the
`references/` convention, both of which stay as they are. No page describes the org-level
inventory, and none is added: there is nothing to document until it exists.
