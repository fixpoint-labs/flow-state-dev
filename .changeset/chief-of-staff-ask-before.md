---
"@flow-state-dev/workforce": minor
---

`createSeatHireCapability` gives a seat `brokenSeats` and `rehire` tools, and takes `askBefore` to make `hire` or `fire` wait for a person's approval (`rehire` always waits) and `refuseRosterAdmin` to keep those tools off the seats it hires, so a Shift Coordinator can change the roster with a human in the loop (FIX-1719).
