# Task 3 report

Status: DONE_WITH_CONCERNS
Commit: ce5abb870062ec2314c96c9132f951f576a59a83 (branch codex/study-agent)

Implemented deterministic planner, guarded plan and revision storage, explicit availability/period mapping, owner-scoped generate/get/progress/undo/manual actions, batched progress-triggered selective replan, conflict-safe undo, and collection/security checklist updates. Exact payloads and behavior are in `cloudfunctions/api/README.md`.

TDD: observed expected RED for missing planner/API, plus RED for stale transaction scans, locked block accounting, unaffected block retention, class conflicts, undo snapshot and settings conflicts, and generic deletion. Focused `node --test tests/planner.test.js`: 13 passed. Full `npm test`: 41 passed. `git diff --check` passed. No real CloudBase deployment, identity, rules, indexes, timing/quotas, external AI or WeChat verification was performed.

Material limitations: task-level recurring schedule metadata is not expanded as a fixed calendar (manual locked blocks required); planner parameters are configurable in core but public API uses defaults. If a course or its period settings are changed after a manual block exists, generate preserves the manual block even if now overlapping a class; no conflict is currently surfaced. Revision records store full snapshots and need CloudBase document/transaction size controls at scale. Availability is explicit dated intervals, not a recurring availability editor. These are follow-up concerns before treating this as production-ready.

## Follow-up (supersedes the earlier limitations on course conflicts and API settings)

New HEAD: 752a61f3a52e63997029a3a58f28ee4786a7a0a1. Existing retained blocks overlapping updated course times now return `class_overlap` without writing; users can remove a locked manual block with the versioned `plan.removeManualBlock` action. `profiles.setAvailability` now accepts validated `plannerSettings` for min/max study length and rest interval. README documents exact forms and constraints.

Observed RED for class conflict, configurable block duration, and missing manual removal before implementation. Focused `node --test tests/planner.test.js`: 17 passed; full `npm test`: 45 passed; `git diff --check`: passed. No CloudBase deployment or live-service verification. Remaining limitations: optional task-level recurring schedule metadata is not expanded; revision snapshots and scans require production size/transaction quota assessment; availability is dated intervals.

## Fix round 1

Commit: 0a58486739840924ed6d7b7f88868e3037f1f438. Undo previews remaining-work conflicts; retained study blocks reserve rest on both sides; progress is saved even if a retained block overlaps a class, returning needs_attention and preserving the plan; null progress entries return VALIDATION. API behavior documented in README.

RED command: `node --test tests/planner.test.js` -> tests 20, pass 17, fail 3: undo accepted excessive prior work, rest buffer absent, null produced INTERNAL instead of VALIDATION. The progress conflict case was in the same test and reached after the null assertion was fixed.

GREEN commands: `node --test tests/planner.test.js` -> tests 20, pass 20, fail 0; `npm test` -> tests 48, pass 48, fail 0; `git diff --check` -> exit 0 (line-ending warning only). No deployment or live service verification.

## Fix round 2

Commit: 8e3af0230003b44ce6dfaf9ead743468671d914a. Progress and versioned attention status/conflicts are saved atomically; plan.get exposes the marker. Dirty plans rebuild globally instead of preserving unaffected stale blocks. Incompatible locked blocks remain and produce conflicts, while successful rebuild clears the marker; undo is blocked while dirty.

RED: `node --test tests/planner.test.js` -> 21 tests, 20 passed, 1 failed; persisted status was undefined instead of needs_attention. GREEN: `node --test tests/planner.test.js` -> 22 passed, 0 failed; `npm test` -> 50 passed, 0 failed; `git diff --check` -> exit 0. Locked completion coverage added. No deployment or live-service verification.

## Fix round 3

Commit: eb2c6d84060edb9401c007bd780268232028e20f. Revision records whether its entire prior plan required attention; undo rejects that snapshot with `prior_plan_needs_attention`, rather than partially restoring stale blocks, unscheduled entries, reasons, or missing attention metadata. Actual task progress remains unchanged. API behavior documented.

RED: `node --test tests/planner.test.js` -> 23 tests, 22 passed, 1 failed: dirty prior snapshot was accepted. GREEN: `node --test tests/planner.test.js` -> 23 passed, 0 failed; `npm test` -> 51 passed, 0 failed; `git diff --check` -> exit 0. No deployment or live CloudBase verification.
