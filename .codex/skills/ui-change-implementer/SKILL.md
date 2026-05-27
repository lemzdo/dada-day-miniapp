---
name: ui-change-implementer
description: Use this skill for UI, component, layout, style, interaction, responsive, loading, empty-state, error-state, and disabled-state changes in web, mobile, miniapp, React, Vue, or similar frontend projects.
---

# UI Change Implementer

Use this skill for focused UI and interaction changes.

## Workflow

1. Identify the target page or component.
2. Find the smallest local component/style files involved.
3. Preserve the existing design language.
4. Implement only the requested UI change.
5. Consider interaction states:
   - loading
   - empty
   - error
   - disabled
   - selected
   - repeated click
   - navigation away
6. Check mobile or responsive behavior when relevant.
7. Avoid global CSS changes unless necessary.

## Rules

- Do not change data models unless the UI request requires it.
- Do not alter unrelated pages.
- Do not replace existing components with a full rewrite.
- Keep copywriting consistent with the existing product tone.
- Prefer local styles over global overrides.

## Required final report

Include:

- UI areas changed
- Files changed
- Interaction states handled
- Checks run
- Any visual risks or manual testing notes
