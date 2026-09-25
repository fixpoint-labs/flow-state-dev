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
```

| # | Premise | Result |
|---|---|---|
| P1–P2 | A post with no `author` lands, and its line's `principal` is `devuser` | Held |
| P3 | The post leaves **no** client-visible, history-kept item in the channel's stream | Held. This is why "see it in the stream" needs [D1](../../DECISIONS.md#d1) |
| P4 | `author: "devuser"` is refused (`author-not-a-member`) and nothing is appended | Held. This is why [D2](../../DECISIONS.md#d2) sends no author |
| P5 | `support.ada`'s `answer` leaves a durable assistant message in the seat's session | Held |
| P6 | The flow list serves each seat kind's actions and input fields | Held. The check asserts only that each kind is listed; the fields were read from its logged schemas: `agent` → `run {message}`, `desk-clerk` → `answer {note}`, `followup-runner` → `drain` (no form). It does not test inference or a kind with two one-string actions |
| P7–P8 | One `session.client.expose: ["transcript"]` on the channel kind puts the transcript, and only it, in `clientData.session` | Red on main, green with the line, reverted after |

Raw output: [`evidence.txt`](evidence.txt).
