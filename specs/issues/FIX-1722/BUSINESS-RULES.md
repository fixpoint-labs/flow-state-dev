# FIX-1722 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. The epic's rules (ER-n, [FIX-1649](../../epics/FIX-1649/BUSINESS-RULES.md))
and the shell's frame and send rules apply as written; these are what the Chief of Staff view
adds. *Proved by* names the kind of check the plan runs.

## Landing and the sidebar

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Shift Manager opens at `/`, at `/cos`, or at a path it doesn't know | The Chief of Staff view, with its sidebar entry marked current. `/inbox`, `/tasks` and every other route open as before | Goal check · CI |
| BR-2 | The sidebar renders | *Chief of Staff* is the first entry, above Inbox. It carries no count and no dot. Roster, TEAMS and the footer are FIX-1723's | CI |
| BR-3 | The Lab refuses Shift Manager, or can't be reached | The refusal or unreachable screen, as today; the Chief of Staff view waits behind it like every other | CI |

## The shift summary

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | The view opens | The summary, labelled as Shift Manager's, says how many things need the person, how many runs are going and across how many workstreams. Every number comes from the snapshot the sidebar reads, so it equals Inbox's and Tasks' counts | Goal check under `static-brief` |
| BR-5 | Asks are pending | Each is listed, oldest first, with Inbox's card for its kind: Approve and Deny on an approval, the options on a question, and a link to its detail in Inbox. An ask the Lab won't reopen from outside shows without buttons and says why, as in Inbox | Goal check |
| BR-6 | An ask is answered from the summary | It goes through Inbox's answer path. It leaves both the summary and Inbox once the store says it is answered, never before; the counts follow | Goal check |
| BR-7 | Nothing is pending | The summary says nothing needs the person, and still gives the running counts | CI |
| BR-8 | A read the summary uses fails | That line says what the Lab answered and offers Retry; the rest of the view still draws | CI |
| BR-9 | FIX-1723's on-call function has not merged | The summary leaves out workers on call. Once it has, the summary adds them from that function | CI |

## The conversation

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | The Lab's inventory holds exactly one seat that is the CoS ([D2](DECISIONS.md#d2)) and it has a door | The conversation and its composer show, headed with the seat's name. The composer's placeholder names the CoS and promises nothing about routing | Goal check |
| BR-11 | The inventory holds no CoS seat | The summary shows; in place of the conversation, a named state: the Lab declares no chief of staff, and a seat named `chief-of-staff` on the `agent` kind adds one | Goal check (DevTeam) |
| BR-12 | The inventory holds two or more | A named state naming them; Shift Manager talks to neither | CI |
| BR-13 | The CoS seat has no door | The conversation shows any stored items; the composer is disabled with *takes no message*, as other composers say it | CI |
| BR-14 | The person has a direct session with the CoS seat | The view shows the newest one's items in stored order: their lines and the seat's replies and tool calls, drawn with the registry copies. A session a channel post or another run started is never this conversation | Goal check (**again**) · CI |
| BR-15 | The person sends a line | Through the shell's one send path and the seat's door. With no session yet, the first line opens one through that door. *Delivered* only when the session holds the line; refused, not sent and unconfirmed keep the draft exactly as other composers do | Goal check under `optimistic-reply` |
| BR-16 | The door's request is running | A working line under the person's message; the composer takes no second line until the request ends | CI |
| BR-17 | The request ends | The session's items after the person's line are drawn as they are stored. Nothing is drawn as the CoS's that the session doesn't hold; a request that fails shows its reason by the composer | Goal check |
| BR-18 | The model is slow | Nothing times out on screen before the send path does; *unconfirmed* is the send path's answer | CI |

## The rail

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | The view renders | STREAMS lists each workstream with its running rows and its members' pending asks, from the snapshot; a row opens the workstream | Goal check |
| BR-20 | FIX-1723's on-call function has merged | ON CALL lists the seats it calls on call, with their count. Before it merges, ON CALL is a named gap naming FIX-1723 | CI |

## Failure taxonomy

| Failure | Shown as | Retry |
|---|---|---|
| A snapshot read fails | That section's own failure line with what the Lab answered | Yes, per section |
| No CoS seat · two CoS seats · no door | A named state (BR-11 to BR-13) | No: the Lab's tree decides |
| A line refused, not sent, unconfirmed | The send path's own states; the draft stays | Only *not sent* |
| The conversation's session read fails | A failure line in the conversation; the composer is disabled until it reads | Yes |

## Acceptance this issue owns

- Every Lab lands on Chief of Staff (BR-1).
- The summary's counts equal Inbox's, Tasks' and the store's, and its asks answer through Inbox's
  path (BR-4 to BR-6).
- A person talks to the CoS seat and sees its stored reply; *delivered* means held (BR-15, BR-17).
- A Lab with no CoS still lands and works (BR-11).
- Nothing changes in an FSD package (epic ER-7).
