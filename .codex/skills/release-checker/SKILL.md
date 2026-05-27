---
name: release-checker
description: Use this skill for pre-release checks, production readiness, deployment preparation, environment variables, build commands, configuration, permissions, API endpoints, and leftover debug or mock code.
---

# Release Checker

Use this skill before publishing, deploying, or handing off a project.

## Checklist areas

1. Build commands
2. Type checks
3. Lint or formatting checks
4. Tests, if available
5. Environment variables
6. Production and development config differences
7. API endpoints and domain allowlists
8. Third-party service keys and quotas
9. Permissions and privacy settings
10. Leftover mock data, debug flags, console logs, or temporary code
11. Error handling and empty states
12. Deployment documentation

## Rules

- Do not change production settings unless the user asks.
- Do not expose secrets in the report.
- Do not assume deployment success without running or verifying the relevant command.
- Separate blocking issues from recommended improvements.
- Keep the output actionable.

## Required final report

Include:

- Blocking issues
- Non-blocking risks
- Checks run
- Config items needing user action
- Recommended next step
