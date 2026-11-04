# Task 7 visual direction — controller proposal

Subject: semester coursework and time planning for a student; fast daily use inside WeChat.

Product display name: 学程 (working name; editable in app config).

Tokens: paper #F4F7FC, surface #FFFFFF, ink #14213D, action #2457D6, completed #13745C, urgent #A65117. Use soft blue only to group time, not decorative gradients. All status colors have explicit text labels.

Typography: native Chinese system fonts (PingFang SC / Microsoft YaHei / sans-serif); compact but readable, body at least 28rpx, clear day/date hierarchy. No downloaded fonts or fake handwritten UI.

Layout idea: left-aligned course/task information, a functional time rail for daily planning, clearly marked pinned blocks; actual day/week order only, not decorative numbered cards. A quiet course-color stripe identifies association. Main bottom navigation: 今日 / 课程 / 计划 / 我的; import, task detail and resources are focused subflows.

Today:
  date + selected semester
  next actionable task with course and actual deadline
  timeline / unplanned tasks
  add text or screenshot

Plan:
  selected day and available capacity
  time rail with fixed vs movable blocks
  actual adjustment changes and undo

Empty state invites creating the first semester/course, never loads fabricated personal tasks. Optional demo mode must be explicitly labeled and separated from cloud mode.

Review against generic defaults: no hero metrics, gradients, identical floating cards, decorative badges, or marketing copy. The time rail is the distinctive functional motif. Settings expose provider configuration because the user explicitly requires it, but technical deployment internals stay in docs rather than everyday flows.

Native tooling acceptance has not succeeded during Task1 (CLI service disabled; native dialog input was unreliable). Task7/8 must actually import and compile, or retain an explicit unverified status. Do not alter security settings to make the CLI work.
