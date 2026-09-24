# FIX-1527 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Kitchen-sink is a private app, and its README is where readers learn it. This issue adds no
API, so `apps/docs` gets no change from it. The capability's own reference belongs to its
package (see [PLAN.md → Follow-ups](PLAN.md#follow-ups)). The prose below is written for
[F1](DECISIONS.md#f1), which was answered *ship now*. **The last paragraph of the new section
depends on FIX-1500's PR-B.** If PR-B has landed when this publishes, use the replacement below
it instead.

## UPDATE · `apps/kitchen-sink/README.md` · "The support team (`workforce/`)", the seat sentence

Replace the sentence that lists the seats:

> `support.ada` and `support.grace` both run the `desk-clerk` kind and declare different desks;
> `support.iris` and `support.otto` run the built-in agent kind with different tools, and
> `support.mara` runs it too, naming `hire` and `fire`: she can add a seat to the team, which the
> section on hiring below covers.

## CREATE · `apps/kitchen-sink/README.md` · new section after the `workforce-admin` hire section, before "Web Application"

> ### A seat that hires
>
> The admin action is how an operator adds a seat. `support.mara` is how a seat does it.
>
> Her `WORKER.md` names two tools, and that is all she declares:
>
> ```yaml
> ---
> description: Staffs the support desk — hires a seat of a kind the app already has, and fires one it hired.
> tools: [hire, fire]
> ---
> ```
>
> The tools come from `createSeatHireCapability`, which `workforce/hire.ts` adds to the
> built-in agent kind next to the team's own capability. Adding it to a kind puts `hire` and
> `fire` in that kind's catalog, and a seat still has to name them. Iris and otto run the same
> kind and can't hire, because their files don't ask for it. The same file also adds
> `discover`, so any agent seat can ask which seats this organization has hired.
>
> A hire names a kind this app already carries (`agent`, `desk-clerk` or `followup-runner`,
> the same list the admin action offers) and a seat id. It can't invent a kind. The seat
> answers straight away at `<org>.<seatId>`, and it's written to the same roster the admin
> action writes. So it comes back after a restart, and the admin action's `fire` can remove it.
> Mara can fire only the seats she, or another seat, hired this way. A seat declared in a
> folder is removed by editing the folder, and a seat the admin action hired belongs to the
> operator who hired it.
>
> Firing releases the address, and `discover` stops listing the seat. The seat's row in the
> live inventory stays, because that list records what was ever registered.
>
> **Out of the box, mara can't hire.** A hired seat's address starts with its organization, and
> this app authenticates nobody, so every seat request runs under the framework's development
> organization. That name is deliberately not a legal address, so the hire is refused and
> nothing is written. Ask her anyway and the run stops with an error naming the organization. The wiring is the part to copy: in an
> app whose seats run under an organization its callers verified, the same two files hire. The
> app's tests show it working under a named organization.

*(Replacement for the paragraph above, once FIX-1500's PR-B has landed.)*

> **Mara hires in the app's one organization.** This app runs its pages and seats as the
> `kitchen-sink` organization, so ask her in the browser and the seat is hired there, where the
> rail and `discover` both see it. `fsdev run` is the exception: the CLI always runs as the
> framework's development organization, whose name is not a legal seat address, so a hire from
> the CLI is refused and nothing is written. Anyone who can open a deployed copy of this app can
> ask her to hire or fire.

## Voice notes for the implementer

The published pages follow `docs/contributing/user-docs.md`: outsider rule, no issue numbers,
no "this used to…". Watch for em-dashes, and don't start sentences with "This".
