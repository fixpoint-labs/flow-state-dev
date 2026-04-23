# AI News

Extra guidance when the question is about AI, ML, LLMs, models, labs, funding, benchmarks, or releases. Load this on top of the core `check-news` playbook.

## Recency targets

The AI space moves in weeks, sometimes days. Default freshness thresholds:

- **Model releases, benchmarks, new labs** → prefer the last 14 days.
- **Company moves** (funding, leadership, partnerships) → last 30 days.
- **Research trends or ecosystem shifts** → last 90 days.

Be suspicious of anything older than 6 months even as background — the field's framing shifts fast.

## High-signal sources

Prefer these in roughly this order:

1. **Official labs**: `openai.com/blog`, `anthropic.com/news`, `deepmind.google/discover`, `mistral.ai/news`, `ai.meta.com/blog`, xAI, Cohere, `together.ai/blog`.
2. **Model cards and system cards** on the lab's own domain or Hugging Face.
3. **Primary reporting**: Reuters, Bloomberg, The Information, Stratechery for analysis.
4. **Benchmarks**: `lmarena.ai`, `artificialanalysis.ai`, `livebench.ai`. These change weekly — always check the date.
5. **ArXiv** for research papers. Cite `arxiv.org/abs/YYMM.NNNNN` directly, not a secondary writeup.

Lower-signal:

- **Twitter / X threads** — useful for pointers, not for claims. If a thread is the only source, say so.
- **HN comments** — good for sentiment and "what engineers think", not for facts.
- **"AI news" newsletters and aggregators** — check their source links; don't cite the aggregator.

Avoid:

- Content farms with generic URLs and no named author.
- AI-generated summary sites that re-word primary reporting without adding signal.

## Search query patterns

Useful phrasings to try:

- `<topic> 2026 announcement`
- `<lab name> blog <month> 2026`
- `<model name> benchmark` (follow with a recency filter if the engine supports it)
- `<company> funding round <year>`
- `site:openai.com <topic>` for lab-specific digging

Run two or three phrasings and cross-reference. If only one source reports a claim, flag that.

## Common traps

- **Benchmark gaming**: a new model "beats" an older one on a specific benchmark. Check which benchmarks, at what scale, and whether the comparison is apples-to-apples.
- **Pre-announced features**: labs preview things that ship months later or not at all. Distinguish "announced" from "available".
- **Capability claims without a model card**: treat as marketing until a reproducible artifact exists.
- **Version numbers**: `GPT-4o`, `GPT-4o-mini`, `GPT-4o-2024-08-06` are different. Be specific.
- **Geography**: some releases are region-gated. Note if a feature isn't globally available.

## When to caveat

Open the answer with a caveat when:

- The freshest primary source is older than the target window above.
- You're relying on a tweet or HN comment as the only source.
- A claim is "announced but not shipped".
- A benchmark is self-reported by the lab with no independent confirmation yet.
