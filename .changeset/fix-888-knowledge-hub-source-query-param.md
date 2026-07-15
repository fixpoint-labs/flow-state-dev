---
---

FIX-888: Wire the Knowledge Hub's `source` capture field as an installation-level value. The lab's MCP adapter now passes `forwardQueryParams: ["source"]`, so a client pointed at a tagged endpoint URL (`.../mcp?source=claude-desktop`) stamps that provenance on every capture instead of relying on the model to supply it. Private lab package — no publishable surface change.
