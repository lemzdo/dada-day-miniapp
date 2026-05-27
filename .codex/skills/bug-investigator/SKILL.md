---
name: bug-investigator
description: Use this skill to investigate and fix bugs across frontend, backend, scripts, APIs, databases, cloud functions, build tools, or runtime errors.
---

# Bug Investigator

Use this skill when the user reports an error, broken behavior, failed command, incorrect UI state, data mismatch, or unexpected result.

## Investigation flow

1. Identify the exact symptom.
2. Locate the entry point.
3. Trace the call chain.
4. Check data inputs and outputs.
5. Read relevant logs or error messages.
6. Compare expected behavior with actual behavior.
7. Identify the root cause before editing.
8. Apply the smallest safe fix.
9. Run the most relevant check available.

## Rules

- Do not guess API parameters, database fields, or config names.
- Search existing code and docs before changing behavior.
- Avoid broad rewrites.
- Do not fix unrelated issues discovered during investigation unless the user asks.
- Preserve existing behavior outside the bug scope.

## Required final report

Include:

- Symptom
- Root cause
- Files changed
- Fix summary
- Verification performed
- Remaining risks
