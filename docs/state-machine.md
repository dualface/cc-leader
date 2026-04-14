# CC Leader 状态机

这个文档定义 phase 跳转、重试、reopen、override。

## 主状态

- `drafting-specs`
- `writing-phase-plans`
- `writing-phase-tasks`
- `executing-phase-tasks`
- `reviewing-phase-results`
- `reporting-results`

## 正向跳转

1. spec 已批准 -> `writing-phase-plans`
2. phase plan list ready -> `writing-phase-tasks`
3. 第一个可执行 phase task list ready -> `executing-phase-tasks`
4. 当前 phase 执行完成 -> `reviewing-phase-results`
5. 当前 phase review `pass` 且下个 phase ready -> `executing-phase-tasks`
6. 全部 phase review `pass` -> final spec review
7. final spec review `pass` -> `reporting-results`

## 依赖规则

- phase plan list 必须显式写 `depends_on`
- 只有当某 phase 的全部依赖 phase review 都是 `pass`，该 phase 才可执行
- `ready` 只表示 task list 已准备好，不表示允许执行

## Reopen 规则

按最小必要范围回退：

- spec review `revise` -> 回 `drafting-specs`
- phase plan self review `revise` -> 留在 `writing-phase-plans`
- phase task self review `revise` -> 留在 `writing-phase-tasks`
- phase review `fail` 且问题在 task 定义 -> 回 `writing-phase-tasks`
- phase review `fail` 且问题在执行结果 -> 回 `executing-phase-tasks`
- final spec review `fail` -> 回最小受影响 phase

## `next_action` 到 phase 映射

- `wait_for_user_spec_approval` -> 留在 `drafting-specs`
- `revise_spec_with_user` -> `drafting-specs`
- `dispatch_phase_task_synthesis` -> `writing-phase-tasks`
- `mark_phase_ready` -> `writing-phase-tasks` 或 `executing-phase-tasks`
- `dispatch_phase_review` -> `reviewing-phase-results`
- `proceed_to_next_phase` -> `executing-phase-tasks` 或 final spec review
- `reopen_execution` -> `executing-phase-tasks`
- `rewrite_task_list` -> `writing-phase-tasks`
- `reopen_smallest_failing_phase` -> 回受影响最小 phase
- `proceed_to_final_report` -> `reporting-results`

## Retry 规则

每个 job 最多 2 次尝试：

- 第 1 次失败后，如果是 transport 失败，可自动重试 1 次
- 第 2 次仍失败，升级给 `cc`
- `cc` 判断是否问用户

不要盲目重试这些情况：

- 输入 artifact 缺失
- spec/plan 自相矛盾
- write scope 不够
- 同一 verification 错误重复出现

## Verification 重试

每个 task 的同一 verification 最多重试 2 次：

- 第 1 次失败：允许修正后重跑
- 第 2 次同类失败：记 `blocked`

## Override 规则

允许的 override 点：

- spec review 未过，但用户明确要继续
- phase review 未过，但用户明确接受风险
- final spec review 未过，但用户明确要求出报告

override 后必须做：

- 在相关 artifact 里写 `Override 记录`
- 追加写入 override log artifact
- 在最终报告里汇总 override
- 在 session state 里更新 `override_log_path`

## 结果文件与状态

- result file 不存在：transport 失败
- result file `status = blocked`：看 `retryable`
- result file `status = done` 但 artifact 无效：按 failed artifact 处理，不算成功

如果 `active_job_id` 仍存在：

- 不要先假定要重派新 job
- 先检查对应 run 目录里的 `job.json`
- 如果 runner / worker 仍存活，应先接管等待
- 如果 worker 已退出，再按 `result.json` 或 artifact recovery 继续状态推进

## 用户升级条件

出现下列任一情况，`cc` 应问用户：

- 同 job 两次失败
- phase review 和 final spec review 结论冲突
- 需要 override gate
- spec 或 phase 边界需要重新定 scope
