# Model pilot: the three A pages, written three times

Epic FIX-2696. The question: does the A approach need Fable 5.2 to write, or can Sonnet 5.5 or Opus 5.5 write it?

- **`fable/`**: A as it was after its own first fact check and prose check (commit 347534f5), before any bot review rounds.
- **`opus/`** and **`sonnet/`**: written from scratch by following [`RECIPE.md`](RECIPE.md): the same inputs and the same one-pass process. Neither writer saw A, the writing brief, or the other's pages.

Afterwards, each version got the same blind checks, run on copies labelled x, y and z: an Opus fact check against the code and the FIX-2618 specs, and a `docs-editor` prose check. Each folder keeps its `FACT-CHECK.md` and `PROSE-CHECK.md`.

## Scores

| | Fable | Sonnet | Opus |
|---|---|---|---|
| Words per page (checker count, prose only) | 620–730 | 910–960 | 1,140–1,270 |
| Claims checked | 83 | 116 | 144 |
| Wrong | 3 | 6 | 6 |
| Unsupported | 5 (4 are the starter, which O2 still has to decide) | 3 | 3 |
| Bad claims, share of all claims | 9.6% (4.8% without the starter) | 7.8% | 6.3% |
| Prose check verdicts (findings) | REVISE ×3 (23) | REVISE ×3 (15) | SHIP, REVISE, REVISE (16 + 5 on figures) |
| Worst fact error | Users can't edit a standard worker (they can, which makes their own copy); "everyone gets their own copy" | The `harnesses` kit's shape; `fork` passes an id the page's own rule says won't resolve | `harnesses` imported from the package root; "each ending is final" |
| Worst level problem | Slot stacking explained on the first page a reader meets | The claim and lease mechanism, almost word for word the "mechanism as reassurance" tell | About a third of Tasks and boards is Reference material (claim expiry, abandonments, stop-reason table) |

## What the checks agree on

- **Every version goes too deep.** All three put mechanism a reader doesn't need yet onto a Concepts page. The more words a model uses, the more it does this. The writers had no rule against it, so a brief rule should fix it whichever model writes.
- **Every version's figures break the site's drawing conventions.** On the site, hatching means "outlives the request" and a dashed line means "lasts one action run". Each version uses them for something else, and no figure has a key. Fable's SVGs also embed `<style>` blocks with hex colours, which the site's brand lint bans, and they print a writer's note as the caption. This needs a figure rule with a check behind it, again whichever model writes.
- **Fable is the tightest by a wide margin**: about 30% fewer words than Sonnet and 45% fewer than Opus, with the fewest claims to get wrong.
- **Sonnet and Opus are as accurate as Fable, or more,** once the starter, a product decision still open, is set aside. Opus is the most accurate per claim, but it makes the most claims and goes deepest.

## Not fair, and how

- Fable wrote with the owner in the conversation. That direction isn't recorded, so the other writers didn't get it.
- Neither new writer could dispatch sub-agents. They ran their own fact checks and prose checks in context, while A's checks were run separately.
- The page checker's `title=` and `type` rules came after A's first draft, so every version fails some of them. They aren't scored.
- There was one writer per model and one run each, and no cold read was done.
