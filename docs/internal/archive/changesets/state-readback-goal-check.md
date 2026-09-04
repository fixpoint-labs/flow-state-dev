---
---

Internal (goal check): a real coding run is reconstructed from FSD state alone, and the
reconstruction is compared to the job the run was given (LAB-135).

**The gap.** Three layers now record what a coding run did — its messages, the files it touched,
the plan it kept — and nothing had checked whether what they record is *enough*. The two checks
that existed both already knew the file the run was told to write and searched the stored record
for that name, so a record that kept a **fraction** of a run passed: the fraction it kept was the
part they asked about. Nobody had put the question the other way round.

**The check.** `goals/harness-workstream/reconstructs-a-run-from-state-alone/` dispatches a real
run, hands a reader nothing but the shipped HTTP routes, and has it derive an account — files
touched and how each settled, in stream order; what the run said; what it thought its job was, or
that it kept none and how we can tell; every count each derivation actually saw. Only then does
the expectation appear. The reader is deprived by its **parameter shape** rather than by
instruction: its one input is a bound route reader, and an assertion checks mechanically over its
own source that it imports nothing else. The grader's parameter type removes the run's words, so
grading the model's prose is a compile error rather than a rule to remember.

**Eight assertions, each with a can't-tell branch.** An assertion whose set is empty fails and
names itself. Two arms report instead: a run that never planned, and a path that is absent while
the run reached for the shell — and if *every* expected path lands there, the run proved nothing
and the goal is inconclusive rather than green.

**Calibrated before it is trusted, on every invocation.** A model-free precondition derives a
known account from a checked-in state exactly, catches a deliberately lossy copy of it, and
breaks each assertion on purpose to confirm it reaches the verdict it should. If any of that
fails, no coding run is dispatched. Two of those cases exist because a mutation stayed **green**:
whole-segment path matching was unreachable until the fixture gained a name that a naive
`endsWith` would confuse, and one assertion read counts that could drift from the arrays the
others iterate.

**Two measurements worth carrying.** The run writes its to-do list as prose in its own messages
and invokes no plan tool through the in-process SDK path, so the plan half reports UNMEASURED —
by design it cannot fail the kill line, and it is filed as FIX-1185 rather than worked around.
And every run so far has called the shell with `Bash` absent from `allowedTools`, which is why a
missing path splits two ways instead of failing.
