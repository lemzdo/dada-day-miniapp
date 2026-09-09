# ADR 0005: Recommendation Scaling Contract

- Status: Accepted
- Date: 2026-09-09

## Decision

Every substantial Recommendation Core change is checked at wardrobe sizes 30, 100, 300 and 500. The
benchmark records role counts, skeleton/structural/accessory expansions, full candidate count, eligibility
and scoring counts, reservoir count, P50/P95 and heap/GC availability. 30/100 legacy results remain a
compatibility baseline; the bounded engine runs full at all four sizes. 300/500 legacy full materialization
is prohibited unless separately proven memory-safe; legacy count-only estimates remain available.

## Gates

Automatic gates enforce candidate expansion budgets, eligibility/scoring budgets, bounded full-candidate
materialization, memory safety and selected quality fixtures. Scaling is not considered complete from
latency alone: legacy core oracle equivalence, full-ensemble exhaustive oracle comparison, scene correctness,
diversity and refresh no-repeat must also pass.

## Evidence boundary

The performance ledger records local measurements and labels production timing separately. No production
P50/P95, DB save timing or GC trend may be inferred from a local fixture.
