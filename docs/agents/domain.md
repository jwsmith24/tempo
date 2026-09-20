# Product and domain documents

`docs/PRODUCT-BRIEF.md` is authoritative for product purpose, principles, scope, delivery stages, and MVP acceptance.

`CONTEXT.md` is authoritative for domain vocabulary. Use its terms consistently and surface contradictions rather than introducing aliases.

Architecture decisions live in `docs/adr/`. Read every applicable ADR before changing architecture or behavior governed by a recorded decision. New durable decisions belong in a new ADR; preserve existing records as historical decisions.

When these sources conflict, stop and identify the conflict for maintainer resolution. Do not silently choose or duplicate authoritative content in agent instructions, specifications, or tickets.
