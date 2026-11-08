---
"@flow-state-dev/react": minor
---

`useHarnessLines` takes an `input` option, the turn action's input for a line (default `{ prompt: line }`), so any flow's turn action can use it, a plain chat's included. It returns `waiting`, the lines still waiting for the running turn, oldest first, for a page to mark. It now keeps one waiting turn on the server at a time: a later line waits in the page and is sent once the turn before it has started, because `defer` doesn't start waiting requests in the order they arrived. A line held in the page is lost on a reload; moving the view to another session sends the held lines to the session left. (FIX-2376)
