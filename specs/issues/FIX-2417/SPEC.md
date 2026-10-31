# FIX-2417 · The picked coordinator or worker panel gets a header and a way back

**Spec** · [Decisions](DECISIONS.md)

Part of epic [FIX-2369](../../epics/FIX-2369/SPEC.md), wave 0 (Kitchen Sink quick wins).

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens `support.help` or a specialist from the rail or the roster's Talk** | The panel has no heading: nothing says who they are talking to | A header names the worker (`support.help`, `support.devices`) and its kind (`coordinator`, `agent worker`) |
| **wants to get back to the assistant** | Has to find the assistant's session in the rail | **Back to assistant** in the header closes the panel onto the assistant's open session |
| **reads a specialist's answer in the coordinator's conversation** | Markdown shows raw (`**bold**`, `- item`), unlike the same specialist talked to directly | It renders through the same markdown renderer an assistant reply uses; the user's own posts stay as typed |

## The goal, and how we'll know it's met

**A picked coordinator or worker panel says who it is, offers a way back, and draws a delegate's
answer the way the same worker's direct reply is drawn.**

- **Smaller, and rejected:** only the markdown fix. The missing heading and way back are the
  same finding (R-51, KS-USA-6) on the same panel.
- **Bigger, and not this issue's:** naming the model on a picked panel (see
  [D3](DECISIONS.md#d3)), and KS drawing worker messages at all (FIX-2275).
- **Not done if:** the header shows the flow's name instead of the worker's, Back leaves the
  panel open, or a delegate's `**bold**` shows its asterisks.

**How we verify.**

- **Unit, `apps/kitchen-sink/test/picked-session-panel.test.tsx`:** the header names the
  session's worker and kind on a coordinator and on an `agent` worker; Back calls the page's
  close; no name shows before the session detail loads. A delegate's `**not**` and list render
  as markdown; the user's `**this**` stays literal.
- **Controls that must fail:** name the header from the picked kind (the name cases fail); drop
  Back's handler (the Back cases fail); draw every body pre-wrapped again (the markdown case
  fails).
- **Browser, `apps/kitchen-sink/e2e/talk-from-page.spec.ts`:** on the built app in test mode,
  `support.help`'s panel names `support.help` and `coordinator`, Back returns to an enabled
  assistant input with no panel, and Talk on `support.devices` names it as an `agent worker`.

## What changes

- **`apps/kitchen-sink/components/picked-session-panel.tsx`:** a header above both panels (the
  worker, from the session's readonly `workerId` ([D1](DECISIONS.md#d1)); the kind; Back). A
  coordinator line not written by the user renders through `MessageResponse` from
  `components/flow-state/message.tsx`, the registry's message renderer
  ([D2](DECISIONS.md#d2)). The panel takes an `onBack` prop.
- **`apps/kitchen-sink/app/flow-state/page.tsx`:** passes `onBack={() => setPicked(null)}`.
  One line, in a file wave 0 shares; it merges after FIX-2416 per the epic's build order.
- **`apps/kitchen-sink/README.md`:** one sentence in "The support team".

## What's already here, and the debt

- The renderer already exists (`MessageResponse`, Streamdown with the registry's plugins); this
  wires it, it builds nothing.
- Every worker session carries `workerId` as a readonly state field
  (`packages/workforce/src/workers/installation.ts`), and the engine returns readonly fields on
  the session's client state (`packages/engine/src/routes/client-session.ts`), so the name needs
  no new read. No package changes (ER-1).
- `FlowNavigator`'s `onSelectSession` passes only the id and the leaf, not the row's title, so
  the page cannot carry the rail's label into the panel. Reading `workerId` avoids needing it.
