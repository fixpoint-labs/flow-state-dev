---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Views: a block a screen watches, at the scope its data lives in, with no session at user or org scope (FIX-2623).

- **core:** `defineView({ scope, block, inputSchema?, key?, description? })` declares a view, and `defineFlow({ views: { name: view } })` installs it. `scope` is `"session"`, `"user"` or `"org"`. The block must declare an `outputSchema`; `defineView` refuses one that doesn't (or declares `z.any()` / `z.unknown()`), so `ViewOutput<typeof view>` is the answer's type and never `unknown`. `ViewInput<typeof view>` is its input. With `key: (row) => string` the answer is a list whose rows have distinct string keys. `defineFlow` refuses a `views` entry `defineView` didn't make.
- **engine:** `POST /api/flows/:flow/views/:name` runs a user or org view and `POST /api/flows/:flow/:sessionId/views/:name` a session view, each with `{ input }`, answering `200 { output, topics }`. A user or org view runs with no session: none is loaded, made or stored, the caller's user and org come from the flow's own sign-in, and a block that reaches for `ctx.session` fails the call with `422 view_no_session`. A session view runs on a session that exists and can't make one. A view writes nothing (`409 read_only`) and calls no model: a generator, or any model the view resolves, fails the call with `422 view_model_call`. Compute a model's answer in an action and read it in the view.
- **engine:** `topics` names the change topics of what the view's run read (the session's, the user's, the org's), deduped and sorted. The engine records the reads; nothing about a view's dependencies is declared. Listen to those topics with `client.subscribe` or `client.live` to stay current.
- **engine:** once any flow you register declares a view, every resource write publishes a change notice on its scope's topic, whichever flow writes it, so a view's watcher hears a change to anything the view read.
- **engine:** a flow's `reads` now run through the same runner, so a read also refuses a model call.

Docs: packages/core/README.md (`defineView` and a flow's `views`; `ViewOutput` and `ViewInput`; the output-schema rule; `key`), packages/engine/README.md (the two view routes, their answer and refusals, the publish rule once a host has a view), a new apps/docs page "Views" (what a view is, the three scopes, no session at user or org, no writes and no model calls, `topics` and staying current, keyed rows), apps/docs/docs/api/core.md and apps/docs/docs/api/engine.md (the same, as reference). The read and `derived` pages retire when reads and `derived` are removed, in a later release.
