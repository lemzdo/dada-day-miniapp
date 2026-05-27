---
name: data-flow-refactor
description: Use this skill for data models, state fields, API contracts, request and response shapes, database tables or collections, persistence rules, soft delete, history, favorites, caching, and frontend-backend consistency.
---

# Data Flow Refactor

Use this skill when a task involves data shape, storage, state transitions, or API contracts.

## Workflow

1. Locate existing types or schemas.
2. Locate persistence code.
3. Locate API or function boundaries.
4. Locate all important callers and consumers.
5. Identify the current state flow.
6. Decide whether the requested change needs a new field, changed field, or derived value.
7. Keep frontend, backend, database, and type definitions consistent.
8. Avoid duplicate state fields that represent the same fact.
9. Preserve backward compatibility when existing records may already exist.

## Rules

- Do not change data structures based on assumptions.
- Do not update only one layer if other layers depend on the same contract.
- Be explicit about migrations or manual database changes when needed.
- Prefer simple state machines over scattered boolean flags.
- Consider idempotency and duplicate actions.

## Required final report

Include:

- Data entities affected
- Fields or contracts changed
- State flow before and after
- Files changed
- Compatibility or migration notes
- Checks run
