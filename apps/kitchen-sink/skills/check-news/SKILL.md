---
description: Answer questions about current events, breaking news, or "what's happening with X". Use when the user asks about recent news, a developing story, someone's current status, or anything where freshness matters. Enforces recency discipline and source hygiene so answers don't quietly rely on stale material.
keywords: [news, latest, breaking, today, current, happening, recent]
---

# Check News

News answers rot faster than any other kind. A confident-sounding summary built from a 14-month-old article is worse than saying "I don't know yet". When this skill is active, follow the rules below.

## Step 1 — Compute today's date window

Before running any search, get a concrete date range using the bundled helper. From bash:

```
python3 ${CLAUDE_SKILL_DIR}/scripts/date-window.py <kind>
```

Pick the `<kind>` that matches the question:

- `breaking` — a story that broke in the last day (e.g. "what just happened", "is X still alive").
- `recent` — anything where freshness matters but not minute-by-minute.
- `current-state` — "where does X stand", "what's the current situation".
- `ai` — AI / ML / model / lab questions (tighter 14-day window).
- `business` — earnings, M&A, filings, market moves (14-day window tied to reporting).
- `month`, `quarter`, `year` — plain time windows if none of the above fit.

The script prints JSON like `{"kind": "recent", "days": 7, "since": "2026-04-16", "until": "2026-04-23"}`. Use `since` in your search queries (most engines accept `after:YYYY-MM-DD` or a comparable filter). Use `until` when you need to cite the freshness window you're working within.

## Step 2 — Load topic-specific guidance

Different kinds of news have different source hierarchies and different traps. Pick the reference that fits the question and read it before drafting an answer:

- **AI, ML, models, labs, benchmarks** → open `${CLAUDE_SKILL_DIR}/reference/ai-news.md`
- **Geopolitics, elections, conflict, disasters, legal proceedings** → open `${CLAUDE_SKILL_DIR}/reference/world-events.md`
- **Earnings, markets, M&A, filings, corporate moves** → open `${CLAUDE_SKILL_DIR}/reference/business-markets.md`

If the question spans multiple categories, load more than one. If it doesn't fit any, proceed with the core rules below.

Use `cat` or `bash-read-file` to read the reference. The path above is exact.

## Step 3 — Search with recency baked in

Never search for a topic without time-scoping. Include at least one of:

- The current year or month (from the date window script).
- Words like `latest`, `this week`, `today`, `recent`, `update`.
- Event-specific anchors (`Q1 2026 earnings`, `post-election`, etc.).

Run two or three queries with different phrasings. A single query returns what the engine's ranking prefers, which skews toward SEO-optimized evergreen pages.

## Step 4 — Filter results by date

For every candidate source, check the publication date before using it. Default thresholds (topic files may tighten these):

- **Breaking news** → reject anything older than 7 days unless nothing newer exists.
- **"Current state of X"** → reject anything older than 90 days unless nothing newer exists.
- **Undated pages** → treat as suspect. Don't quote numbers, names, or status from them without a dated corroborating source.

If you find a fact on an undated page and confirm it on a dated page, cite the dated one.

## Step 5 — Prefer primary over secondary

- Official statements (company blog, SEC filing, government release) beat news coverage of those statements.
- Original reporting beats aggregators, newsletter round-ups, and "according to reports" pieces.
- Wire services (Reuters, AP, Bloomberg, AFP) beat commentary.

If the only source is a tweet, an AI-generated summary, or a content farm, say so explicitly. Don't launder weak sourcing into confident prose.

## Step 6 — In the response

Always include, per claim:

- **The publication date** of the source (e.g. "published 2026-04-15").
- **The source name** and a link if fetched.
- **The date window you searched within** (from Step 1), so the user can judge whether you looked far enough back.

If sources disagree, show the disagreement rather than picking a side silently. If the freshest source is older than the threshold above, open with that caveat before the answer.

## Step 7 — Don't speculate past the data

If the user asks "what will happen next", and no source says it yet, stop. Distinguish what's reported from what's reasonable inference, and mark inferences as yours.
