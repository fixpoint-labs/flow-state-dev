---
"@flow-state-dev/shift-manager": patch
---

Shift Manager's review card and approval card draw their text as Markdown, the way chat messages do: a review's prompt, a coding run's commit subjects and an approval's message show bold, inline code and lists instead of literal `**` and backticks. A commit subject stays one line. HTML in the text shows as text (FIX-2544).
