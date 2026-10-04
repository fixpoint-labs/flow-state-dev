# Rules — Workforce: Shift Manager

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Rules every epic under this project obeys. Each has one owner, the epic that implements and proves
it; the others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When an epic ships a surface in Shift Manager, then it is reached through the shell's nav and drawn in the shell's design system in v2's look, reusing FSD components skinned only through `--fsd-*` tokens, never restyled or edited in copy | FIX-1649 | FIX-1663's closure check: leg a (every surface reached), leg c (no Shift Manager value in FSD), leg d (v2's look, FIX-1737's check); FIX-1655's re-sync check on copied components |
| **PR-2** | When an epic's surface in Shift Manager writes to the engine, then it goes through a seam on FIX-1649 ER-15's list: a worker's session only through its shipped operations, and the person's own room only through `lib/talk.ts`'s `sendAction(` and `lib/reads.ts`'s `createSession(`, on `ROOM_KIND`. A new write path is an amendment to that list, never a second route | FIX-1649 | FIX-1663's part 4 seam check (`goals/shift-manager/a-lab-is-worked-through-one-skinned-shell/`), which fails on a call outside the list |

**No epic may:**

- mint a Layer 1 Agent, Team, Channel, MessageBoard or required Project noun;
- add a special wrapper so a Lab runs without org, or without the shared shell;
- invent a `CHANNELS.md` convention or a `kind:` frontmatter key;
- rebuild Thought Fabric's Attention domain for the attention surface;
- build a Heartbeats, Paperclip or Grok Bot clone, or a Conductor or factory shell beside Workforce.
