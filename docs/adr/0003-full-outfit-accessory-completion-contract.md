# ADR 0003: Full Outfit / Accessory Completion Contract

- Status: Accepted
- Date: 2026-09-09

## Decision

Every real item in the final ensemble—core, structural or accessory—must participate in final outfit
identity, eligibility, scoring, evidence authorization and materialization. Optional slots may select NONE;
the wardrobe must not be padded with synthetic items. Outerwear, socks, gloves, scarf, hat, bag, belt,
necklace, bracelet, watch and future roles remain extensible role buckets.

## Oracle

Legacy core equivalence applies only to fixtures unaffected by optional-item semantics. Full accessory
correctness uses the small exhaustive oracle in `recommendationOracle.js`; attaching an optional item after
selection is not an acceptable full-ensemble reference.

## Consequences

Any identity/schema change that includes optional items invalidates old candidate-pool semantics. Old pools
must miss safely rather than hydrate as new full-outfit meaning.
