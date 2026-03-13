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

## Coming Soon

### Identity
- `perspective()` — role and expertise that shape how an agent interprets information
- `constitution()` — values and constraints that guide agent behavior
- Types and interfaces are defined; implementation is queued

### Perception
- Sensory processing and context framing
- Signal extraction from noisy input
- Multi-modal input normalization

### Reasoning
- Structured deliberation patterns
- Chain-of-thought composition blocks
- Planning and strategy selection

## Planned

### Metacognition
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
