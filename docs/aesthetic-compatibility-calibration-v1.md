# Aesthetic Compatibility Calibration V1

## Summary

- Engine version: `aesthetic-compat-v1`
- Fixture version: `aesthetic-compat-fixtures-v1`
- Sample count: 60
- Groups: positive 18, neutral 14, conflict 14, sparse 10, boundary 4
- Production engine adjusted this round: no
- Ranking remains shadow-only: yes

## Score Distribution

| metric | value |
| --- | --- |
| non-null | 52 |
| null | 8 |
| min | 62 |
| max | 86 |
| mean | 73.46 |
| median | 72 |
| p10 | 62 |
| p25 | 62 |
| p75 | 82 |
| p90 | 82 |

## Coverage Distribution

| metric | value |
| --- | --- |
| min | 0 |
| max | 1 |
| mean | 0.8 |
| median | 1 |
| <0.25 | 8 |
| 0.25-0.49 | 4 |
| 0.5-0.74 | 0 |
| >=0.75 | 48 |

## Group Distribution

| group | count | null ratio | score median | score range | coverage median |
| --- | --- | --- | --- | --- | --- |
| positive | 18 | 0 | 82 | 79-84 | 1 |
| neutral | 14 | 0 | 70 | 70-75 | 0.9 |
| conflict | 14 | 0 | 62 | 62-62 | 1 |
| sparse | 10 | 0.7 | 78 | 74-86 | 0 |
| boundary | 4 | 0.25 | 82 | 82-82 | 0.63 |

## Dimension Distribution

| dimension | non-null | null ratio | mean | median | coverage mean | range |
| --- | --- | --- | --- | --- | --- | --- |
| silhouetteBalance | 49 | 0.18 | 74.41 | 70 | 0.82 | 62-86 |
| proportionBalance | 48 | 0.2 | 73.83 | 72 | 0.8 | 62-84 |
| colorHarmony | 50 | 0.17 | 74.24 | 70 | 0.83 | 62-86 |
| patternBalance | 50 | 0.17 | 69.12 | 70 | 0.83 | 62-82 |
| formalityConsistency | 48 | 0.2 | 71.17 | 70 | 0.8 | 62-78 |
| detailBalance | 39 | 0.35 | 74.21 | 82 | 0.65 | 62-82 |

## Evidence Frequency

| code | count |
| --- | --- |
| COLOR_ANALOGOUS | 1 |
| COLOR_CONTROLLED_CONTRAST | 3 |
| COLOR_MONOCHROMATIC | 1 |
| COLOR_NEUTRAL_ACCENT | 18 |
| COLOR_TOO_MANY_DOMINANT_HUES | 14 |
| DETAIL_BALANCED_DISTRIBUTION | 3 |
| DETAIL_COMPETING_FOCUS | 14 |
| DETAIL_SINGLE_FOCUS | 22 |
| FORMALITY_ALIGNED | 21 |
| FORMALITY_INTENTIONAL_MIX | 13 |
| FORMALITY_LARGE_GAP | 14 |
| PATTERN_COHERENT_REPEAT | 2 |
| PATTERN_COMPETING_FOCUS | 14 |
| PATTERN_SINGLE_FOCUS | 5 |
| PROPORTION_BALANCED_LENGTH | 15 |
| PROPORTION_CLEAR_LAYERING | 19 |
| PROPORTION_EXTREME_LENGTH_STACK | 14 |
| SILHOUETTE_BALANCED_CONTINUITY | 16 |
| SILHOUETTE_BALANCED_CONTRAST | 19 |
| SILHOUETTE_EXTREME_VOLUME_STACK | 14 |

- Polarity: positive 118, neutral 40, negative 84
- Strength: 1=132, 2=26, 3=84

## Findings

- Distribution inversions: none
- Score concentration: none
- Expectation failures: none
- Unknown evidence codes: none
- Order sensitivity: none
- Mutated inputs: none

## Ranking Fusion Proposal

- Keep existing hard candidate eligibility rules ahead of aesthetic scoring.
- Only allow ranking influence when `aestheticEvaluation.score != null` and `coverage >= 0.50`.
- Use `centeredScore = clamp((score - 70) / 25, -1, 1)`.
- Use `reliability = clamp((coverage - 0.50) / 0.30, 0, 1)`.
- Use `aestheticDelta = centeredScore * reliability * 6`, range `-6..+6`.
- Future ranking recommendation: `rankingScore = existingTotal + aestheticDelta` without writing the delta into `scores.total`.
- Do not enable formal ranking until real shadow samples, Stage 1 deployment smoke tests, and manual color-protection checks pass.

## Current Limitations

- Fixtures are synthetic and contain no real user data.
- This report validates offline score shape, not real wardrobe distribution.
- The production function still returns `aestheticEvaluation` in shadow mode only.
