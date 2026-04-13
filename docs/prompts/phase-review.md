# 调度 Prompt: `phaseReview`

你是 `worker`。当前 job 是 `phaseReview`。

## 任务范围

- workflow_id: `{{workflow_id}}`
- job_id: `{{job_id}}`
- phase_id: `{{phase_id}}`
- 主要读取：
  - `{{phase_plan_list_path}}`
  - `{{phase_task_list_path}}`
  - `{{phase_result_path}}`
- 可选读取：
  - 只有验证结论必须依赖 repo 事实时，才读 `{{repo_root}}` 下对应文件
- 写入：
  - `{{phase_review_path}}`
  - `{{result_file_path}}`

## 核心规则

- 默认只读三个输入 artifact
- 不要读无关文件
- 如果 `{{phase_review_path}}` 已存在，直接整文件覆盖

## 必做步骤

1. 读 phase plan、phase task list、phase result
2. 对照 deliverable、verification、实际结果做 review
3. 写 `{{phase_review_path}}`
4. 写 `{{result_file_path}}`

## Phase review 必须包含

- workflow_id
- phase_id
- status: `pass` | `fail`
- reviewed_artifacts
- deliverables_present
- verification_sufficient
- drift_from_phase_goal
- findings
- external_dependency_findings（本 phase 外部依赖问题汇总，含建议），或 `none`
- next action

## 审查重点

- deliverables 是否存在
- `verification_run` 是否真的支撑功能完成（**仅内部逻辑部分**）
- `scope_verification` 是否真的支撑“业务改动未越出 write scope”
- summary 不能声称超过证据本身
- 把 phase result 中的 `external_dependency_notes` / `external_dependency_summary` 汇聚进 `external_dependency_findings`

## 外部依赖判定规则

- 仅因第三方 API / 外部服务不可达、超时、限流、鉴权失败而导致的 verification 缺失，**不**视为 `verification_sufficient: no`
- 这类缺口记入 `external_dependency_findings`，不触发 `fail`
- 如果 deliverable 的**内部逻辑**可独立验证且已验证通过，即认定交付达标
- 只有当内部逻辑验证也不充分时，才标 `fail`

## Scope 判定规则

- 只审业务改动路径，也就是 `changed_files_or_artifacts`
- run 目录内 transport 文件不算业务越界：
  - `prompt.md`
  - `stdout.jsonl`
  - `stderr.log`
  - `result.json`
- 如果 `scope_verification` 已经证明 `changed_files_or_artifacts` 都在允许前缀内，就可以视为 scope 证据充分

## 阻塞规则

只有这几种情况才返回 `status: blocked`：

- 任一必需输入 artifact 缺失
- 输入 artifact 内容不足以形成有效 review

能给出 `fail` 时，不要返回 `blocked`。

## 输出要求

- review 文档格式按 `docs/templates/phase-review-template.md`
- 结果 JSON 格式按 `docs/templates/worker-result-template.json`

## 结果 JSON 示例

```json
{
  "status": "done",
  "job": "phaseReview",
  "workflow_id": "{{workflow_id}}",
  "phase_id": "{{phase_id}}",
  "started_at": "2026-04-12T10:00:00Z",
  "finished_at": "2026-04-12T10:03:00Z",
  "exit_code": 0,
  "artifact_write_ok": true,
  "retryable": false,
  "verdict": "pass",
  "outputs": [
    {
      "artifact": "phaseReview",
      "path": "{{phase_review_path}}"
    }
  ],
  "next_action": "proceed_to_next_phase",
  "summary": "<one sentence>",
  "blockers": []
}
```
