# Link whole activities to at most one planned session

Each Completed Activity has zero or one Link to a Planned Session, while a Planned Session may receive many Completed Activities for split recordings. Multi-modal sessions use separate Planned Sessions and separate Completed Activities rather than allocating one combined activity across plans.

Immediately after manual creation or FIT import, versioned deterministic matching evaluates eligible Planned Sessions. Exactly one candidate creates an automatic Link; multiple candidates create no Link until the athlete selects and confirms one; zero candidates leave the activity unmatched. The athlete may change or remove a Link, and Link creation never sets or implies a Session Outcome.

Whole-activity Links avoid fabricated attribution and partial-capacity bookkeeping while preserving split-recording evidence. They trade away representing one recording across plans, so existing activities with multiple Links must be preserved and surfaced as unresolved during migration for explicit athlete resolution; migration must not guess, discard data, or fabricate a replacement.
