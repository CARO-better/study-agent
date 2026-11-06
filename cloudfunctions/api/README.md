# 当前小程序快照接口补充（0.2.0）

`sync.pull` 返回完整 payload/revision/updatedAt。`sync.push` 输入 `{store, expectedRevision, device?}`；服务端原子比较修订号，旧版本返回 CONFLICT。大小按 UTF-8 字节计算，上限 512KiB。

`sync.plan` 输入 `{store, expectedRevision}`，云端计算计划并在同一修订协议下保存完整快照，返回 `{store, revision, updatedAt, bytes}`。计划、课程、任务继续使用当前小程序 ID，旧记录类 API 保留兼容。

`resources.recommendSnapshot` 输入可选 taskIds/limitPerTask/maxTasks，从当前用户完整快照取任务及课程，不从旧 tasks/courses 表取数据。

`ai.chat` 接受字符串和受限用户 text/image_url 内容块；仅接受 PNG/JPEG data URL；总图片编码上限 2MiB。检查工具调用与回执配对。模型 HTTP 请求大小上限 3MiB、超时 25 秒。客户端仅在明确未配置云环境时保留旧直连能力。

数据库所有集合的客户端读写均关闭，OPENID 隔离在云函数服务端执行。`api` 现有 Event/Nodejs20.19 保持，执行超时调整为 60 秒。主密钥与供应商 Key 不得输出或提交。

---

以下保留原有领域 API 的详细契约，不能将旧业务表误当成当前快照恢复来源。

# API and repository contracts (Task 2)

Deploy `cloudfunctions/api/` as a self-contained function package; run `npm ci --ignore-scripts` there before upload. Entry: `index.main`. Pinned SDK: `wx-server-sdk@3.0.1` with lockfile. No real environment is configured and no deployment has been performed.

The public event is `{action,payload}`. `main` takes trusted `OPENID` exclusively from `cloud.getWXContext()`. Client `owner`, `ownerOpenId`, IDs/versions/timestamps inside create records do not control ownership or metadata. Internal `handleAction({owner,action,payload}, deps)` is a server-side domain boundary, not a public identity mechanism. `deps` supplies `repository`, optional `now() -> ISO timestamp`, `newId() -> unique safe string`. Results are `{ok:true,data}` or `{ok:false,error:{code,message}}`; raw SDK errors are never returned.

## Records

`{profiles|semesters|courses|tasks}.{create|get|list|update|delete}`:

- create: `{record}`; returns record. Profiles are one-per-owner.
- get: `{id}`; returns own record or `NOT_FOUND` (also used for other-owner records).
- list: optional `{query}`; equality filters only `status,courseId,semesterId,parentTaskId,type`; returns array.
- update: `{id,expectedVersion,patch}`; returns version+1 or `CONFLICT`.
- delete: `{id,expectedVersion,confirmed:true}`; physically removes own record. `HAS_DEPENDENTS` prevents dangling references.

All saved records include `id,ownerOpenId,version,createdAt,updatedAt`; version starts at 1. Version 0 is create-only in the repository. Metadata is server controlled. Empty optional deadline is represented by null, never guessed.

| Collection | Fields |
| --- | --- |
| profiles | required displayName; timezone defaults to Asia/Shanghai; optional studyGoal |
| semesters | name,startDate,endDate (YYYY-MM-DD),teachingWeeks (1..60) |
| courses | name,semesterId; optional teacher,notes; schedule defaults [] |
| tasks | title,remainingMinutes; type assignment/experiment/exam/group/study/other (default assignment); status pending/in_progress/completed/cancelled (default pending); optional dueAt,courseId,parentTaskId,description,examScope,estimatedMinutes,personalResponsibility,schedule,priority(low/medium/high),mastery(low/medium/high),fixed |

Course schedule is `[{weekday:1..7,weeks:[1..60],periods:[1..24],location?}]`; task schedule uses one such object. Weeks must fit the linked semester for course schedules. Semester-week reductions that would invalidate an existing course schedule are rejected atomically. `examScope` accepts a string or string array. Completed timestamps are server controlled. Parent chains cannot cycle, cross owners, or cross courses; a parent course change incompatible with existing children is rejected atomically. Experiments use type `experiment`. Manually updating task status is allowed, including reopening; reminder logic must check current status. No planner/provider/reminder behavior is implemented here.

## Reviewed imports

`imports.create`: `{source:'text'|'screenshot',text,candidates:[taskLike],referenceDate?:'YYYY-MM-DD'}` returns a versioned `importDrafts` record. At most 30 candidates. Screenshot here means already recognized text/candidates; this route performs no OCR or model call. All recognition output remains a draft.

Candidate output adds `dueAt,needsConfirmation,duplicateIds`. Missing due date remains null. The supported relative phrase `下周五` resolves only with explicit calendar `referenceDate`; e.g. 2026-11-04 yields 2026-11-13, a China calendar date without invented clock time. Missing base/week information remains unresolved. Other ambiguous phrases remain in dueText for review, with no guessed value.

`imports.get {id}`, `imports.list {}` read drafts. `imports.confirm {id,expectedVersion,reviewed:true,choices:[{index,choice:'save'|'merge'|'skip',patch?,acknowledge?:['dueAt'],targetId?,expectedVersion?}]}` requires one explicit choice for every candidate. `save` creates a separate task even if a duplicate is suspected; `merge` replaces selected candidate fields in an owned matching target and requires that target's expectedVersion. Matching uses normalized title+course+deadline. Review can correct fields via patch. A missing date can be deliberately left null via `acknowledge:['dueAt']`; missing schedule weeks must be corrected. Target updates, new tasks and draft confirmation are atomic, so a failed late candidate rolls back earlier writes. Returned data is `{draft,tasks}`. Confirm replay returns CONFLICT.

Drafts get cleanupAfter=created+24h. Expired drafts cannot be confirmed. `imports.markExpired {}` marks only the authenticated owner's expired drafts and discards text/candidates; it is an explicit sweep, not a deployed timer. Confirmed drafts also carry cleanupAfter metadata, but are retained until explicit deletion; there is no TTL deployment.

## Model, credentials and screenshot OCR

`providers.save {url,model,key}` accepts only an HTTPS endpoint without embedded credentials, query, fragment or a non-443 port. The key is sealed with AES-256-GCM (random 12-byte IV, authenticated tag) under the deployment master key `STUDY_MASTER_KEY` (base64, exactly 32 bytes; surrounding whitespace is ignored); only `keyEnvelope` is stored. `providers.get` returns `{url,model,keyMasked,version}` or null, `providers.delete` removes the setting, and `providers.test` performs one real model call. No route, export, error or log returns the key. A missing or rotated master key makes the sealed value unusable rather than decrypting into garbage. `providers.presets` lists the built-in OpenAI and DeepSeek endpoints; any compatible Chat Completions service can be configured.

`callModel({owner,purpose,messages,schema},deps)` sends `temperature:0`, `response_format:{type:'json_object'}`, `max_tokens:2048`. At most 20 messages of 50k characters each are accepted, the reply must parse as JSON and match the caller's schema, and usage is counted once per authenticated owner per China calendar day (`dailyCallLimit`, default 30, ceiling 100). A malformed reply returns `MODEL_FAILED` and creates no record.

Outbound HTTPS goes through `safeRequest`: HTTPS only, no credentials in the URL, port 443 only, no fragment, resolved DNS answers must all be public (IPv4/IPv6 including IPv4-mapped, unspecified, private, link-local, CGNAT, documentation and multicast ranges), the connection is pinned to the checked address, redirects are refused rather than followed, and timeouts, response size, request size and concurrent calls are bounded. Errors are generic strings and never contain the endpoint, headers or credential.

`imports.prepareUpload {contentType?}` returns `{ticketId,cloudPath,fileId,expiresAt}`. `contentType` is `image/jpeg` (default) or `image/png` and decides the stored extension; `STUDY_CLOUD_ENV_ID` plus a matching `STUDY_CLOUD_FILE_PREFIX` are required, otherwise `OCR_UNCONFIGURED`. The storage path is chosen by the server as `imports/<sha256(owner)>/<ticketId>.<ext>`, so a caller cannot pick where bytes land.

`imports.upload {ticketId,base64}` accepts raw base64 or a `data:` URL, at most 6 MB encoded / 4 MB decoded. The bytes must start with a real JPEG or PNG signature and match the ticket's extension, otherwise `VALIDATION`; nothing is written for a rejected payload. A ticket belongs to one owner and authorizes exactly one upload: another owner's ticket, an expired ticket and an already used ticket all return `NOT_FOUND`, so ownership cannot be probed. The upload stays usable for recognition until `cleanupAfter` (24h).

`imports.extractText {text}` returns a reviewed draft from the text model. `imports.extractScreenshot {fileId}` needs the caller's own active ticket **that already carries a validated upload** for that `fileId`; a freshly prepared ticket, another owner's ticket and an expired ticket all return `NOT_FOUND`, so a client cannot hand the OCR service bytes it wrote around the server check. It calls Tencent Cloud GeneralBasicOCR with an independently configured `STUDY_OCR_SECRET_ID`/`STUDY_OCR_SECRET_KEY` (never the text-model key), then hands the recognized text to the text model. Each owner gets `ocrDailyLimit` (default 20, ceiling 60) recognitions per China calendar day, counted before the request; exceeding it returns `USAGE_LIMIT`. Recognized boxes are bounded (1000 boxes, 200 characters each, 50k characters of text) so a draft stays far below the 1MB document limit. OCR or model failure still returns a draft carrying `warnings` and no task; only `imports.confirm` creates formal tasks. An unconfigured OCR service is reported with its own warning text so the UI can point at settings instead of a retry.

`core/upload-cleanup.js` exports `cleanupOwnerUploads(owner,deps)` for a trusted scheduler; it is not a public action and takes the owner from server-owned data. It deletes storage for expired tickets and for drafts already confirmed, abandoned or expired, keeps a ticket until CloudBase confirms the deletion, and retries failures on the next run. `imports.abandon` and `imports.confirm` release the screenshot immediately on a best-effort basis, and `imports.markExpired` returns `{count,uploads}` after sweeping the same owner's uploads. No cross-owner timer is deployed, so a user who never opens the mini program again keeps the object until the 24h sweep of a later run; the scheduled trigger and a global index still have to be designed at deployment time.

Verification boundary for this section: the behaviour above is covered by `tests/providers.test.js` and `tests/imports.test.js` against an in-memory repository with stubbed model, OCR, network and storage. No CloudBase environment, OCR credential, model key or real request has been used, nothing is deployed, and the daily caps are counters rather than vendor billing limits. Because `imports.upload` passes the image through a cloud function event, clients must downscale screenshots to stay inside the platform's call payload limit.

## Bilibili resources

`resources.search {keyword,limit?}` and `resources.recommend {taskIds?,maxTasks?,limitPerTask?}` return real Bilibili search results: each item carries `bvid`, `title`, `author`, canonical `https://www.bilibili.com/video/<bvid>` URL, `durationSeconds`, `play` and `publishedAt`, and every payload carries `source:'bilibili-search'` plus `fetchedAt`. Nothing is synthesised: a refused or unsigned request returns `BILI_UNAVAILABLE` instead of guessed links.

Search uses the public WBI-signed web endpoint. `STUDY_BILI_COOKIE` is optional and only needed when anonymous calls are rate limited (`-412`). Titles and descriptions are reduced to plain text; `<em>` highlight markup is stripped.

`resources.recommend` picks at most 5 open tasks (exam type first, then priority, then lower `mastery`, then earlier deadline), builds one keyword per task from the linked course name plus up to two `examScope` terms (falling back to the task title when neither exists), and ranks each result set by observable signals only: title contains the course or a scope term, review-oriented wording, duration against the task's remaining minutes, and view count. Each item carries `score` and a short `reasons` list so the UI can explain the order. Results are not cached or persisted; repeated calls re-query Bilibili.

## Export and deletion

`data.export {}` returns `{format:'study-agent/v1',json}` containing only the owner's five domain collections; credential/owner-lock collections are excluded. The JSON body contains format,exportedAt,collections.

`data.delete {confirmed:true,scope:{collection,records:[{id,version}]}}` physically deletes the specified 1..100 records in one atomic operation. No implicit all-user or all-collection deletion exists. Delete children, then tasks/courses/semesters; a scope containing both a parent task and all its children is supported. Omitting confirmation or using stale versions makes no changes.

## Repository

`createMemoryRepository({now?})` and `createCloudBaseRepository(wxDatabase,{now?})` share `get(owner,collection,id)`, `list(owner,collection,query?)`, `save(owner,collection,record,expectedVersion)`, `transaction(owner, async tx => ...)`. Transaction view also has `remove(owner,collection,id,expectedVersion)`; failures roll back all writes. `get` returns null for absent/wrong-owner IDs. CloudBase DB must be created with `{throwOnNotFound:false}`; production bootstrap does this explicitly. Physical document IDs hash owner+logical ID to avoid cross-owner collisions.

All writers must use this repository's transaction path: the `ownerLocks` guard serializes writes for one owner and protects cross-record checks and paginated nontransactional scans. SDK transactions allow doc operations only; scans use the base DB after transactional guard read and the guard write forces conflict/retry when another writer changes that owner. Do not bypass the guard in later server functions. SDK conflict exhaustion currently yields sanitized INTERNAL; expected per-record stale edits yield CONFLICT. No external calls belong inside transactions. Large scans may exceed the platform transaction time limit and need bounded batch design before production scale.

`deployment/database.json` is an explicit manual collection/index checklist, not a claimed importable CLI schema. Apply each entry of `security-rules.json` to its named traditional NoSQL collection; user records are privately readable and all client writes denied, credentials/locks fully denied. `providerSettings`, `providerUsage` and `uploadTickets` are listed in both files with client read and write denied, because they hold the sealed key, usage counters and upload tickets. These rules do not apply to PG mode, which requires RLS. Missing/unlisted collections must remain default-deny. Actual deployed rules and service identity remain unverified.

Official references checked 2026-11-04: [transactions](https://docs.cloudbase.net/database/transaction), [security rules](https://docs.cloudbase.net/database/security-rules), [wx-server-sdk source](https://github.com/wechat-miniprogram/wx-server-sdk). Installed SDK 3.0.1 source was also inspected for doc.get default throwing, transaction wrapper, and set/remove shapes. No credentials were discovered or read and no cloud request was made.

## Planning and progress

Planning uses `plans` (singleton logical ID `current`) and `planRevisions`; both are owner-scoped, client writes denied, and included in exports. Their collection/index entries are a manual deployment checklist; no cloud deployment or production verification has occurred. Generic `data.delete` cannot delete them. All writes run through the owner transaction guard.

- `profiles.setAvailability {id,expectedVersion,availability,termPeriodTimes?,plannerSettings?}` replaces explicit free intervals and optionally the Beijing period-time map. Each interval is `{start,end}` ISO 8601 with an offset; end is exclusive. Example mapping: `{"1":{"start":"08:00","end":"08:45"},"2":{"start":"08:55","end":"09:40"}}`; keys are period numbers 1–24 and times are 24-hour `HH:mm`. Empty availability is allowed and does not generate saved free time. Optional `plannerSettings` is a complete `{minMinutes,maxMinutes,breakMinutes}` object: integer min 30–240, max between min and 240, break 0–120. Defaults are 30/90/10. Map must cover every period in saved course schedules. Week 1 starts on the Monday of the semester start date's week, with occurrences clipped to semester dates. These are explicit user-confirmed settings; there is no assumed timetable.
- `plan.get {}` returns the current plan or null. `plan.generate {expectedVersion}` creates/replaces the plan; use 0 for first generation. If a scheduled course lacks a period mapping, returns `{configurationNeeded:['termPeriodTimes']}` without writing a plan. Otherwise returns `{plan,revision}`. Blocks contain `id,taskId,taskVersion,start,end,locked`. Date-only deadlines remain unchanged and are evaluated through 23:59:59.999 Beijing time. The rolling horizon is 14 days; minimum block 30 minutes, maximum 90, break 10. Unscheduled entries include reason and remaining minutes; `beyond_horizon` is an informational milestone in reasons. Core `buildPlan` also accepts `horizonDays`; the public action uses a 14-day horizon and saved planner settings. If a preserved future block now overlaps a class, generation/progress returns `{plan,conflicts:[{reason:"class_overlap",blockId,taskId}]}` without writing.
- `plan.progress {expectedVersion,changes:[{id,expectedVersion,remainingMinutes,completed?}]}` atomically applies 1–50 task progress updates and triggers one replan for affected future unlocked blocks. Unaffected blocks, past blocks and locked blocks remain. Returns `{plan,revision}`. The revision carries before/after blocks and `addedBlocks`, `removedBlocks`, task versions and reason. This is one batch per call, not a timed debounce service.
- `plan.manualBlock {expectedVersion,block:{taskId,start,end}}` creates a locked block by default. Overlap with a saved plan block or known class returns CONFLICT; no free time is inferred. Manual edit increments plan version.
- `plan.removeManualBlock {expectedVersion,blockId}` removes an owned locked block and increments the plan version; generate again to fill that time.
- `plan.undo {expectedVersion,revisionId}` returns `{plan,conflicts}`. Only the revision matching the current plan version can be restored. Any completed/cancelled, changed or missing task in the prior blocks, changed profile/course/semester, or later plan change prevents overwriting; conflicts are returned without a write. It never changes tasks or completion state. A stale `expectedVersion` returns CONFLICT. Restoring the previous plan increments its version and clears `lastRevisionId`.

The planner uses deterministic local computation; it makes no AI/provider call. Fixed course slots are expanded from semester dates and explicit period mapping. Task-level recurring schedule metadata is not expanded as a fixed calendar; add those as manual locked blocks before relying on them. Cloud transaction quotas and deployed identity, rules and indexes remain unverified.

Progress updates return `status: 'needs_attention'`, the versioned plan and conflicts if a retained block conflicts with a class. Valid progress is still saved; resolve the conflict before regenerating. Undo reports `remaining_work_exceeded` when the previous future blocks exceed the task's current remaining minutes.

A plan requiring attention stores `status: 'needs_attention'` and `attentionConflicts`; `plan.get` returns these after reconnecting. A successful rebuild clears them. Locked blocks incompatible with actual remaining work stay visible and must be resolved before rebuilding.

Undo of a rebuild whose prior plan needed attention returns `prior_plan_needs_attention`; it cannot restore the stale snapshot.
