---
"@flow-state-dev/core": patch
---

A streaming text generator whose turn writes text in more than one step (text, then a tool call, then more text) now separates each step's text with a blank line, in both the streamed assistant message and the generator's output. Before, the pieces ran together with no space at the step boundary ("…the tool.I've filed…") (FIX-1626).
