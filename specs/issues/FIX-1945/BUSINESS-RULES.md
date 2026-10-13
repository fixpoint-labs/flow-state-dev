# FIX-1945 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. "The worker" includes a coordinator.

## Taking a note

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A person gives a worker a note meant to last, on a turn they started | The worker adds a rule, and the tool posts a visible line in the conversation naming the rule and the count ("3 of 20") | CI · goal check |
| BR-2 | A person asks the worker to change or drop a rule | The worker changes or removes it; a visible line names the old and new text | CI · goal check |
| BR-3 | A person asks "what are your rules?" | The worker answers from the list it reads every turn; `rules/read` returns the same list with numbers | CI |
| BR-4 | A turn was not started by a person's own message: a task turn, a coordinator's post to a delegate, a delegate's answer reaching a coordinator, a task-ended notice, a workstream opening | The rule tools are not offered on it. The rules still apply. A person answering a worker's question inside a task session also gets no tools: that answer is task input | CI, one per entry point |
| BR-5 | A rule tool runs and its write fails | The tool returns the failure; no line claims the rule was saved | CI |

## Every later turn

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A worker with rules starts any turn for that person, in any session, person or task | The rules are in its prompt after its own instructions, team instructions and packages, numbered | CI · goal check |
| BR-7 | A worker has no rules for this person | No rules text is added at all | CI |
| BR-8 | A rule was added, changed or removed, by the worker or on the page | The next turn reads the new list. No restart, no new session needed | CI · goal check |

## Whose rules they are

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | Two people use the same standard worker or the same coordinator | Each has a separate list. Neither sees, applies or edits the other's | CI · goal check (`person-scoped`) |
| BR-10 | One person gives a note to the coordinator | Only the coordinator follows it; that person's other workers do not | CI |
| BR-11 | A person forks a worker | The fork starts with no rules | CI |
| BR-12 | A client writes to the rules record directly through the generic resource API | Refused: the record allows client reads only. Rules change only through the rule tools and the rules action, both behind one validator | CI |
| BR-13 | Seeded skills are refreshed for a worker, or its file declares any skill | The rules are untouched and never offered as a skill: they are not in the skills collection | CI |
| BR-13a | A person's own worker is fired, then hired again under the same id | It finds that person's old rules. The page shows them | CI |
| BR-13b | A person's own worker is moved to a different worker flow | Its rules stay with the old flow and the page says the list is empty. Known limit, documented | CI |
| BR-14 | A page request names another person or a worker not on the caller's roster | Refused. The person is the signed-in identity, never a field in the request (BP-031) | CI |

## Editing, limits and conflicts

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A change or remove names a number whose current text differs from the quoted text | Refused with the current list; nothing changes. The worker re-reads and retries or asks | CI |
| BR-16 | An add would make the 21st rule | Refused, naming the cap and the count. The worker tells the person and asks which rule to merge or drop | CI |
| BR-17 | A rule's text is over 300 characters, empty, or more than one line | Refused with the reason. The page refuses the same | CI |
| BR-18 | The worker and the page edit at nearly the same time, adds included | Every write carries the version of the list it read. One wins; the other is refused with the current list, never a silent overwrite or a second add past a list it did not see | CI |
| BR-19 | A person adds, edits or deletes a rule on the Shift Manager page | Same limits and checks as the tools. The conversation is not interrupted; the next turn reads it | CI · browser check |

## Shift Manager

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A person opens a worker on their roster that runs on the built-in `agent` flow, or the Shift Coordinator view | They see that worker's rules for them: text, when added, and a link to the conversation it came from (or "added here") | Browser check |
| BR-21 | A worker has no rules for them | The view says so and offers to add one. It is not under "not there yet" | Browser check |
| BR-21a | A roster worker runs on a custom hireable flow | No Rules view; its row says this worker's flow doesn't keep standing rules. A custom flow gets rules by composing the agent flow, not by a new contract | Browser check |

## Failure taxonomy

Every refusal is non-fatal: the turn continues, and the worker tells the person what happened.
A failed rules read on a turn is logged and the turn runs without rules, saying so in the
trace; it never fails the person's turn. Nothing retries on its own.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): a note given in session 1 governs
sessions 2 and 3 on a real model, on the coordinator and on an ordinary worker, across a
server restart; a change and a removal the person asks for in words, and an edit made the way
the page makes it, take effect on the next session; a second person is unaffected; and the same run fails `next-session-follows`
under `GOAL_CONTROL=no-rules-context`.
