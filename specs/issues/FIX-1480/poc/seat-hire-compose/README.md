# POC · seat-hire compose

A throwaway experiment retained as design evidence for [FIX-1480](../../SPEC.md). It is not
production code, not a workspace package, and is in no default build, test, lint or knip
discovery. Nothing outside this folder imports it.

## The question

After a seat is hired onto the durable roster that already shipped, can a teammate find it
the same way Labs already look people up — or is that a hole the first ship has to close?

If the lookup already sees roster-only seats, [D1](../../DECISIONS.md#d1) is theatre. If it
does not, D1 is the product call.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1480/poc/seat-hire-compose/check.mts
```

Exit code is 0 when every check and every control behaves. No install step beyond the repo's
own `pnpm install`. No production module is registered.

## What it checks

| Check | The claim | How it is made falsifiable |
|---|---|---|
| 1 | Discover projects a seat only when **both** a file declaration and an inventory row exist. A runtime hire writes neither, so it is invisible | Real `workforceManifestSources` over a file seat and a roster-only id that both have inventory rows. The runtime id must be absent |
| 1 control | Widening the declared half to include that id (D1's proposed join) makes it appear | Same inventory, declared set unioned with the runtime id. If it stayed empty, the join would be broken |
| 2 | `hireWorkforce` already mints from `hiredSeatManifest` — the host admin spine | Real mint of `agent` at `acme.eng.ada` |
| 3 | Unknown kind and duplicate id already refuse | Real `hireWorkforce` throws, naming the kind / the duplicate. Control: a registered kind still hires |
| 4 | The Door B sketch is catalog `tools` named `hire` and `fire`, not `controlTools`, not a Hire type | Inspect `createSeatHireCapability`. Control: a present `controlTools` is what the inspector would fail |

`sketch-capability.mts` is the shape a ship would start from. It is not imported by
`packages/workforce`. Do not promote it by moving the file.

## What would abandon Door B

- If `hireWorkforce` could not mint from a hand-built roster row — then the seat tool would
  need a second mint, which the issue invent-kills.
- If discover already listed roster-only seats — then D1 is a no-op and we should not change
  the join.
- If hire had to be a `controlTool` to be callable — then empty `tools:` could not stay empty,
  and the fence is the product.

## What it showed

All twelve assertions passed on this explore head.

**Discover withholds a roster-only seat.** A file-declared seat with an inventory row is
listed. A second inventory row whose id is not in the file tree is withheld. Putting that
id on the declared half — D1's proposed join — lists it. So the hole is real, and the close
is the existing join with a wider declared set, not a new lookup.

**The mint spine is already the one to compose.** `hiredSeatManifest` + `hireWorkforce`
mints `agent` at `acme.eng.ada`. An unregistered kind is refused by name. The same id twice
in one call is refused. A registered kind still hires (the control).

**The sketch is catalog tools.** `createSeatHireCapability` is named `seat-hire`, exposes
`hire` and `fire` on `tools`, and has no `controlTools`. The hire input is `seatId`, `flow`,
`settings`, `instructions` — no field that could invent a kind.

Nothing in the run moved the design. D1 is still the call; Door B still composes the spine
that already exists.

## Limits

- It does not run a model. The tools fence is inspected on the capability object, not driven
  through a generator loop. Core already enforces that half; this proves we did not put hire
  on the bypass.
- It does not write Postgres. Persistence is [FIX-1475](../../../FIX-1475/SPEC.md)'s, already
  shipped.
- It does not open a browser or kitchen-sink.
- The sketch's `execute` is unread by the check on purpose. Reaching into
  `block.config.execute` is how a POC pretends it is a unit test of production.
