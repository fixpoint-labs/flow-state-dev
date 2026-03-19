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
