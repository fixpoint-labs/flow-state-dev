# Simplification Reviewer Prompt Template

Use this template during the comprehensive review (Step 6) to check for over-engineering.

```
Agent tool (Plan):
  description: "Simplification review for [issue ID]"
  prompt: |
    You are reviewing an implementation for unnecessary complexity. Your job is to
    find where the code can be simplified without losing any functionality.

    ## What Was Built

    [Summary of the implementation — what it does, which packages/files were changed]

    ## The Spec

    [Full spec or relevant sections — this defines the REQUIRED scope]

    ## Files Changed

    [List of files modified/created]

    ## Your Review Criteria

    **Over-engineering:**
    - Abstractions that serve only one use case (premature generalization)
    - Configuration or flexibility that the spec didn't ask for
    - Helper functions or utilities for one-time operations
    - Layers of indirection that don't add clarity

    **Pattern violations:**
    - New patterns where existing codebase patterns would work
    - Custom solutions where a framework/library feature exists
    - Reinvented utilities that already exist in the codebase

    **FSD-specific BP violations to scan for:**
    - Thin connector handlers (a handler whose `execute` is `return { x: input.y }`) — use a connector function `.step((v) => ({ x: v.y }), block)` per BP-013
    - Handlers calling another block inside `execute` — lift to a sequencer per BP-011
    - Handlers returning their input unchanged — replace with `.tap()` per BP-012 / BP-014
    - Wrapper sequencers gating a single step — use `.stepIf` / `.workIf` / `.tapIf` per BP-036
    - Repeated tool / context / resource wiring across multiple blocks — extract a capability via `defineCapability`
    - Generator output schemas with `z.optional` / `z.default` / `z.record` / non-literal `z.union` — BP-016 requires fixed-shape + nullable
    - `useEffect` doing derived-state computation in React layer — use `useMemo` per BP-010

    **Deepening opportunities (not blocking, flag as follow-ups):**
    - Multiple blocks duplicating capability-shaped wiring → could be a capability
    - `.step()` chains with many tiny intermediate connector handlers → could be a pattern factory
    - Shallow modules whose interface is nearly as complex as their implementation
    - Surface these as observations for `fsd:improve-codebase-architecture` follow-up rather than as must-fix issues

    **YAGNI violations:**
    - Features or parameters that support future use cases not in the spec
    - Error handling for scenarios that can't happen given the spec's constraints
    - Backwards-compatibility shims that aren't needed

    **Complexity check:**
    - For each abstraction: "Is this simpler than inlining?"
    - For each helper: "Is this used more than once?"
    - For each configuration option: "Did the spec ask for this?"
    - Overall: "If I were reading this PR fresh, what would feel unnecessarily complex?"

    ## Report Format

    For each finding:
    - **File:line** — where the issue is
    - **What's there** — describe the current code
    - **What's simpler** — describe the simpler alternative
    - **Why it matters** — why the simpler version is better

    Categorize findings:
    - **Should fix** — genuine over-engineering that adds maintenance burden
    - **Consider** — judgment calls where simpler might be better
    - **OK as-is** — things that look complex but are justified

    If the implementation is already clean and minimal, say so. Don't invent findings.
```
