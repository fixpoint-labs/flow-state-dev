---
"@flow-state-dev/engine": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

What you read from FSD no longer names our internal issue tracker (FIX-2453). Editor hovers in every package, error messages and UI copy say what the code does instead of pointing at a ticket you can't open.

- **engine:** the store conformance suites (`createSessionStreamConformanceTests`, the request-store suite) drop the ticket suffix from their test titles, so an adapter's test report reads the behaviour under test. The error for two collections that share a storage prefix with conflicting isolation flags no longer ends in an issue id. No behaviour changes.
- **harness-manager:** the refusal for a malformed issue (`TRACKER_ISSUE_REFUSED`) uses `ENG-142` as its sample key.
- **shift-manager:** placeholder copy for surfaces that are not built yet says it arrives in a later release instead of naming an issue.

Docs: packages/core/README.md (the `keyedRouter` entry and the `assertStrictCompatible` note cite BP- ids: state the rule instead), packages/patterns/README.md (the workers section cites BP-011: say no handler wraps the worker), packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (the sample issue key `FIX-2165` becomes `ENG-142`, matching the refusal text).
