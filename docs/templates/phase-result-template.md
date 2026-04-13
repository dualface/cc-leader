# 阶段结果: <phase-id>

## 状态

- workflow_id: <workflow-id>
- phase_id: <phase-id>
- phase_task_list_path: <path>
- execution_status: ready | in_progress | blocked | complete
- owner: worker

## 任务执行日志

### 任务 01: <task-id>

- status: pending | in_progress | complete | blocked
- summary: <发生了什么>
- changed_files_or_artifacts:
  - <path>
- verification_run:
  - <command-or-check>
- scope_verification:
  - none | <boundary proof>
- external_dependency_notes: none | <第三方 API / 外部服务调用的失败、跳过、降级记录>
- follow_up_notes: none | <notes>

### 任务 02: <task-id>

- status: pending | in_progress | complete | blocked
- summary: <发生了什么>
- changed_files_or_artifacts:
  - <path>
- verification_run:
  - <command-or-check>
- scope_verification:
  - none | <boundary proof>
- external_dependency_notes: none | <第三方 API / 外部服务调用的失败、跳过、降级记录>
- follow_up_notes: none | <notes>

## 阶段摘要

- blockers: none | <list>
- next_action: continue | wait_for_cc | ready_for_review
- verification_summary: <summary>
- external_dependency_summary: none | <本 phase 汇总的第三方依赖问题与建议>
  - 每条格式：`<依赖名>: <出现的问题> — 建议: <缓解方式>`
  - 汇总本 phase 所有 task 的 `external_dependency_notes`，去重
