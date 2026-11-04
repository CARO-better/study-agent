# Task 2 fix1 scoped re-review

**Spec compliance for reviewed fixes: PASS.**

**Code quality for reviewed fixes: APPROVED.**

Reviewed `task-2-fix1.diff`, the appended fix1 evidence in `task-2-report.md`, and the corresponding current source/test lines for commit range `26faac5..e1d45c5`. This is a scoped re-review of the two original findings plus the approved experiment task enum; it is not a new broad review. No test suite was rerun, no repository/Git edits were made, and no cloud/network calls occurred. The report supplies three RED regressions followed by 14 passing records tests and 28 passing total tests; those historical execution results were not independently recreated.

| Reviewed item | Status | Source assessment |
| --- | --- | --- |
| Parent course change invalidates existing children | ADDRESSED | `cloudfunctions/api/core/records.js:72-75` checks direct children before saving a changed course in the existing owner-guarded transaction. Both another course and null are handled. It rejects incompatible moves without rewriting descendants or completion state. `tests/records.test.js:123-141` checks unchanged complete records/versions after rejection, ordinary child editing, same-course editing, and permitted standalone moves. |
| Semester shrink invalidates course schedule weeks | ADDRESSED | `cloudfunctions/api/core/records.js:76-79` checks all linked course schedules before saving a teachingWeeks reduction and rejects an out-of-range week. Existing schedules are retained. `tests/records.test.js:143-156` checks unchanged records/versions, subsequent ordinary course editing, and a successful shrink after explicit schedule correction. |
| Approved experiment task type | ADDRESSED | `cloudfunctions/api/core/records.js:29` now accepts `experiment` through the shared create/update validator; ordinary patch merging retains it. `tests/records.test.js:158-166` covers create, title-only update and explicit conversion from another type. The API README documents the enum and both invariant guards. |

**New findings introduced by this diff: Critical 0; Important 0; Minor 0.**

Both original Important findings are resolved in the inspected source. The fix preserves server-derived ownership, version checking, the fixed Result envelope, and transaction boundaries. Real cloud integration and deployed security-rule application remain the previously stated environment limitations, with no changed claim of live verification.
