# Rules — Workforce: Shift Manager

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Rules every epic under this project obeys. Each has one owner, the epic that implements and proves
it; the others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When an epic ships a surface in Shift Manager, then it is reached through the shell's nav and drawn in the shell's design system in v2's look, reusing FSD components skinned only through `--fsd-*` tokens, never restyled or edited in copy | FIX-1649 | FIX-1663's closure check: leg a (every surface reached), leg c (no Shift Manager value in FSD), leg d (v2's look, FIX-1737's check); FIX-1655's re-sync check on copied components |
| **PR-2** | When an epic's surface in Shift Manager writes to the engine, then it goes through a seam on FIX-1649 ER-15's list: a worker's session only through its shipped operations: `sendAction(` in `lib/send.ts` and `lib/action.ts`, `createSession(` in `lib/reads.ts` and `lib/conversation.ts`, `abortRequest(` in `lib/run.ts`, `resumeSuspension(` in `lib/reads.ts`, and the person's project coordinator through Workforce's `ensureWorkerSession(` in `surfaces/Project.tsx` (FIX-1793). A new write path is an amendment to that list, never a second route | FIX-1649 | FIX-1663's part 4 seam check (`goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/`), which fails on a call outside the list |

PR-2's room seams went with rooms in FIX-1786 ([Decisions](DECISIONS.md), 34); the list above is
the one the part 4 check holds on `main`.

**No epic may:**

- mint a Layer 1 Agent, Team, Channel, MessageBoard or required Project noun;
- add a special wrapper so a Lab runs without org, or without the shared shell;
- invent a `CHANNELS.md` convention or a `kind:` frontmatter key;
- rebuild Thought Fabric's Attention domain for the attention surface;
- build a Heartbeats, Paperclip or Grok Bot clone, or a Conductor or factory shell beside Workforce;
- hold a request open while it waits for another worker, add an answer-once check beside the board's
  claim ticket and the delivery ledger, or bring back skill `agents:`
  ([Decisions](DECISIONS.md), 17, 20 and 21; FIX-1815's ER-6, ER-8 and ER-10).
