---
name: safe-task-runner
description: Use this skill for any coding task that needs stable execution, tight scope control, reduced wandering, or protection against long-running commands and partial work.
---

# Safe Task Runner

Use this skill to keep development tasks small, bounded, and verifiable.

## Core rules

1. Restate the task scope before editing.
2. Explicitly say what will not be changed.
3. Inspect only the files needed for the task.
4. Avoid broad repository scans unless the task requires them.
5. Do not start multiple long-running commands at the same time.
6. If a command appears stuck or produces no useful output for too long, stop it and report the situation.
7. Prefer small, reversible changes.
8. Do not refactor unrelated code.
9. Do not introduce new dependencies unless the user explicitly asks.
10. Always finish with a concise report.

## Required final report

Include:

- Files changed
- What was completed
- What was not completed or remains risky
- Commands/checks run and their results
- Any manual verification still needed

## When blocked

If the task cannot be completed safely:

1. Stop.
2. Explain the blocker.
3. Report the current repository state.
4. Do not guess or continue with unrelated changes.
