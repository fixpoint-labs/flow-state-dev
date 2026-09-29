# FIX-1649 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The calls above any single issue. D1 and D2 are the sign-off surface. One fork is open and is
Jake's. The rest were decided here so no child reopens them. Scope, invent-kills and vocabulary
come from the PRD and the Architect's signed guidance on FIX-1649; nothing here goes past them.

## The tree

```mermaid
flowchart TD
  E["FIX-1649"] --> D1["D1 · two issues and a closure"]
  D1 -.->|"rejected"| X1["one child per region or destination"]
  E --> D2["D2 · one skin through the existing theme contracts"]
  D2 -.->|"rejected"| X2["fork FSD components into App Lab"]
  D2 -.->|"rejected"| X2b["a new theme API in the react package"]
  E --> O["open · one app, or a chrome each Lab imports"]
```

<a name="d1"></a>
## D1 · Two issues and a closure: the shell owns how surfaces are reached and look, the siblings own what they mean

| | |
|---|---|
| **Instead of** | One child per region (sidebar, centre, inspector) or per destination (projects, workstreams, chat, attention, resources) |
| **Because** | The Architect's line puts the *meaning* of three of the five destinations in FIX-1650, 1651 and 1652. A child per destination would either draw a sibling's model or wait on it. What is left for this epic, reach and look, is one surface with one seam: FIX-1655's token set, which FIX-1662 consumes |
| **Locks in** | FIX-1662 carries all four regions and all five destinations. Split trigger: if its spec finds a region needs a read no shipped surface exposes, that region splits out as its own child rather than inventing the read inside the shell |

**What would change my mind:** a sibling epic shipping its meaning inside this epic's window
in a way that reshapes a region. Then that region is worth its own child.

![D1: two issues and a closure, chosen, beside one child per region or destination. Decides it: where meaning lives; the siblings own it, so per-destination children would redraw or wait on their models. Also: one seam instead of one per pair. Price: FIX-1662 is a large child. Locks in FIX-1662 carrying every region, with a split trigger. Flips if a sibling's meaning ships in this window and reshapes a region](figures/d1-two-and-closure.svg)

It comes down to where meaning lives: per-destination children would redraw siblings' models.

<a name="d2"></a>
## D2 · One skin, through the theme contracts FSD components already have

| | |
|---|---|
| **Instead of** | Copying FSD components into App Lab and painting the copies · adding a theme provider or theme API to `@flow-state-dev/react` |
| **Because** | Jake's layer rule: FSD's L1 packages carry no App Lab look. The contracts already exist: the navigator and panels read `--fsd-nav-*` and `--fsd-panel-*` custom properties ([FIX-1477 D1](../../issues/FIX-1477/DECISIONS.md#d1)), and kitchen-sink already maps its tokens onto them. Forks drift from every later FSD fix; a theme API puts a Lab-shaped surface into L1 |
| **Locks in** | The design-system package owns one token set, a neutral theme and the App Lab theme, and maps them onto the existing contracts. A reused component that can't take the skin is fixed where it lives, by FIX-1655: today that is eleven registry components using fixed palette colours. No forks ([ER-6](BUSINESS-RULES.md#what-no-child-may-do)) |

**What would change my mind:** the refined design asking for a look a reused component can't
reach through its contract without a change to its public props. Then that component needs a
spec of its own, not a fork.

![D2: one skin through the existing contracts, chosen, beside forking FSD components into App Lab, and beside a theme API in the react package. Decides it: where the App Lab paint lives; in one theme of the design-system package, never in FSD. Also: a second Lab swaps a theme. Price: the skin reaches only what the contracts expose, and eleven registry components need fixing first. Locks in skin gaps fixed where the component lives. Flips if the refined design needs a look a contract can't express without changing public props](figures/d2-one-skin.svg)

It comes down to where the paint lives: a fork or a theme API puts App Lab into FSD.

## Who owns what

![Who owns what: eight cross-cutting rules by three issues, FIX-1655 the design system, FIX-1662 the App Lab shell, FIX-1663 the closure. FIX-1655 owns the token set through the existing contracts, the neutral theme with no App Lab value in FSD, no forks, and turning the hand-back into theme values. FIX-1662 owns reaching every surface, a second Lab with no shell code, and named empty states. FIX-1663 owns the proof. Every other cell consumes](figures/ownership.svg)

Every rule has one owner. A *consumes* cell is a place a child must not re-decide: FIX-1662
consumes the token set and the hand-back rule; it does not choose colours.

## Decided in review, recorded so no child reopens them

- **App Lab lives at `labs/app-lab/`.** Labs are the repo's real, dogfooded apps; `apps/` is
  framework reference and tooling. Kitchen-sink is not the shell.
- **The design-system package is private** in this epic. An npm name is permanent, and no
  consumer outside the repo exists. Its name and folder are FIX-1655's call.
- **Final visuals wait for the refined design; structure does not.** The token contract, the
  neutral theme, the regions and the bindings start at the gate. Theme values and final layout
  merge after the Claude Design hand-back ([ER-9](BUSINESS-RULES.md#how-the-set-is-run)).
- **A destination whose meaning hasn't shipped shows a named empty state**, not a hidden item:
  the design hand-off needs every destination drawn, and a hidden one teaches nothing.
- **NEEDS YOU lists the pending approvals and questions seats have raised** until FIX-1652
  defines attention. It is not the Thought Fabric attention domain.
- **The run inspector summarises one run and links the devtool's full trace.** It shows only
  what shipped reads return. An EM seat shows no harness calls, because it never uses one.
- **The design-system package imports nothing from `@flow-state-dev/workforce`.** Workforce
  words in the chrome (NEEDS YOU, ON SHIFT) are labels App Lab passes in.

<a name="open"></a>
## Open · one, and it is Jake's

### Is App Lab one app that opens any Lab, or a chrome each Lab's own app imports?

**Plain terms.** The Architect's success line is that DevForce, CyberForce and later Labs share
one app chrome. That can mean one app you point at a Lab, so DevForce is App Lab opened on the
DevForce team's files, or it can mean a kit of screens that DevForce and CyberForce each build
their own app from. The wireframes look the same either way. What differs is whether a Lab
ever ships its own app.

**The trade-off.** One app means no Lab writes UI, and there is one thing to deploy and
dogfood; a Lab that wants a screen of its own can't have one until the shell grows a place for
it. A kit means each Lab is its own product with its own screens, at the cost of each Lab
carrying its own app, and of us publishing a chrome surface with one consumer today.

**My recommendation: one app; a Lab is the Workforce tree it opens.** D-12 says DevForce is a
Lab built completely on Workforce, and "no special wrappers" reads most naturally as no Lab
app at all. It is also the smaller build, and extracting a kit later from a working app is
cheaper than guessing its seams now.

**What would change my mind:** DevForce or CyberForce being meant to ship as separately
deployed products, with screens only they have.

**What being wrong costs:** moderate and late. Under my answer, a Lab that needs its own app
later means extracting the chrome into a package, about one issue. Under the other, we build
and hold a package surface nobody else uses yet.

![Open fork: one app that opens any Lab's tree, recommended, beside a chrome kit each Lab's app imports. Decides it: what a Lab is; a Workforce tree, per D-12, so no Lab writes UI. Also: nothing extra to build now. Price: a Lab can't have a screen of its own until the shell grows a place for it. Locks in closure leg b opening a second tree by configuration, and the chrome staying in labs/app-lab. Flips if DevForce or CyberForce must ship as separate products](figures/open-one-app.svg)

It comes down to what a Lab is: a tree needs no app of its own.

## What the end-state POC showed

None built. The wireframes carry the assembled end-state where it is contested (layout and
reach), and the one code seam, tokens mapped onto `--fsd-nav-*`, already works in kitchen-sink's
shell.

## How it got here

- **Drafted (Sep 29)** from the PRD and the Architect's guidance on FIX-1649 and FIX-1655:
  FIX-1662 and the closure FIX-1663 filed; D1 and D2; one fork left for Jake.
- **Owner direction (Sep 29)**: wireframes first, for Claude Design; the refined design is an
  input that gates final visuals ([PLAN.md](PLAN.md)).
