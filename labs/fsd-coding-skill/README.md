# FSD coding skill — POC

Throwaway lab. Proves an outer coding agent can be forced through **one FSD
flow** that commands the existing Cursor harness. Dogfood of FSD plus that
harness — not a new product surface.

**Do not merge this as product API.**

## Run

```bash
pnpm --filter @flow-state-dev/fsd-coding-skill test
pnpm --filter @flow-state-dev/fsd-coding-skill typecheck

# live (needs a signed-in Cursor harness)
pnpm --filter @flow-state-dev/fsd-coding-skill implement -- --task "add a smoke test" --cwd "$PWD"
```

Skill the outer agent reads: [`.agents/skills/fsd-coding/SKILL.md`](../../.agents/skills/fsd-coding/SKILL.md).

## What was proved

1. One flow kind (`fsd-coding`) with four **static** doors: `implement`, `fix`,
   `openPr`, `fixFsd`. Each door is a sequencer that stamps a prefix and hands
   `{ prompt }` to the same `cursorAgent` instance from `@flow-state-dev/cursor`.
2. `cwd` / `resume` / `onSession` are host resolvers. A smuggled `cwd` on
   action input does not move the working directory (BP-031).
3. `onSession` writes the Cursor agent id onto session state. A later door
   on the same stores **resumes** that agent.
4. The skill-facing CLI maps kebab names onto those doors and refuses
   anything else.
5. `fixFsd` is a real entry: it sends the repro through Cursor under a
   self-heal prefix, not the original task.

## What was faked

- Tests inject a **scripted Cursor client** through `resolveCursorClient`.
  No local Cursor runtime starts. No network. Same seam
  `packages/cursor/test/agent.spec.ts` already uses.
- The version gate is stubbed in tests via the package's internal reader
  symbol. A live `run.ts` uses the real gate and the real SDK.
- Cross-process resume is a JSON sidecar the host owns, not a new store
  adapter. In-process resume is session state.
- `openPr` is a prompt prefix, not a git/gh integration.

## What still needs substrate

| Gap | Why this lab cannot close it |
|---|---|
| A durable host the skill can leave running | Today's runner is one `runAction` per invocation. A long-lived process / `fsdev serve` is existing substrate, not wired here. |
| Auth that cannot go through the harness | The skill names the exception. No FSD door for "log into gh". |

One harness stack. Session id distinguishes turns on this one flow. This lab
does not add an instance floor.

## What this is not

Dogfood of FSD plus the Cursor harness. Not a product surface, not a second
harness stack, not a team or channel. The four doors are the whole surface.
No changeset. Private lab.
