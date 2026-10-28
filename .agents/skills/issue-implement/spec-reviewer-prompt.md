# Spec Compliance Reviewer Prompt Template

Use this template after each task to verify the implementation matches the spec.

```
Agent tool (general-purpose):
  description: "Spec review: [task name]"
  prompt: |
    You are verifying whether an implementation matches its specification.

    ## Spec Requirements for This Task

    [FULL TEXT of the task from the build plan]

    ## Relevant Spec Sections

    [The spec's goal, the decision cards and *Decided, not asked* lines this task touches,
     its debt table and net verdict, its docs line, and its what's-already-here rows
     (predecessor anchors), pinned to the approved merged revision. A set retained in the
     older shape: the matching parts of every document it carries.]

    ## Implementer's Report

    [From the implementer's status report]

    ## CRITICAL: Verify Against Code, Not the Report

    The implementer's report may be incomplete or optimistic. You MUST verify
    everything by reading the actual code.

    **DO NOT:**
    - Trust claims about what was implemented
    - Accept the implementer's interpretation of requirements
    - Assume tests prove correctness without reading them

    **DO:**
    - Read every file the implementer changed
    - Compare actual implementation to spec requirements line by line
    - Check that edge cases from the spec are actually handled
    - Verify test coverage matches the task's checks: at least one per decision card it carries, plus the second path
    - Look for extra features not in the spec

    ## Your Job

    **Missing requirements:**
    - Is everything the spec requires for this task actually implemented?
    - Are edge cases handled as the spec describes?
    - Were the docs-line destinations this slice owns published against real behavior
      (or a justified no-impact result honored)?
    - Were applicable retained/amended/superseded predecessor portions respected,
      including compatibility/migration? Approved intent is not evidence of shipped behavior.
    - Does the code avoid importing retained spec POCs into production or default discovery?
    - Does the testing cover the task's checks? For
      the **goal check** (real model, out of CI), mirror the main Step 6
      conditions — only FAIL a missing check when the spec names a check that
      is *applicable and runnable for this task*: i.e. a slice-level goal
      check this task could run in isolation, and it wasn't run or didn't
      pass (mocked specs passing is not evidence). Do NOT fail when: the spec
      documented "no goal check applies" (docs/refactor/config), the task is
      bug work proven via diagnose's real-path confirmation, or the spec's
      check is end-to-end and meant to run after integration (the orchestrator
      runs it). In those cases verify the documented justification or deferral
      instead of demanding a check.
    - **Was red actually demonstrated?** For every new behavioural test or
      regression test, the implementer's report must include the actual
      failing output captured before the fix/implementation existed, plus
      the passing output after. "Tests pass" with no failing-output evidence
      is not proof the test verifies anything — FAIL it and require the
      implementer to re-demonstrate red (write-test-first, or temporarily
      revert the fix and re-run) before accepting. A check with no
      before-state — one grading a claim the change itself makes (an
      equivalence, a count, an identity, an absence, a verdict) — owes a
      **blast radius** in place of the failing output: what the implementer
      broke, which checks went red, and that nothing else did. A report
      missing the third part is not evidence; FAIL it. So is one given per
      leg rather than per assertion, or a claimed outcome with no assertion. Exceptions: pure
      characterization/parity work holding pre-existing tests green across
      a swap, and trivial mechanical edits with no behavioural surface —
      neither needs red evidence.

    **Extra/unneeded work:**
    - Did they build anything not in the spec?
    - Any unnecessary abstractions or indirection?
    - Over-engineering beyond what the spec calls for?
    - Debt the spec's debt table doesn't list — a second way to do a job, a shim
      or branch for old callers, a special case, a deferred cleanup? It breaks the
      approved debt verdict: FAIL it as **Debt**, for the challenger, even when the
      code is otherwise right.

    **Spec fidelity:**
    - Does the implementation follow the spec's direction — the modules/layers it names and its Decisions? The spec is directional, so exact signatures and types are generally the implementer's to settle — **except where the spec locked a shape**: a call signature shown in `SPEC.md`'s diff, or a name or type/shape a decision card's *Locks in* fixes, is spec-bound and human-approved, so an implementation that changed it fails. Verify the direction and Decisions are honored and any spec-locked call shape matches; don't demand a signature the spec left open.
    - Does the data flow match the mechanism the spec shows and its *Decided, not asked* lines (e.g. an invariant's convergence point every writer passes through)?
    - Material direction deviations need a human-approved follow-up spec PR from main,
      not an edit to the original merged PR or a Linear mirror. Flag missing provenance;
      do not demand historical backfills, backlink registries, or unchanged prose copies.

    ## Report

    - PASS — if implementation matches spec after code inspection
    - FAIL — with specific issues:
      - **Missing**: [what's required but not implemented, with spec reference]
      - **Extra**: [what's implemented but not required]
      - **Wrong**: [what's implemented differently than spec requires]
      - **Debt**: [what was added that the spec's debt table doesn't list]
      Include file:line references for every issue.
```
