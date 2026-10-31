# FIX-2364 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what (four behaviours) and, like FIX-2334, leaves placement to the
Architect. FIX-2334's D1 already placed default text: "later default-prompt text joins this
layer as a line, not a second block". So D1 here is only the words.

<a name="d1"></a>
## D1 · One rule in the default layer, replacing the one-line tool-use rule

| | Replace the line (chosen) | Add a second line beside it | A capability apps add through `uses` | Each app's files |
|---|---|---|---|---|
| Every app and every hired worker gets it | yes | yes | only apps that add it | no |
| One place says how a worker uses its tools | yes | two overlapping rules | two ways in | many |
| New mechanism | none | none | a second prompt path, which C1 refuses | none |

- **Because:** the old line is the first half of the same rule. Keeping both says "use your
  tools" twice in different words.
- **Asking stays allowed.** The rule names what only the user can answer (a preference, their
  decision, a fact no tool reaches) so a worker that needs one still asks, once.
- **"When your tools can't reach it, say so."** This is the honest end of the PR-review case
  until FIX-2361 lands: the worker can't see another task's branch today, and should say that
  rather than ask for a paste.
- **Locks in:** fixed framework text, no setting. Composable in the FIX-2268 sense: nothing goes
  into the generator or core; an app that wants other words registers its own worker flow.

## Decided, not asked

- **E1 · The constant keeps its name** (`TOOL_USE_RULE`), so its tests and readers don't churn.
- **E2 · Names no tool**, as FIX-2334's E4 says: workers hold different tools.
- **E3 · "The user"**, as the issue writes it; the identity block already says "the people you
  work with" for the role.
- **E4 · No new export.** FIX-2334's review kept the layer unexported until a second flow needs it.
- **E5 · The check uses a hired worker with no instructions and no file tools**, not a lab
  worker: the lab's `WORKER.md` files already say "look it up", and a worker with file tools
  looked on the old wording too (prototyped, 3 of 3), so either would pass with or without this
  rule.
- **E6 · The PR-review scripted run waits for FIX-2361.** The issue's interim version ("tries its
  tools, never asks for the diff") is what the new leg checks, on a PR the worker can't see.

## How it got here

- Drafted 2026-10-31 with the build prototyped beside it, to check the control fails before
  the check is proposed (see the build PR for the runs).
