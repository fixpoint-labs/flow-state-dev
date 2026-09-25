# poc/talk-premises — what a post and an ask actually leave behind

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`. Both probes boot kitchen-sink's real `fsdev.config.ts` (roster, channel boot,
host resolver) and call the same HTTP routes the page calls, in-process, on the dev
(in-memory) profile.

```bash
cd apps/kitchen-sink
pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/probe.mts          # P1–P6, on main
NEGATIVE=1 pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/probe.mts # must go red on P2
pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/expose-probe.mts   # P7–P8: red on main,
                                                                               # green with D1's one line
pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/items-probe.mts    # P9–P12: needs shape "C"
                                                                               # applied to channel-flow.ts;
                                                                               # P9/P11 red on unmodified main
```

| # | Premise | Result |
|---|---|---|
| P1–P2 | A post with no `author` lands, and its line's `principal` is `devuser` | Held |
| P3 | The post leaves **no** client-visible, history-kept item in the channel's stream | Held. This is why "see it in the stream" needs [D1](../../DECISIONS.md#d1) |
| P4 | `author: "devuser"` is refused (`author-not-a-member`) and nothing is appended | Held. This is why [D2](../../DECISIONS.md#d2) sends no author |
| P5 | `support.ada`'s `answer` leaves a durable assistant message in the seat's session | Held |
| P6 | The flow list serves each seat kind's actions and input fields | Held, asserted: each kind has exactly one action whose input is one required string field, and it is the one D3 writes down. `agent` → `run {message}`, `desk-clerk` → `answer {note}`, `followup-runner` → none (`drain`, no form). Goes red if a kind gains a second such action, or a field is renamed |
| P7–P8 | One `session.client.expose: ["transcript"]` on the channel kind puts the transcript, and only it, in `clientData.session` | Red on main, green with the line, reverted after |
| P9 | Shape "C": `appendPost` emits `ctx.emit.component("channel-post", line)` instead of `pushState` — a post leaves exactly one durable, client-visible `channel-post` item carrying `body`/`principal`/`authorVerified`/`id`/`at` | Held with the patch (red on main — no such item exists), reverted after. `items-probe.mts` |
| P10 | A refused post (`author-not-a-member`) leaves no `channel-post` item | Held on both the patch and main — unaffected either way |
| P11 | `read` rebuilds the transcript from `ctx.session.items.all({ itemTypes: ["component"] })`, dual-reading a legacy `state.transcript` line FIRST, deduped by id | Held with the patch (red on main: an unpatched `read` returns both lines from `state.transcript` in write order, so a legacy line seeded *after* the post lands *after* it, not first), reverted after |
| P12 | With the notify fan-out wired (kitchen-sink wires it), does a separate "onPosted" hand-off request on the SAME channel session count against the 50-turn `historyWindow` `items.all()` (and so the patched `read`) is windowed by? | **Yes.** 30 posts → 60 requests (post + onPosted per post), plus probe overhead = 65 total; `read` recovered only 22/30 posted lines. Unpatched main's plain `state.transcript` array recovered all 30 — it isn't windowed at all. A real regression "C" introduces once post volume × 2 exceeds the window |

Raw output: [`evidence.txt`](evidence.txt).
