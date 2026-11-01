# FIX-2417 · Decisions

[Spec](SPEC.md) · **Decisions**

All three are engineering calls, recorded so review can disagree with them. None is asked.

<a name="d1"></a>
## D1 · The header names the session's own `workerId`

| | |
|---|---|
| **Instead of** | The roster's display `name` (a second roster read in the page) · the rail row's title (`FlowNavigator` does not pass it) · the picked flow kind (`coordinator`, `agent`, which names the flow, not the worker) |
| **Because** | It is on every worker session already, readonly, and it is the id the roster and the rail show, so the header matches what was clicked. No new read, no package change |
| **Locks in** | Until the session detail loads, only the kind shows. If KS starts showing roster display names, the header should follow, through the same roster read |

<a name="d2"></a>
## D2 · Only lines the user didn't write render as markdown

| | |
|---|---|
| **Instead of** | Every line through markdown |
| **Because** | It matches the direct conversation, where `Message` draws the user's text pre-wrapped and the assistant's through `MessageResponse`. A user's `*` or `#` should read as typed |
| **Locks in** | A line is the user's when it has no `agentName` and its role is `user`, the same rule that labels it |

<a name="d3"></a>
## D3 · The model bar stays empty on a picked panel

| | |
|---|---|
| **Instead of** | Naming a model in `ClientDataBar` on a picked panel, as the issue's problem line mentions |
| **Because** | The page omits it on purpose: the bar's model is the assistant's own preference, and a picked coordinator or worker answers through its model intents, so naming the assistant's pick there would be wrong. The issue's desired outcome does not ask for it |
| **Locks in** | Showing the model a worker actually runs belongs with the open "model shown on running coding tasks" follow-up, as a package read, not here |
