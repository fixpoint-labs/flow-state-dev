# FIX-2372 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: hold the button, show the refusal, on five calls in the Claude
Code-style lab and *Talk* in Kitchen Sink. The one decision is where the hook lives.

<a name="d1"></a>
## D1 · One `useSubmit` in `@flow-state-dev/react`, not `useAction`, not copies

| | `useSubmit` in `@flow-state-dev/react` (chosen) | Reuse `useAction` | A copy in each app | A `packages/ui/registry` item |
|---|---|---|---|---|
| Wraps any async call (an adapter's, a client's) | yes | no: it sends one flow action, and needs `flowKind` and `userId` | yes | yes |
| Implementations | one | one, plus a second shape beside it | three, drifting | one, copied in by `fsdev ui add` |
| New surface | one hook | `useAction` grows a second mode | none | a new item type: the registry holds only components |

- **Because:** `useAction` is the flow-action hook: it resolves a client and calls
  `flow.send(action, …)`. The calls here are a lab adapter's and Workforce's browser client's,
  with no flow action to name. Bending `useAction` to take "any function" gives one name two
  meanings. The registry ships copied UI; a hook with no markup is not its job, and a copied
  hook drifts like the per-app copies D4 rejects.
- **Locks in:** a generic async-submit hook in the React package, named for what it does. No
  workforce noun, so ER-1 holds. Shift Manager and future apps reach for it the same way.
- **What would change my mind:** `useAction` already being generalised elsewhere in the epic.
  It isn't (the epic's only note is that FIX-2372 must not take the name).

## Decided, not asked

- **E1 · Teammates' contract moves as is** (`submit(event?, ...args)`, `busy`, `error` as a
  string), so its call sites change only their import. It gains one thing: a call made while one
  is running does nothing, so safety doesn't rest on every button wiring `disabled`.
- **E2 · The task view's composer calls share one hold.** Resolving while a request for changes
  is in flight is never meant.
- **E3 · A steer's words clear on success, not before the call,** and only if the box still
  holds them, so a refusal keeps them and typing on isn't lost.
- **E4 · Kitchen Sink holds every *Talk* while one opens,** not only the clicked row: a click on
  a second worker during a slow create is the same double create.
- **E5 · A changeset** (`patch`) for the new export; the apps are private.

## How it got here

- Drafted 2026-10-31 after the build PR (#4376) shipped a per-app copy. The epic thread routed it
  back to the spec route (Improvement) and asked for the hook's home to be this spec's decision.

## Notes from review

- Cursor (741f48f): approved direction. Folded: the hook guards re-entry itself, as `useApproval`
  does (E1); the controls no longer name the build PR. Kept: E2 to E5 stay listed as decided,
  since a reviewer reads them as the behaviour the build must keep; D1's table keeps the copy and
  registry columns, since those are the options the epic thread weighed.
