# Task 2 implementation report

Status: complete for local implementation and automated validation. Commit `26faac5831ddbdb456f96b43017e987ff72a7136` on `codex/study-agent`, based on `731226f1a6fbe7ca31c289ed98ed4fc3595a6711`, canonical repo `D:\study-agent`. Final `git status --short` empty. No deployment, paid service operation, credentials discovery, OCR/model/search request, or real WeChat request was performed.

## Delivered files

- `cloudfunctions/api/index.js`: secure WX-context entry, injected local handler, fixed Result envelope and safe error handling.
- `cloudfunctions/api/core/{records,imports,errors}.js`: profile/semester/course/task CRUD; ownership-safe reference/cycle validation; version conflicts; reviewed draft confirmation/merge/separate save; explicit missing-date semantics; expiry mark/raw text discard; own JSON export and confirmed exact-scope physical deletion.
- `cloudfunctions/api/adapters/repository.js`: actual production CloudBase transactional repository plus injected memory repository with the same contract; owner guard, stable scoped IDs, version checking, pagination and atomic rollback.
- `cloudfunctions/api/package.json`, lockfile: self-contained deployable function package, pinned `wx-server-sdk@3.0.1`.
- `cloudfunctions/api/README.md`: complete action/payload/schema/repository contract and deployment boundaries for subsequent tasks.
- `deployment/database.json`: manual collection/index checklist, deliberately not a claimed executable CloudBase import format.
- `deployment/security-rules.json`: per-collection private own reads, denied client writes, fully denied credentials and locks.
- `tests/records.test.js`, `tests/repository.test.js`; `.gitignore` ignores workspace npm cache.

Shared modules intentionally live INSIDE the api function for deployment packaging. Later functions must copy/package their own required shared modules and preserve the owner-guard write protocol.

## TDD evidence

1. Wrote nine domain behavior tests before production implementation. Since modules did not exist, a temporary test-only absent-module fallback returned `{ok:false,error:{code:'NOT_IMPLEMENTED'}}`; this produced behavior assertion failures, not loader crashes. Removed that fallback once implementation existed.

Command: `node --test tests/records.test.js`

Initial RED output (2026-11-04):

```text
fail owner isolation rejects reading and updating another user record; metadata is server owned
fail stale concurrent edits return CONFLICT and retain the winning update
fail draft stays outside tasks until reviewed; missing deadlines remain null and require confirmation
fail relative Friday uses explicit China calendar base and missing bases or teaching weeks remain unresolved
fail domain CRUD preserves group/exam/schedule data and validates references and states
fail duplicate confirmation requires explicit save or merge and merge checks target version atomically
fail expired drafts are marked for cleanup and cannot be confirmed
fail JSON export excludes other users and scoped deletion requires confirmation plus exact versions
fail cloud entry ignores client owner and suppresses vendor errors and missing WX identity
tests 9; pass 0; fail 9; exit 1
```

Typical failure: expected `result.ok === true`, actual false with NOT_IMPLEMENTED. The secure-entry test expected a handler and found none.

2. Implemented domain, imports, memory and CloudBase adapter, entry and rules. Initial implementation run: 8 pass / 1 fail; literal server clock expectation showed that the test fixture injected only the domain clock, not the repository clock. Corrected fixture to inject the same controllable clock into both; 9/9 passed.

3. Added shared repository contract checks using the real memory repository and the real CloudBase adapter with a narrow local SDK transport double. Tests verify ownership/version/copy isolation, multi-record rollback/physical removal, pagination across 205 records and transaction owner override rejection. Six checks passed. These are local adapter-contract tests, NOT real CloudBase tests.

4. Inspected installed SDK source without initializing or making any cloud call. Found `doc.get()` throws on missing documents by default, including owner-lock creation; added bootstrap test before its production fix. Also added regression test for internal `_collection` leakage on update. RED: 11 tests, 9 pass / 2 fail. First expected `_collection` absent but got present; second expected a production bootstrap function but it did not exist. Fixed by stripping internal metadata in transactional memory reads and bootstrapping DB with `{throwOnNotFound:false}`. Both pass.

## Final verification output

Immediately before commit:

```text
node --test tests/records.test.js
tests 11
suites 0
pass 11
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 85.5424
```

```text
npm test
> study-agent@0.1.0 test
> node --test tests/*.test.js

PASS 8 existing config/privacy/import-boundary tests
PASS 11 records/import/security/bootstrap tests
PASS 6 memory/CloudBase-adapter local contract tests
tests 25
suites 0
pass 25
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 229.0194
```

`git diff --check`: no whitespace errors (Git emitted its Windows LF-to-CRLF advisory only).

`npm ci --ignore-scripts --no-audit --no-fund --cache D:\study-agent\.npm-cache --registry https://registry.npmjs.org` in api package: exit 0, `added 120 packages in 11s`. Pinned SDK dependency chain emitted deprecation notices for request/har-validator/uuid; not a test failure. No SDK function init/network call was made. Default npm cache initially lacked write permission; retried using ignored workspace cache. Source writes needed narrowly granted D: permission; git index write needed narrowly authorized escalation, then commit succeeded. No approval rejection occurred.

## Interfaces for next tasks

Public event `{action,payload}`; owner always comes from server WX OPENID. Internal `handleAction({owner,action,payload},deps)` returns Promise<Result>. `deps.repository`, `now`, `newId` are injectable. Error codes: UNAUTHENTICATED, VALIDATION, NOT_FOUND, CONFLICT, INVALID_REFERENCE, HAS_DEPENDENTS, CONFIRMATION_REQUIRED, DUPLICATE_CHOICE_REQUIRED, DRAFT_EXPIRED, UNKNOWN_ACTION, INTERNAL. Unknown vendor exceptions become INTERNAL with static safe wording.

Actions:

- `profiles|semesters|courses|tasks . create|get|list|update|delete`; create `{record}`, get `{id}`, list `{query?}`, update `{id,expectedVersion,patch}`, delete `{id,expectedVersion,confirmed:true}`.
- `imports.create {source:'text'|'screenshot',text,candidates,referenceDate?}`; imports.get/list; `imports.confirm {id,expectedVersion,reviewed:true,choices:[{index,choice:'save'|'merge'|'skip',patch?,acknowledge?:['dueAt'],targetId?,expectedVersion?}]}` returns `{draft,tasks}`.
- `imports.markExpired {}` sweeps only authenticated user's expired pending drafts, erases recognition text/candidates and marks status expired.
- `data.export {}` returns `{format:'study-agent/v1',json}` with own five domain collections only.
- `data.delete {confirmed:true,scope:{collection,records:[{id,version}]}}` atomically physically deletes exact scope (1..100 items), with dependent guards.

All formal records carry id,ownerOpenId,version,createdAt,updatedAt; expectedVersion 0 creates, subsequent saves increment. Tasks use `status:pending|in_progress|completed|cancelled`, `type:assignment|exam|group|study|other`, nullable dueAt, remainingMinutes integer >=0; optional courseId,parentTaskId,examScope,personalResponsibility,schedule,estimatedMinutes,priority,fixed. Course schedule entries `{weekday,weeks,periods,location?}`. Deadline dates may be YYYY-MM-DD or timezone-explicit ISO timestamps. No deadline clock time is invented. 下周五 under referenceDate 2026-11-04 resolves to 2026-11-13.

Repository: get(owner,collection,id), list(owner,collection,query), save(owner,collection,record,expectedVersion), transaction(owner,callback). Transaction view adds remove(owner,collection,id,expectedVersion). All server writers must use this transaction path and ownerLocks guard. Do not call third parties inside transactions. Full field contract and examples: `D:\study-agent\cloudfunctions\api\README.md`.

## Concerns and unverified boundaries

- Actual WeChat OPENID, CloudBase SDK requests/transactions/indexes/security-rule application are UNVERIFIED; no environment was configured/deployed. Domain and transport tests cannot establish production connectivity or security rules actually applied.
- Security rule syntax targets traditional NoSQL mode; PG mode requires separate RLS. Apply per-collection rules before client access; database.json is a manual checklist.
- Owner-level guard provides serializable API writes, including scan-based duplicate/reference checks. All later writers must follow the guard protocol. SDK transaction retry exhaustion currently returns sanitized INTERNAL; stale domain record versions return CONFLICT. Large exports/sweeps may exceed platform's ~10-second transaction lifetime and need bounded batches for large accounts.
- Cleanup is metadata plus an explicit per-owner expiry sweep; no automatic timer/TTL deployed. Confirmed drafts are retained until explicit scope deletion. Later orchestration must schedule/trigger cleanup if automatic cleanup is desired.
- Screenshot drafts accept recognized candidates but perform no OCR. No planner/provider/resource/reminder behavior was added.
- Local Node v24 validation does not prove deployed Nodejs20.19 behavior. The pinned SDK installs successfully but includes deprecated transitive dependencies; assess/update as a separate compatibility change before production release.

Primary references consulted: https://docs.cloudbase.net/database/transaction ; https://docs.cloudbase.net/database/security-rules ; https://github.com/wechat-miniprogram/wx-server-sdk . Installed SDK source also confirmed get default throwing, transaction wrapping, and set/remove shapes.

## Fix round 1 of 5 — independent review + experiment task enum

Commit: `e1d45c5aa331642cdf51605e79837202f46ac27b` (`fix: preserve linked record invariants and experiment tasks`), based on Task 2 commit 26faac5. Clean working tree after commit.

Read the entire task-2-review.md and verified both findings against the actual one-way reference checks. Implemented only the requested fixes:

- Parent task course changes load direct children within the existing owner-guarded transaction and reject incompatible children with INVALID_REFERENCE. No descendant/course/completion rewriting occurs.
- Semester teachingWeeks reductions load linked courses within that transaction and reject out-of-range retained schedule weeks with VALIDATION. No schedule truncation occurs.
- Added explicitly approved `experiment` task type to validation and API README; creation, unrelated edits and conversion from another task type preserve it.

Changed files: `cloudfunctions/api/core/records.js`, `tests/records.test.js`, `cloudfunctions/api/README.md`.

Tests were added before production changes. They assert that both rejected parent course moves (including removing the course) and rejected semester shrink preserve the complete original record, metadata and version; child/course records stay untouched and unrelated edits succeed afterward. Positive cases also verify a same-course parent edit, a standalone course move, and a safe shrink after explicitly correcting a course schedule. Experiment test verifies create, title-only update and explicit type conversion.

RED command: `node --test tests/records.test.js`

```text
PASS 11 pre-existing records tests
FAIL parent course change rejects incompatible children atomically and ordinary child edits remain valid
  AssertionError: true !== false (old implementation incorrectly accepted course move)
FAIL semester shrink rejects out-of-range course weeks atomically and ordinary course edits remain valid
  AssertionError: true !== false (old implementation incorrectly accepted shrink)
FAIL experiment tasks retain their type on create and update
  AssertionError: expected ok true, got VALIDATION
tests 14; pass 11; fail 3; exit 1; duration_ms 93.0916
```

GREEN command after fixes: `node --test tests/records.test.js`

```text
PASS all 14 records tests, including the three new regressions
tests 14; pass 14; fail 0; cancelled 0; skipped 0; todo 0
exit 0; duration_ms 93.2822
```

Full verification: `npm test`

```text
> study-agent@0.1.0 test
> node --test tests/*.test.js
PASS 8 existing config tests
PASS 14 records tests
PASS 6 repository contract tests
tests 28; pass 28; fail 0; cancelled 0; skipped 0; todo 0
exit 0; duration_ms 233.0317
```

`git diff --check`: no whitespace errors; Windows line-ending advisories only. Commit command: `git -c user.name=Codex -c user.email=codex@local commit -m "fix: preserve linked record invariants and experiment tasks"`; output 3 files changed, 56 insertions(+), 3 deletions(-). `git status --short` empty. No cloud/network verification, deployment, credentials access or paid operations were performed. Existing production integration concerns remain unchanged.
