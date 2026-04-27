---
description: Produce a competitor analysis for a product, company, or market. Use when the user asks "who competes with X", "how does X stack up against Y", "what's the landscape for Z", or wants a comparison matrix. Enforces a disciplined framing so the answer doesn't degenerate into a feature-checklist dump.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
---

# Competitor Analysis

A good competitor analysis answers three questions: who is the user choosing between, on what dimensions, and what does that imply. A bad one is a bullet list of features with no judgment. When this skill is active, follow the structure below.

## Define the space first

Before listing competitors, name the category. Is this a direct-replacement market (two products doing the same job), or an expanding one (the product reshapes what "the job" is)? Who is the actual user — end user, buyer, developer?

If the user's question is ambiguous, state your interpretation up front in one sentence and proceed. Don't ask a clarifying question unless the ambiguity is load-bearing.

## Pick competitors across three tiers

- **Direct.** Same category, same target user, high overlap in use case.
- **Adjacent.** Different category or user, but a plausible substitute for some segment.
- **DIY / status-quo.** What users do today if they pick none of the above. This is almost always the biggest competitor and is usually ignored.

Aim for 3 to 6 total. Naming more dilutes the analysis.

## Dimensions to evaluate

Don't evaluate every product on every axis. Pick the 4 or 5 dimensions that actually matter for the user's decision. Common ones:

- **Primary use case** (what the product is best at)
- **Target user** (individual, team, enterprise; technical depth)
- **Pricing model** (freemium, usage, seat, open-source)
- **Distribution** (how users find and adopt it; PLG, sales-led, ecosystem)
- **Momentum signals** (recent funding, hiring, user growth, shipped features in the last 6 months)
- **Differentiation** (the one thing only this product does well)
- **Weaknesses** (what users complain about — check reviews, GitHub issues, HN threads)

Skip any dimension where the answer is uninteresting or identical across the set.

## Gather evidence, not vibes

Use search and fetch to ground claims in sources:

- Pricing page, not a secondhand comparison article
- Official changelog or release notes for recent activity
- GitHub stars / release cadence for open-source
- Public funding announcements for momentum (Crunchbase, TechCrunch, official posts)
- Reddit, HN, G2, Trustpilot for user sentiment — note the tier of evidence

When sources conflict or are missing, say so. "No recent pricing listed publicly" is a valid data point.

## Structure the output

1. **One-paragraph framing.** The market as you see it, the 3 to 6 players you're evaluating, and the decision axis you'll focus on.
2. **Comparison.** Either a tight table (competitors × dimensions) or a per-competitor block — whichever fits the dimensions picked. Don't force a table when rows would be two-word placeholders.
3. **Takeaway.** In 2 to 4 sentences: who wins for which kind of user, and what the main tradeoff is.

## Calibration

Be direct about uncertainty. Distinguish:

- Observable facts (pricing, features on a page, open-source license)
- Reported facts (news articles, analyst claims)
- Your inferences (positioning guesses, strategic bets)

Mark the last category explicitly. A confident inference that's wrong is worse than a hedged inference that's right.
