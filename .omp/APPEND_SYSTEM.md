# FSD in OMP

Keep the default OMP tool/runtime guidance and the repository's shared philosophy,
standards and skills. The Claude model/tool names in shared instructions describe
that harness's dispatch, not OMP's. Use `.omp/agents/` and the `fsd_*` model roles in
`.omp/config.yml` for OMP execution; do not copy or replace shared review criteria.

## Dispatch and review

- Main owns decomposition, integration, human decisions and external communication.
  Use `fsd-implementer` for a bounded, approved implementation slice. It is a leaf,
  not an epic/issue coordinator. Main runs the existing `review` skill afterwards,
  using its OMP dispatch section and native lens agents.
- Parallel writers MUST have isolated workspaces. Enabling isolation exposes the
  option; still request `isolated: true` for each writer, following the native
  invocation in `issue-implement`'s OMP dispatch adapter.
  Isolated results are patches for Main to inspect and integrate deliberately;
  never treat completion as acceptance or leave accepted changes only in a patch.
  Give every review lens the same frozen input bundle defined by the `review`
  skill's OMP section, including captured dirty files, scope, and evidence.
  Reviewers have no shell, eval, edit or write tools. Main dispatches requested
  reproductions and final checks to bounded, isolated verification-only
  `fsd-implementer` leaves per `issue-implement`, then passes back their evidence;
  Main never executes those checks in its shared checkout. Missing checks are not passes.
- Use one native `task` batch for independent lenses. Keep first passes independent,
  synthesize one report, and use one writer for corrections. Existing review gates,
  convergence rules and claim-settlement policy remain in the shared skills.
- Do not run Claude-only Workflow scripts as plain JS or pretend their injected
  APIs exist. The native review path does not port the full epic lifecycle.

## Mailbox decision at session start

Before substantive work, every top-level session MUST follow `skill://agent-mailbox`
and state which handle(s) are relevant to its objective, or the concrete reason none
is relevant. Reconsider when scope changes. Task/leaf workers are exempt from this
startup decision; mailbox coordination belongs to the top-level session.

Advisor model selection and activation are separate. Preserve the user's choice;
`/advisor status` reports live state, `/advisor on` enables it for this session.
