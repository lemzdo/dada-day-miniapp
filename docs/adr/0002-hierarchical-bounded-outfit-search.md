# ADR 0002: Hierarchical Bounded Outfit Search

- Status: Accepted
- Date: 2026-09-09
- Implementation: `hierarchical-outfit-search-v2`

## Decision

Use role buckets, cheap pre-filtering, bounded skeleton search, structural completion and deterministic
accessory beam completion before final eligibility, scoring and diversity-aware reservoir selection.
Budgets are derived from target batches and role opportunities. Do not materialize an unbounded Cartesian
product and truncate it afterward; do not use random truncation as a substitute for search.

## Consequences

300/500-item full benchmarks can run through the bounded engine without old cubic candidate materialization.
Quality must be checked with the full-ensemble exhaustive oracle and the four scene suites; bounded counts
alone do not prove recommendation quality.
