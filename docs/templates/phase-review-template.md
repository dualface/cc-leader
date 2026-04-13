# 阶段审查: <phase-id>

## 结论

- workflow_id: <workflow-id>
- phase_id: <phase-id>
- status: pass | fail
- reviewer: worker
- reviewed_artifacts:
  - <phase-plan-path>
  - <phase-task-list-path>
  - <phase-result-path>

## 对齐检查

- deliverables_present: yes | no
- verification_sufficient: yes | no
- drift_from_phase_goal: none | <summary>

## 发现

- none | <finding list>

## 外部依赖发现

> 第三方 API / 外部服务 / 网络依赖相关的验证缺口与问题。
> 此类不触发 fail, 仅累积至最终报告。
> 每条格式: `<依赖名>: <问题> — 建议: <缓解方式>`

- none | <finding list>

## 必须跟进项

- none | <follow-up list>

## 下一步

- proceed_to_next_phase | reopen_execution | rewrite_task_list

## Override 记录

- none | <override note>
