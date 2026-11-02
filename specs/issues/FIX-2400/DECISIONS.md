# FIX-2400 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what (view, session or worker, and the open thread or task, in the
address) and the shared name (`SESSION_ADDRESS_PARAM`). It writes "replaceState and popstate"
and also names "Back does nothing" as a problem; those two pull apart, so D1 settles which.

<a name="d1"></a>
## D1 · A person's pick adds a Back step; a default or a fallback does not

| | Push on a pick, replace otherwise (chosen) | Replace only | Push on every change |
|---|---|---|---|
| Reload and links keep your place | yes | yes | yes |
| Back returns to what you had open | yes | no, it leaves the app | yes |
| Opening the app adds a step | no | no | yes: the default teammate, the latest session |
| A dead id leaves a step to a broken screen | no | no | yes |

- **Because:** Back is the problem the issue names, and replace-only cannot fix it: with no
  pushed entry, `popstate` never fires inside the app.
- **What pushes:** picking a session, a view, a teammate, a thread or a task, and closing one.
  **What replaces:** the app's own default (the first teammate, the assistant's latest session),
  a newly created session the app opens for you, and dropping a dead id.
- **On Back,** the app reads the address again and draws it, through the same path as a load. A
  dead id there falls back the same way.
- **Locks in:** an app's screen is a function of its address at load and on Back. **Kitchen
  Sink's harness modes** still replace only; aligning them is outside this issue.

<a name="d2"></a>
## D2 · Each app owns its address; only the parameter name is shared

| | Each app's own reader (chosen) | A shared hook in a package |
|---|---|---|
| Fits what each app names | yes | needs a schema per app anyway |
| New package code | none | a hook, its docs and tests, in a package no app reason owns |
| Links between apps agree on "session" | yes, through the devtool constant | yes |

- **Because:** the three addresses name different things (a view and a pane's task; a worker and
  a popup's task; one session whose flow the server knows). What they share is the name for "the
  session this page shows", and that already lives in devtool. The issue says the same:
  "Reusing devtool's param name keeps links interchangeable without new package code."
- **Not a breach of FIX-2369's ER-3** (one implementation per need): each app's need differs past
  the name. A fourth app wanting the same reader moves it to a package then.
- **Locks in:** no package API. Labs still import no code from each other.

## Decided, not asked

- **E1 · Kitchen Sink names only `session`.** On load it reads the session's own record
  (`sessions.get`) for its flow and opens the assistant or the picked panel from that, so a link
  never carries a flow name that could disagree with the server.
- **E2 · `e2eSession` goes.** `?session=` works in every build, and a named session is never
  replaced by the latest or a new one, which is what the test gate was for. The fixture switches;
  no production build reads a test-only parameter any more.
- **E3 · Claude Code-style `view` is written only when no session is open.** An open session's
  mode decides its view; writing both would let them disagree.
- **E4 · `task` in the Claude Code-style lab names the task open in the session's own pane**: the
  board's open thread in threads mode, the task sheet in session mode. A session has one pane.
- **E5 · Teammates' `session` while a task is open** is the conversation the task was filed in,
  which is what the popup reads. Off a task, the worker names the conversation.
- **E6 · An id the app can't find is dropped from the address**, by replace, once the app's list
  has loaded, never before: a slow first read is not a dead id.
- **E7 · Changeset:** none. All three are private.
