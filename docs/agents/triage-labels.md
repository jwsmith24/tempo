# Triage states

| State | Meaning |
| --- | --- |
| `needs-triage` | Needs maintainer evaluation |
| `needs-info` | Waiting for reporter information |
| `ready-for-agent` | Fully specified for agent implementation |
| `ready-for-human` | Requires human implementation or judgment |
| `complete` | Acceptance criteria implemented and verified |
| `wontfix` | Will not be actioned |

Record one state as `Status: <state>` in each tracked specification or ticket. A status change requires an explicitly previewed and authorized tracker edit.

An agent may transition an authorized implementation ticket to `complete` when every acceptance criterion is checked and the ticket comments record the verification performed. A specification may transition to `complete` when all of its tickets are complete and its success criteria are verified.
