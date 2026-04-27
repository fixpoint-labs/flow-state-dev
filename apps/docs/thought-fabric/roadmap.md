---
sidebar_position: 5
---

# Roadmap

This is a living document. Thought Fabric builds on top of flow-state-dev, so its timeline depends on the base framework's progress.

## Shipped

### Attention
- `filterRelevance` — deterministic keyword-based relevance filtering (handler block)
- `scoreSalience` — LLM-based multi-dimension salience scoring (generator block)

### Memory
- Working memory — bounded, salience-scored session resource with ACT-R power-law decay
- `workingMemoryCapture` — bundled observe → remember → tick sequencer
- Individual blocks: observe, remember, tick, snapshot, add
- Helpers: add, evict, pin, unpin, refresh, advance, items, formatForContext
- `workingMemoryContextFormatter` — ready-made context slot for generators

### Identity (partial)
- `perspective()` — structured viewpoint model with config validation and frozen instances
- `system()` — factory that bundles blocks, capability, resources, and capture pipeline
- Static blocks: `perspectiveApply`, `perspectiveAnalyze`, `perspectiveAuditor`
- Stateful blocks: `perspectiveObserve`, `perspectivePosition`, `perspectiveChallenge`, `perspectiveSnapshot`, `perspectiveAdvance`
- Resource-backed observations (session-scoped) and positions (configurable scope)
- `createPerspectiveCapability` — capability with `static` and `accumulated` context presets
- Helpers: add/remove/challenge/read/format for observations and positions
- Static formatters: `formatPerspective`, `summarizePerspective`, `perspectiveContextFormatter`

### Metacognition (partial)
- `biasAnalyzer` — bundled sequencer: detect → classify → score → counterpoint → format
- Sycophancy detection with 4-dimension scoring (agreement, validating language, omitted counterpoints, framing adoption)
- 6 cognitive bias types: sycophancy, confirmation bias, anchoring, authority deference, recency bias, false consensus
- Counter-argument generation when score exceeds threshold
- Individual blocks exported for remixability: `biasDetectAgreement`, `biasClassify`, `biasScore`, `biasCounterpoint`, `biasFormat`
- Helper functions: `labelForSycophancyScore`, `computeCompositeSycophancyScore`, `shouldGenerateCounterpoints`, `summarizeBiasFindings`
- Conforms to `AnalyzerResult` contract for Response Auditor pattern integration

## Coming Soon

### Identity (remaining)
- `constitution()` — values and constraints that guide agent behavior
- Salience drift — perspective weights evolve with observation frequency

### Perception
- Sensory processing and context framing
- Signal extraction from noisy input
- Multi-modal input normalization

### Reasoning
- Structured deliberation patterns
- Chain-of-thought composition blocks
- Planning and strategy selection

## Planned

### Metacognition (remaining)
- Confidence calibration
- Strategy selection and self-correction
- Performance self-monitoring

### Learning
- Pattern extraction from interaction history
- Skill acquisition and feedback integration
- Adaptive behavior modification

## Design Principles

Each domain follows the same pattern:
- **Blocks** that compose with flow-state-dev sequencers and tools
- **Helpers** for direct resource manipulation
- **Resources** declared via `defineResource()` with automatic flow integration
- **Context formatters** for injecting domain state into LLM prompts

No separate runtime. No special execution model. Thought Fabric blocks are flow-state-dev blocks.
