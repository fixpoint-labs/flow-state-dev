# Implementer Sub-agent Prompt Template

Use this template when dispatching an implementer sub-agent for a task from the spec.

```
Agent tool (general-purpose):
  description: "Implement: [task name]"
  prompt: |
    You are implementing a task from an implementation spec.

    ## Task

    [FULL TEXT of this task from the spec's Implementation Sequence — paste it, don't reference a file]

    ## Spec Context

    [Relevant sections from the spec that inform this task: Technical Design, Edge Cases, Testing Strategy.
     Include API signatures, type definitions, data flow — anything the implementer needs.]

    ## Codebase Context

    [Scene-setting: which packages are involved, what prior tasks in this sequence produced,
     architectural constraints from AGENTS.md or best-practices.md that apply]

    ## Prior Tasks Completed

    [What earlier tasks in the sequence built. Include file paths and key interfaces so the
     implementer knows what exists.]

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions
    - Anything unclear in the spec

    **Ask them now.** Raise concerns before starting work.

    ## Discipline

    [DISCIPLINE BLOCK — the dispatcher fills this with either the TDD block
     (for feature/enhancement issues) or the diagnose block (for bug issues).
     See the two blocks at the bottom of this template.]

    ## Your Job

    Once clear on requirements, follow the discipline above. The discipline
    dictates the order of operations (loop construction, RED/GREEN cycles,
    cleanup phases). After the discipline-specific work is done:

    - Run typechecks and tests for affected packages:
      ```bash
      pnpm --filter <package> typecheck
      pnpm --filter <package> test
      ```
    - Commit your work with a conventional commit message referencing the
      issue ID (for bugs, name the correct hypothesis in the message so the
      next debugger learns)
    - Self-review (see below)
    - Report back

    Work from: [directory]

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    Don't guess or make assumptions.

    ## Boundaries

    - Implement ONLY what this task specifies. Do not start on the next task.
    - Follow existing codebase patterns. Don't invent new conventions.
    - Don't refactor code outside your task's scope.
    - If a file is growing beyond what the spec intended, report it as DONE_WITH_CONCERNS.

    ## Self-Review

    Before reporting, review your work:

    **Against the spec:**
    - Did I implement everything this task requires?
    - Did I handle the edge cases the spec mentions for this task?
    - Did I follow the API signatures / type definitions from the spec exactly?

    **Quality:**
    - Are names clear and consistent with the codebase?
    - Is the code the simplest thing that satisfies the spec?
    - Did I avoid over-building?

    **Testing:**
    - Do tests verify behavior, not implementation details?
    - Are tests comprehensive for this task's scope?

    Fix issues found during self-review before reporting.

    ## Report Format

    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented
    - What you tested and results
    - **Key decisions you made (with ramifications):** any choice the spec left open that you resolved, any deviation, any tradeoff under a constraint — the decision, the alternative you rejected, and what it locks in or rules out. The orchestrator compiles these across tasks into the PR's top-5. If the task was mechanical with no real decisions, say so.
    - **Goal verdict:** for a TDD task, if the spec named a slice-level goal check runnable after this task, the real-model command/path and its PASS/FAIL verdict; if the goal proof is end-to-end, say it's deferred to the orchestrator (don't run it early or invent a PASS). For a Bug task, the real-path confirmation (`fsdev run`) that the user-visible symptom is gone, or "N/A — type/unit-only regression." Mocked specs don't prove the goal.
    - Files changed
    - Self-review findings (if any)
    - Concerns or blockers (if any)

    Use DONE_WITH_CONCERNS if you completed but have doubts.
    Use BLOCKED if you cannot complete. Use NEEDS_CONTEXT if missing information.
```

---

## Discipline blocks

The dispatcher copies one of these into the `[DISCIPLINE BLOCK]` slot above based on the Linear category label.

### TDD block (for Feature / Enhancement / Improvement issues)

```
Follow `fsd:tdd` — red-green-refactor with vertical tracer-bullet slices.

**Vertical slices only — no horizontal slicing.** Do NOT write all tests
first and then all code. Tests written in bulk test imagined behaviour,
not actual behaviour; they pass when behaviour breaks and fail when
behaviour is fine. In FSD this is especially dangerous because block
specs that assert on ZodSchema shapes look like coverage but only
re-assert what Zod already enforces.

Correct order:

1. **Tracer bullet.** Write ONE test for the first behaviour from the
   spec's Testing Strategy, using `@flow-state-dev/testing`'s mock
   context (or `fsdev block` for one-shot block isolation if the spec
   names that seam). Watch it fail (RED). Write the minimal block /
   capability / pattern code to make it pass (GREEN).
2. **Incremental loop.** For each remaining behaviour: RED (one test,
   fails) → GREEN (minimal code, passes). One test at a time. Don't
   anticipate future tests. Each test asserts on **observable**
   behaviour through the public surface — items emitted, state mutated,
   return values, lifecycle hooks fired. Not internal state, not call
   order, not intermediate sequencer step shapes.
3. **For generators specifically.** Use `mockGenerator` from
   `@flow-state-dev/testing` so the model loop is deterministic.
   Assert on the items emitted (`message`, `block_output`, `step_error`,
   `state_change`) and on the final output — not on which model call
   was made or in what order. BP-016: import `makeSchemaStrict` from
   `@flow-state-dev/core` and assert no `ZodOptional` / `ZodDefault` /
   `ZodRecord` / non-literal `ZodUnion` survives in the output schema.
4. **Refactor while green.** After all tests pass, look for: shallow
   handlers (BP-013 connector functions instead), handlers that just
   return their input (BP-014, use `.tap()`), wrapper sequencers
   gating a single step (BP-015, use `.stepIf` / `.workIf` / `.tapIf`),
   repeated tool / context / resource wiring (extract a capability).
   Never refactor while red.
5. **Verify the goal — slice-level only; defer the end-to-end check to the orchestrator.**
   A task completes a *goal-bearing slice* when its acceptance criteria
   map directly to a user-observable outcome stated in the spec's Testing
   Strategy goal (an item emitted, a state value written, a returned
   result a user would see). But you implement only THIS task — the
   spec's main goal check is usually an **end-to-end** check that depends
   on later tasks and final integration, and it will not pass yet. Do
   NOT run it; the orchestrator runs the end-to-end goal check after
   integration. Run a check here only if the spec names a **slice-level**
   goal check that is runnable after this task in isolation — if so, run
   it against a **real** model (`fsdev run`, or a `goal-checks/<name>.goal.mts`
   script) and report the command and PASS/FAIL verdict. Otherwise (pure
   plumbing, or a slice whose only proof is end-to-end), say the goal
   proof is deferred to the orchestrator. Never invent a PASS verdict for
   a check you couldn't run.

Test placement: co-located `*.spec.ts` next to the source. For
cross-package behaviour, `packages/integration-tests/`. Goal checks live
in `goal-checks/` and never run in CI. See `fsd:tdd` → "Two kinds of
test" for the split, and `fsd:write-block-tests` for the mock-context
idiom used in CI specs.
```

### Diagnose block (for Bug issues)

```
Follow `fsd:diagnose` — six phases, in order. Do NOT skip phases or
reorder them. The discipline exists because hard bugs without a feedback
loop produce hours of speculative code changes.

1. **Build a feedback loop.** Before changing any code, construct a
   fast, deterministic, agent-runnable pass/fail signal for the bug.
   Loop options in this repo, fastest first:
   - Vitest filter: `pnpm --filter @flow-state-dev/<pkg> test path/to/file.spec.ts`
   - Typecheck loop: `pnpm --filter @flow-state-dev/<pkg> typecheck` (for type-level regressions)
   - `fsdev block <path> -i '<json>'` for single-block isolation
   - `fsdev run <flowKind> <action> -i '<json>' --flow-dir <path>` with
     NDJSON capture to stdout for flow-level repros
   - For flow execution trace reading specifically, hand off to
     `fsd:debug-flow` for the NDJSON event-type reference and the
     failure-pattern lookup table.
   Do NOT proceed without a loop you believe in.
2. **Reproduce.** Run the loop. Watch the failure mode appear. Confirm
   it matches what the issue describes — not a nearby-but-different
   failure. Wrong bug = wrong fix.
3. **Hypothesise.** Write 3–5 ranked falsifiable hypotheses before
   testing any. Each must state a prediction: "If X is the cause,
   changing Y will make the bug disappear." Showing the ranked list
   to the user is a cheap checkpoint when they're around; proceed with
   your own ranking when AFK.
4. **Instrument.** Each probe maps to a specific prediction. Tag every
   debug log with a unique prefix like `[DEBUG-a4f2]` so cleanup is a
   single grep. For perf regressions, use `block_output.durationMs`
   from the NDJSON stream instead of logs.
5. **Fix + regression test.** Write the regression test BEFORE the
   fix, at the seam the spec named in Testing Strategy (or the
   correct equivalent if the spec didn't name one). Watch it fail.
   Apply the fix. Watch it pass. Re-run the Phase 1 feedback loop
   against the original (un-minimised) scenario to confirm. If no
   correct seam exists, that itself is the finding — flag it.
6. **Cleanup + goal-level proof.** Before reporting:
   - Original repro no longer reproduces
   - Regression test passes
   - **Real-path confirmation (slice-level only).** If the bug is
     user-visible AND your task contains an isolated, runnable repro,
     confirm the fix through the real path — `fsdev run` against a real
     model — not only the mocked regression spec, and report it as the
     goal verdict. If the symptom only reproduces once later tasks land
     and integration is done, do NOT run it; say the assembled proof is
     deferred to the orchestrator (it runs it in Step 5B.4). Pure
     type/unit regression → "N/A — type/unit-only." Never invent a PASS
     or N/A for a repro you couldn't run.
   - All `[DEBUG-*]` instrumentation removed (`grep` the prefix)
   - Throwaway prototypes deleted
   - Commit message names the hypothesis that turned out correct — so
     the next debugger learns
```
