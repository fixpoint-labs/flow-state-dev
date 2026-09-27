---
"@flow-state-dev/workforce": patch
---

A seat on the built-in `agent` kind now hands its model the earlier turns of the conversation it is in, so a follow-up keeps its subject. Each channel a seat hears and each direct conversation is its own conversation, and none of them sees another's turns. The window is the session's history window, the last 50 turns by default. Previously every turn reached the model with only the system prompt and the new message (FIX-1612).
