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

    ## Your Job

    Once clear on requirements:
    1. Read the relevant existing code to understand the area
    2. Implement exactly what the spec describes for this task
    3. Write tests following the spec's Testing Strategy section
    4. Run typechecks and tests for affected packages:
       ```bash
       pnpm --filter <package> typecheck
       pnpm --filter <package> test
       ```
    5. Commit your work with a conventional commit message
    6. Self-review (see below)
    7. Report back

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
    - Files changed
    - Self-review findings (if any)
    - Concerns or blockers (if any)

    Use DONE_WITH_CONCERNS if you completed but have doubts.
    Use BLOCKED if you cannot complete. Use NEEDS_CONTEXT if missing information.
```
