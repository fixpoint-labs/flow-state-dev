# Rules — Workforce App Lab

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

Rules every epic under this project obeys. Each has one owner, the epic that implements and proves
it; the others inherit it.

| | Rule | Owner | Checked where |
|---|---|---|---|
| **PR-1** | When an epic ships a surface in the Lab, then it is reached through the shell's nav and drawn in the shell's design system, reusing FSD components skinned only through `--fsd-*` tokens, never restyled or edited in copy | FIX-1649 | FIX-1663's closure check: leg a (every surface reached), leg c (no App Lab value in FSD); FIX-1655's re-sync check on copied components |

**No epic may:**

- mint a Layer 1 Agent, Team, Channel, MessageBoard or required Project noun;
- add a special wrapper so a Lab runs without org, or without the shared shell;
- invent a `CHANNELS.md` convention or a `kind:` frontmatter key;
- rebuild Thought Fabric's Attention domain for the attention surface;
- build a Heartbeats, Paperclip or Grok Bot clone, or a Conductor or factory shell beside Workforce.
