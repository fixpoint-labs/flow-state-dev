---
"@flow-state-dev/claude-code": minor
---

`claudeCodeAgent` and `createClaudeCodeAgentCapability` take `recordWork: true`,
which records what a coding run **did** as ordinary state (LAB-134).

Until now a run's own item stream held what the agent said — its messages,
reasoning, and tool calls. The two things that best describe a coding run, which
files it changed and what it decided its job was, existed only inside the
harness's transcript, where nothing but a person could read them.

With the option on, the agent declares three session-scoped resource collections
and writes into them as the run goes:

- `observed-file-ops` — one entry per path the run's file-writing and
  file-editing tools touched: `lastKind`, an `outcome` of
  `pending`/`applied`/`failed`, and when. Paths, never contents.
- `observed-plan` — one entry per item on the run's own to-do list: its wording,
  its status, and the status before that. Deliberately **not** the task board
  that dispatched the run, so an agent that decides mid-run to do five more
  things writes five to-do items and starts nothing.
- `observed-gaps` — one entry per mutation the recorder understood and could not
  record, with the reason. Without it a skip is indistinguishable afterwards from
  a mutation that never happened.

All three declare client state reads, so they come back over the resource route
that already ships; each row's payload is on `clientData`. Entries are keyed
under the run's request id, so a workstream reused across runs answers per run —
scope a read with `topicPrefix` and follow `nextCursor`.

Two limits are deliberate and stated rather than hidden. The file record covers
**tool-driven** operations only: a run that edits through the shell makes no
file-tool call, so nothing is recorded and that file does not appear — it is not
an authoritative index of what changed on disk. And recording never fails the
run: anything the recorder cannot handle is skipped, noted, and left as a gap
row.

Default is `false`, which is byte-identical to today: nothing recorded, no
resources declared. The capability takes the same option and needs it — a block
sitting in a capability's `tools` contributes no resource declarations to the
flow, so a capability that only forwarded the option would build fine and answer
404 at read time.
