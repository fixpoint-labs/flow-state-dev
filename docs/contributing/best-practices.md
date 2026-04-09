# Best Practices (Living)

Purpose:

- Capture implementation standards decided during planning/review.
- Keep decisions cumulative so future waves and agents follow the same bar.

Update policy:

- When user review establishes a new best practice, update this file in the same change set as the code/docs adopting it.
- Do not overwrite prior practices; append a new entry with status/date.
- If a practice is superseded, mark the old one `Superseded` and link the replacement entry.

---

## Active Practices

### BP-001: Canonical authority precedence

- Status: Active
- Date: 2026-02-15
- Rule:
  - If docs conflict, `preperation/architecture/*` is authoritative.
  - Planning docs and wave docs must reference canonical architecture sources.
- Why:
  - Prevents drift between wave execution and architecture contracts.

### BP-002: Wave-driven execution

- Status: Active
- Date: 2026-02-15
- Rule:
  - Every implementation change must map to a wave task.
  - Each wave requires explicit deliverables and verification commands.
- Why:
  - Enables autonomous run-to-completion execution with predictable verification.

### BP-003: Verification evidence is mandatory

- Status: Active
- Date: 2026-02-15
- Rule:
  - Every claimed deliverable must have an evidence path and pass criteria.
  - Wave close-out requires a journal and changelog under `docs/waves/`.
- Why:
  - Eliminates ambiguous “done” states.

### BP-004: Public boundary first

- Status: Active
- Date: 2026-02-15
- Rule:
  - Prioritize package boundaries and contracts before runtime implementation details.
  - Early waves should lock import/export shape before behavior depth.
- Why:
  - Reduces rework and cross-package breakage in later waves.

### BP-005: Dual changelog requirement

- Status: Active
- Date: 2026-02-15
- Rule:
  - Each wave must maintain wave-local artifacts (`docs/waves/wave-1/wave-1.<letter>-journal.md`, `docs/waves/wave-1/wave-1.<letter>-changelog.md`).
  - Each wave must also add a concise summary entry to root `changelog.md`.
- Why:
  - Wave-local docs preserve detail; root changelog preserves project-level continuity.

### BP-006: Keep wave labels out of code and tests

- Status: Active
- Date: 2026-02-16
- Rule:
  - Use wave identifiers in planning and documentation artifacts only.
  - Do not reference wave labels (for example `wave 1.x`) in runtime code, package code comments, or test assertions/titles.
- Why:
  - Keeps implementation surfaces domain-focused and avoids coupling runtime artifacts to temporary execution planning labels.

### BP-007: Concise API and file-level documentation

- Status: Active
- Date: 2026-02-16
- Rule:
  - Add a concise file header comment to implementation files that explains the file's role in the runtime.
  - Document 100% of exported methods/functions/classes with concise doc comments focused on contract and behavior.
  - Document important internal helpers when they carry non-obvious control flow, state transitions, or error semantics.
  - Keep comments high-signal and short; avoid restating obvious syntax.
- Why:
  - Improves onboarding speed and reduces misunderstanding as runtime orchestration complexity grows.

### BP-008: Keep README onboarding-first and current

- Status: Active
- Date: 2026-02-16
- Rule:
  - `README.md` is the first-stop onboarding document for new developers and should focus on project purpose, objectives, key concepts, setup, package responsibilities, and core commands.
  - Process-specific collaboration protocol (for example wave execution rules) should live in `AGENTS.md`, not in `README.md`.
  - Update `README.md` in the same change set when onboarding-relevant facts change (new package/app, package responsibility changes, setup/command changes, or major architecture concept shifts).
- Why:
  - Keeps onboarding fast and accurate while preserving detailed process guidance in the right place for agent workflows.

### BP-009: Maintain package-level READMEs for public packages

- Status: Active
- Date: 2026-02-16
- Rule:
  - Maintain `README.md` in each public package directory (`packages/*`).
  - Package READMEs should document purpose, current public API surface, basic usage, and package-local verification commands.
  - Update a package README in the same change set when that package’s exported surface, runtime behavior, or setup scripts materially change.
- Why:
  - Reduces onboarding and integration friction by keeping package docs close to the code that owns each contract.

### BP-010: React component conventions

- Status: Active
- Date: 2026-03-10
- Rule:
  - **Prefer `useMemo` over `useEffect` for derived state.** If a value can be computed from props or other state, derive it with `useMemo` rather than syncing it through `useEffect` + `setState`. `useEffect` should be reserved for genuine side effects: subscriptions, DOM manipulation, data fetching, or synchronization with external systems.
  - **Comment every `useEffect`.** Each `useEffect` must have a brief comment above or inside the hook explaining *what* side effect it performs and *why* it exists. This applies even when the effect seems straightforward — the "why" is often non-obvious to the next reader.
  - **Comment non-obvious logic.** Code should be readable on its own, but when intent or reasoning isn't self-evident — complex conditions, non-trivial memoization dependencies, workarounds — add a concise comment explaining the *why*.
- Why:
  - `useMemo` is synchronous and deterministic — no extra render cycle, no stale intermediate state, no cleanup concerns. `useEffect` for derived state introduces unnecessary complexity and subtle timing bugs.
  - Mandatory `useEffect` comments prevent "mystery effects" that accumulate as components grow. Effects are the most error-prone part of React components; explaining their purpose makes bugs easier to spot during review.

### BP-011: Handlers must not call generators internally

- Status: Active
- Date: 2026-04-03
- Rule:
  - A handler block must not instantiate or call a generator internally.
  - When a block needs to produce LLM output and then act on it, model it as a sequencer with a generator step followed by a handler step.
- Why:
  - Generators are a first-class block kind with their own execution semantics: streaming, retry, tool loops, and observability hooks. Wrapping a generator call inside a handler bypasses all of these and makes the generator invisible to the runtime. It also makes the generated output hard to observe, replay, or trace in devtools. The sequencer `.then(generator).then(handler)` pattern is the correct composition primitive.

### BP-012: Use `.tap()` for state-mutation-only blocks — never return input as passthrough

- Status: Active
- Date: 2026-04-08
- Rule:
  - When a block only mutates state (session, user, sequencer) and its output carries no meaningful information forward, chain it with `.tap()` instead of `.then()`.
  - Such handlers must not declare `outputSchema` and must not `return input` at the end of `execute`.
- Why:
  - Every block chained with `.then()` appends its output to the items log. Returning `input` as a passthrough pollutes the items log with redundant copies of data that carry no new information. Items should contain meaningful output — LLM responses, structured results — not echoes of prior state. State mutations are already observable through the state change log.
  - `.tap()` communicates intent clearly: this block runs for its side effects, the upstream data flows through unchanged.



## Template For New Entries

```md
### BP-XXX: <Name>

- Status: Active | Superseded
- Date: YYYY-MM-DD
- Rule:
  - ...
- Why:
  - ...
- Superseded by: BP-YYY (optional)
```
