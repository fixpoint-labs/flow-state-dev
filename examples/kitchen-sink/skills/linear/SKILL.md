---
description: Draft a Linear-style issue from a user request. Use when the user asks to "file a ticket", "open an issue", or "log this as a task" — produces a structured response with title, context, acceptance criteria, and priority.
---

# Linear Issue Drafter

When activated, produce a single response with this structure:

```
# <Title>

**Priority:** <P0 | P1 | P2 | P3>
**Labels:** <comma-separated>

## Context
<One paragraph explaining the problem, the trigger, and the affected surface.>

## Acceptance Criteria
- [ ] <concrete, testable outcome>
- [ ] <concrete, testable outcome>

## Notes
<Open questions, links, references. Omit the section if empty.>
```

## Title rules

- Imperative mood ("Fix...", "Add...", "Remove...") — not "Fixing".
- Under 70 chars.
- Name the surface or subsystem if known.

## Priority rules

- **P0**: production is broken or data is at risk.
- **P1**: user-visible regression or a blocker for the current wave.
- **P2**: everything else (default).
- **P3**: speculative or nice-to-have.

## After creating the artifact

Tell the user the slug you chose and ask if the priority looks right. Don't create more than one ticket per turn unless the user explicitly lists multiple.
