# Wave <Letter> - <Title>

## 1. Objective

State the business and technical outcome this wave must produce.

## 2. Canonical inputs

List the exact source docs used as authority for this wave.

## 3. Scope

### In scope

- Concrete work included in this wave.

### Out of scope

- Explicit exclusions to prevent drift.

## 4. Dependencies

- Prior waves and preconditions that must already be complete.

## 5. Task plan

For each task:

- Task ID
- Purpose
- Files/paths to create or modify
- Acceptance criteria
- Risks/notes (if any)

## 6. Deliverables and verification

Use this format:

| Deliverable | Evidence path(s) | Verification command(s) | Pass criteria |
|---|---|---|---|
| ... | ... | ... | ... |

## 7. Wave gate checklist

- `pnpm -r typecheck` passes
- targeted tests for changed packages pass
- lint/static checks pass
- architecture contract spot-checks completed
- wave changelog updated
- wave journal updated
- root `changelog.md` summary updated

## 8. Handoff to next wave

- What this wave guarantees.
- What the next wave can now assume.
